import * as THREE from 'three';
import * as CANNON from 'cannon';
import { ICharacterAI } from '../interfaces/ICharacterAI';
import { Character } from '../characters/Character';
import { Idle } from '../characters/character_states/Idle';
import { findWeapon, WeaponSpec } from '../combat/Weapons';
import { CollisionGroups } from '../enums/CollisionGroups';
import { Vehicle } from '../vehicles/Vehicle';
import { World } from '../world/World';
import { Navigation, Lane } from '../npc/Navigation';

const EYE_HEIGHT = 0.6;

/** Walking or running along a direction, or standing still; only ever changed when it changes. */
function move(character: Character, direction: THREE.Vector3, running: boolean): void
{
	if (direction === undefined)
	{
		character.triggerAction('up', false);
		character.triggerAction('run', false);
		return;
	}
	character.setViewVector(direction);
	// Held down through a state that ignores it, climbing out of a car, the
	// key would never be seen as pressed by the standing state that follows
	if (character.actions.up.isPressed && character.charState instanceof Idle) character.triggerAction('up', false);
	character.triggerAction('up', true);
	character.triggerAction('run', running);
}

function eyeOf(character: Character): THREE.Vector3
{
	let at = character.getWorldPosition(new THREE.Vector3());
	at.y += EYE_HEIGHT;
	return at;
}

/**
 * Whether anything solid stands between two points: buildings, walls, cars.
 * The vehicle a target sits in doesn't hide them from a shot at it.
 */
export function clearLine(world: World, from: THREE.Vector3, to: THREE.Vector3, ignore?: CANNON.Body): boolean
{
	let blocked = false;
	world.physicsWorld.raycastAll(
		new CANNON.Vec3(from.x, from.y, from.z),
		new CANNON.Vec3(to.x, to.y, to.z),
		// tslint:disable-next-line: no-bitwise
		{ collisionFilterMask: ~(CollisionGroups.Characters | CollisionGroups.Pedestrians), collisionFilterGroup: -1, skipBackfaces: true },
		(result: CANNON.RaycastResult) =>
		{
			if (result.body !== ignore) blocked = true;
		}
	);
	return !blocked;
}

export interface GunmanOptions
{
	/** A weapon id from the catalogue. */
	weapon: string;
	/** Chance of a hit on someone standing still ten metres off. */
	accuracy?: number;
	/** How much of the gun's damage lands: people in the city shoot worse than players. */
	damageScale?: number;
	/** How far off they notice the player once there's trouble. */
	sight?: number;
	/** Where they're posted. They go no further than the leash from it after anyone. */
	home?: THREE.Vector3;
	leash?: number;
	/** Shooting on sight from the start, rather than once something starts it. */
	hostile?: boolean;
}

/**
 * Somebody with a gun: a guard at a till, a bodyguard, the crew on a cash van.
 *
 * Posted somewhere and calm until there's trouble: the job says so by making
 * them hostile, or somebody shoots them. Then they turn on the player when
 * they can see them, fire in short bursts from where they stand, and go after
 * the player when they can't see them, as far as their post allows.
 *
 * Their shots are real rounds for the player's health, through the same
 * cover rules as anyone else's, and look and sound like anybody's.
 */
export class Gunman implements ICharacterAI
{
	public character: Character;
	public hostile: boolean;
	public readonly spec: WeaponSpec;

	private world: World;
	private accuracy: number;
	private damageScale: number;
	private sight: number;
	private home: THREE.Vector3;
	private leash: number;

	private cooldown: number = 0;
	private burst: number = 0;
	/** A moment between seeing the player and the first shot. */
	private reaction: number = 0;
	private seen: boolean = false;
	private lastSeen: THREE.Vector3;
	private lastHealth: number;
	private dead: boolean = false;
	private sightCheck: number = 0;
	private canSee: boolean = false;

	constructor(world: World, options: GunmanOptions)
	{
		this.world = world;
		this.spec = findWeapon(options.weapon) || findWeapon('handgun');
		this.accuracy = options.accuracy !== undefined ? options.accuracy : 0.4;
		this.damageScale = options.damageScale !== undefined ? options.damageScale : 0.35;
		this.sight = options.sight !== undefined ? options.sight : 40;
		this.home = options.home !== undefined ? options.home.clone() : undefined;
		this.leash = options.leash !== undefined ? options.leash : 30;
		this.hostile = options.hostile === true;
	}

	/** Once the character is made: puts the gun in their hand. */
	public arm(): void
	{
		if (this.character !== undefined && this.character.weapon === undefined) this.character.equipWeapon(this.spec);
		if (this.home === undefined && this.character !== undefined) this.home = this.character.getWorldPosition(new THREE.Vector3());
	}

	public get alive(): boolean
	{
		return this.character !== undefined && this.character.health > 0;
	}

	public update(timeStep: number): void
	{
		let me = this.character;
		if (me === undefined || me.world === undefined) return;
		if (me.weapon === undefined) this.arm();
		if (this.lastHealth === undefined) this.lastHealth = me.health;

		if (me.health <= 0)
		{
			if (!this.dead)
			{
				this.dead = true;
				me.resetControls();
			}
			return;
		}

		// Shot at: that's trouble
		if (me.health < this.lastHealth) this.hostile = true;
		this.lastHealth = me.health;

		// Still climbing out of a car: nothing until both feet are on the road
		if (me.isBusyWithVehicle()) return;

		this.cooldown -= timeStep;
		let player = this.world.localCharacter;
		if (!this.hostile || player === undefined || player.health <= 0 || player.world === undefined)
		{
			this.seen = false;
			this.goHome();
			return;
		}

		let from = eyeOf(me);
		let target = eyeOf(player);
		target.y -= 0.35;
		let distance = from.distanceTo(target);

		// Line of sight a few times a second rather than every frame
		this.sightCheck -= timeStep;
		if (this.sightCheck <= 0)
		{
			this.sightCheck = 0.2 + Math.random() * 0.1;
			let ride = Gunman.vehicleOf(player);
			this.canSee = distance < this.sight && clearLine(this.world, from, target, ride !== undefined ? ride.collision : undefined);
		}

		let flat = new THREE.Vector3(target.x - from.x, 0, target.z - from.z);
		let direction = flat.lengthSq() > 0.0001 ? flat.normalize() : undefined;

		if (!this.canSee)
		{
			this.seen = false;
			// After them, to where they were last seen, but no further than the post allows
			let goal = this.lastSeen !== undefined ? this.lastSeen : target;
			let here = me.getWorldPosition(new THREE.Vector3());
			let toGoal = new THREE.Vector3(goal.x - here.x, 0, goal.z - here.z);
			let away = this.home !== undefined ? Math.hypot(goal.x - this.home.x, goal.z - this.home.z) : 0;
			if (toGoal.length() > 1.5 && away < this.leash && distance < this.sight * 1.6) move(me, toGoal.normalize(), true);
			else if (toGoal.length() <= 1.5) { this.lastSeen = undefined; move(me, undefined, false); }
			else this.goHome();
			return;
		}

		this.lastSeen = target.clone();
		if (!this.seen)
		{
			this.seen = true;
			this.reaction = 0.5 + Math.random() * 0.7;
		}

		// Closer when they're out of range, otherwise standing to shoot
		let range = Math.min(this.spec.range, this.spec.id === 'shotgun' ? 16 : 45);
		if (distance > range * 0.85) move(me, direction, true);
		else
		{
			move(me, undefined, false);
			if (direction !== undefined) me.setOrientation(direction);
		}

		this.reaction -= timeStep;
		if (this.reaction > 0 || this.cooldown > 0 || distance > range) return;
		this.fire(from, target, player, distance);
	}

	private fire(from: THREE.Vector3, target: THREE.Vector3, player: Character, distance: number): void
	{
		let spec = this.spec;
		let muzzle = this.character.getMuzzlePosition();

		// Harder the further off, the faster the player moves, and when they're in a car
		let chance = this.accuracy * THREE.MathUtils.clamp(10 / Math.max(distance, 4), 0.2, 1.4);
		let ride = Gunman.vehicleOf(player);
		let speed = ride !== undefined ? ride.collision.velocity.length() : (player.characterCapsule.body.velocity as any).length();
		if (ride !== undefined) chance *= 0.65;
		if (speed > 4) chance *= THREE.MathUtils.clamp(4 / speed, 0.35, 1);
		if (this.world.combat.isAiming) chance *= 1.1;
		let hit = Math.random() < chance;

		// A miss goes past them, a little to the side and over
		let end = target.clone();
		if (!hit)
		{
			let side = new THREE.Vector3(-(target.z - from.z), 0, target.x - from.x).normalize();
			end.addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 1.6));
			end.y += Math.random() * 0.9 - 0.2;
			end.sub(from).setLength(Math.min(spec.range, distance + 6 + Math.random() * 10)).add(from);
		}
		let aim = end.clone().sub(muzzle).normalize();
		this.world.combat.showRemoteShot(muzzle, aim, spec.id, this.character, [end]);
		if (this.world.npcs !== undefined) this.world.npcs.onGunshot(from);

		if (hit)
		{
			let damage = spec.damage * spec.pellets * this.damageScale;
			// Pellets spread: a shotgun is mostly a close thing
			if (spec.pellets > 1) damage *= THREE.MathUtils.clamp(1.4 - distance / 14, 0.2, 1);
			this.world.combat.hurtByNpc(damage, from, spec.id);
			// A round into the car the player sits in marks it as well
			if (ride !== undefined) ride.integrity = Math.max(0, ride.integrity - 0.6);
		}

		// Automatic fire in short bursts, the rest one at a time and slower than a player
		let automatic = spec.automatic === true;
		if (automatic)
		{
			if (this.burst <= 0) this.burst = 3 + Math.floor(Math.random() * 3);
			this.burst--;
			// Nobody in the street holds a trigger down as steadily as a player
			this.cooldown = this.burst > 0 ? Math.max(spec.fireInterval * 1.5, 0.15) : 0.8 + Math.random() * 0.8;
		}
		else this.cooldown = Math.max(spec.fireInterval, 0.45) * (1.4 + Math.random() * 0.8);
	}

	private goHome(): void
	{
		let me = this.character;
		if (this.home === undefined)
		{
			move(me, undefined, false);
			return;
		}
		let here = me.getWorldPosition(new THREE.Vector3());
		let back = new THREE.Vector3(this.home.x - here.x, 0, this.home.z - here.z);
		if (back.length() > 1.2) move(me, back.normalize(), false);
		else move(me, undefined, false);
	}

	private static vehicleOf(character: Character): Vehicle
	{
		if (character.occupyingSeat === null || character.occupyingSeat === undefined) return undefined;
		return character.occupyingSeat.vehicle as unknown as Vehicle;
	}
}

/**
 * Somebody running for it: away from the player, or to a place. Slows to a
 * walk once far enough away, if nothing else is asked of them.
 */
export class Runner implements ICharacterAI
{
	public character: Character;
	/** Where they're making for; away from the player when it's undefined. */
	public goal: THREE.Vector3;
	/** Far enough from the player to stop running. */
	public safeDistance: number;
	public arrived: boolean = false;

	private world: World;
	private wander: number = 0;
	private sideways: number = 0;
	private dead: boolean = false;

	constructor(world: World, goal?: THREE.Vector3, safeDistance: number = 45)
	{
		this.world = world;
		this.goal = goal !== undefined ? goal.clone() : undefined;
		this.safeDistance = safeDistance;
	}

	public update(timeStep: number): void
	{
		let me = this.character;
		if (me === undefined || me.world === undefined) return;
		if (me.health <= 0)
		{
			if (!this.dead)
			{
				this.dead = true;
				me.resetControls();
			}
			return;
		}

		if (me.isBusyWithVehicle()) return;

		let here = me.getWorldPosition(new THREE.Vector3());
		if (this.goal !== undefined)
		{
			let toGoal = new THREE.Vector3(this.goal.x - here.x, 0, this.goal.z - here.z);
			this.arrived = toGoal.length() < 1.2;
			move(me, this.arrived ? undefined : toGoal.normalize(), true);
			return;
		}

		let player = this.world.localCharacter;
		if (player === undefined)
		{
			move(me, undefined, false);
			return;
		}
		let from = player.getWorldPosition(new THREE.Vector3());
		let away = new THREE.Vector3(here.x - from.x, 0, here.z - from.z);
		let distance = away.length();
		if (distance > this.safeDistance * 1.6)
		{
			move(me, undefined, false);
			return;
		}

		// Weaving a little, and a new way round now and then when stuck on something
		this.wander -= timeStep;
		if (this.wander <= 0)
		{
			this.wander = 1.2 + Math.random() * 1.5;
			let speed = me.characterCapsule.body.velocity;
			let stuck = Math.hypot(speed.x, speed.z) < 0.6;
			this.sideways = stuck ? (Math.random() < 0.5 ? -1.4 : 1.4) : (Math.random() - 0.5) * 0.6;
		}
		away.normalize();
		let side = new THREE.Vector3(-away.z, 0, away.x);
		let direction = away.addScaledVector(side, this.sideways).normalize();
		move(me, direction, distance < this.safeDistance);
	}
}

/** Somebody walking to a place and stopping there. */
export class Walker implements ICharacterAI
{
	public character: Character;
	public goal: THREE.Vector3;
	public running: boolean;
	public arrived: boolean = false;
	private dead: boolean = false;

	constructor(goal: THREE.Vector3, running: boolean = false)
	{
		this.goal = goal.clone();
		this.running = running;
	}

	public update(timeStep: number): void
	{
		let me = this.character;
		if (me === undefined || me.world === undefined) return;
		if (me.health <= 0)
		{
			// Shot mid-stride: the legs stop with the rest of them
			if (!this.dead)
			{
				this.dead = true;
				me.resetControls();
			}
			return;
		}
		if (me.isBusyWithVehicle()) return;
		let here = me.getWorldPosition(new THREE.Vector3());
		let toGoal = new THREE.Vector3(this.goal.x - here.x, 0, this.goal.z - here.z);
		this.arrived = toGoal.length() < 1;
		move(me, this.arrived ? undefined : toGoal.normalize(), this.running);
	}
}

/** The lane whose line passes nearest a point, and how far along it that is. Heading, if given, rules out lanes going the other way. */
export function nearestLane(navigation: Navigation, point: THREE.Vector3, heading?: THREE.Vector3): { lane: Lane, distance: number, gap: number }
{
	let best: { lane: Lane, distance: number, gap: number };
	let scratch = new THREE.Vector3();
	let direction = new THREE.Vector3();
	for (const lane of navigation.lanes)
	{
		if (lane.turn) continue;
		let points = lane.points;
		for (let i = 1; i < points.length; i++)
		{
			let a = points[i - 1];
			let b = points[i];
			let abx = b.x - a.x;
			let abz = b.z - a.z;
			let span = abx * abx + abz * abz;
			let t = span > 0 ? THREE.MathUtils.clamp(((point.x - a.x) * abx + (point.z - a.z) * abz) / span, 0, 1) : 0;
			scratch.set(a.x + abx * t, a.y + (b.y - a.y) * t, a.z + abz * t);
			let gap = Math.hypot(point.x - scratch.x, point.z - scratch.z) + Math.abs(point.y - scratch.y) * 2;
			if (best !== undefined && gap >= best.gap) continue;
			if (heading !== undefined)
			{
				direction.set(abx, 0, abz).normalize();
				if (direction.dot(heading) < 0.3) continue;
			}
			best = { lane: lane, distance: lane.lengths[i - 1] + Math.sqrt(span) * t, gap: gap };
		}
	}
	return best;
}

/**
 * A way through the streets from a lane, along the lanes, about so long:
 * straight on more often than not, a turn now and then. The points are
 * spaced a few units apart, so it can be driven by following them.
 */
export function laneRoute(start: Lane, from: number, length: number, straightness: number = 0.65): THREE.Vector3[]
{
	let points: THREE.Vector3[] = [];
	let lane = start;
	let distance = from;
	let travelled = 0;
	let step = 4;
	let guard = 0;
	while (travelled < length && guard++ < 5000)
	{
		points.push(lane.sample(distance, new THREE.Vector3()));
		distance += step;
		travelled += step;
		if (distance <= lane.length) continue;
		distance -= lane.length;
		lane = nextLane(lane, straightness);
		if (lane === undefined) break;
	}
	return points;
}

/** Where a lane goes on to: straight across most of the time. */
export function nextLane(lane: Lane, straightness: number = 0.65): Lane
{
	if (lane.next.length === 0) return undefined;
	let options = lane.next;
	// A turn lane leads to one lane only; a lane arriving at a junction leads to turn lanes
	let straight = options.filter((option) => option.next.length === 1 && option.speed > 5.1);
	if (straight.length > 0 && Math.random() < straightness) return straight[Math.floor(Math.random() * straight.length)];
	return options[Math.floor(Math.random() * options.length)];
}

/**
 * At the wheel of a car, following a line of points: a race route, or the
 * lanes of the city one after another. Keeps to a speed, slows for bends,
 * and backs up and tries again when it's stuck against something.
 *
 * When it runs out of points it asks for more, if it's been told how, and
 * otherwise stops at the end and says so.
 */
export class Driver implements ICharacterAI
{
	public character: Character;
	public points: THREE.Vector3[];
	/** The one being driven at now. */
	public index: number = 0;
	/** Cruising speed, units a second. */
	public speed: number;
	public done: boolean = false;
	/** Held still, engine running: at the lights of a race start, or pulled over. */
	public paused: boolean = false;
	/** More of the road, when it's run out. */
	public extend: () => THREE.Vector3[];

	private stuck: number = 0;
	private reversing: number = 0;
	private dead: boolean = false;

	constructor(points: THREE.Vector3[], speed: number, extend?: () => THREE.Vector3[])
	{
		this.points = points.slice();
		this.speed = speed;
		this.extend = extend;
	}

	/** How far down the route, as a count of points passed. */
	public get progress(): number
	{
		return this.index;
	}

	public update(timeStep: number): void
	{
		let me = this.character;
		if (me === undefined || me.world === undefined) return;
		let vehicle = me.controlledObject as unknown as Vehicle;
		if (me.health <= 0 || vehicle === undefined || me.occupyingSeat === null)
		{
			if (!this.dead && vehicle !== undefined) this.release(vehicle);
			this.dead = me.health <= 0;
			return;
		}

		let here = vehicle.position;
		let velocity = vehicle.collision.velocity;
		let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.quaternion).setY(0).normalize();
		let speed = Math.hypot(velocity.x, velocity.z);
		let ahead = velocity.x * forward.x + velocity.z * forward.z;

		// Past the points already reached, looking further ahead the faster it goes
		let look = 6 + speed * 0.55;
		while (this.index < this.points.length && Math.hypot(this.points[this.index].x - here.x, this.points[this.index].z - here.z) < look)
		{
			this.index++;
			if (this.index >= this.points.length - 2 && this.extend !== undefined)
			{
				let more = this.extend();
				if (more !== undefined && more.length > 0) this.points.push(...more);
			}
		}
		if (this.index >= this.points.length)
		{
			this.done = true;
			this.release(vehicle);
			vehicle.triggerAction('brake', true);
			return;
		}
		if (this.paused)
		{
			this.release(vehicle);
			vehicle.triggerAction('brake', true);
			return;
		}
		vehicle.triggerAction('brake', false);

		let target = this.points[this.index];
		let toTarget = new THREE.Vector3(target.x - here.x, 0, target.z - here.z).normalize();
		let angle = Math.atan2(forward.x * toTarget.z - forward.z * toTarget.x, forward.dot(toTarget));
		// Slower into a bend: how far the road turns over the next stretch
		let far = this.points[Math.min(this.points.length - 1, this.index + 6)];
		let bend = new THREE.Vector3(far.x - target.x, 0, far.z - target.z);
		let turning = bend.lengthSq() > 0.01 ? 1 - Math.max(0, bend.normalize().dot(forward)) : 0;
		let wanted = this.speed * THREE.MathUtils.clamp(1 - turning * 1.1, 0.35, 1);

		// Stuck on something: back off with the wheel the other way, which swings
		// the nose round toward the road, and try again
		if (this.reversing > 0)
		{
			this.reversing -= timeStep;
			vehicle.triggerAction('throttle', false);
			vehicle.triggerAction('reverse', true);
			vehicle.triggerAction('left', angle > 0.05);
			vehicle.triggerAction('right', angle < -0.05);
			return;
		}
		if (speed < 0.8) this.stuck += timeStep;
		else this.stuck = 0;
		if (this.stuck > 2.2)
		{
			this.stuck = 0;
			this.reversing = 1.4;
			return;
		}

		// A car's left is a negative angle here: steering is to the other side
		vehicle.triggerAction('left', angle < -0.05);
		vehicle.triggerAction('right', angle > 0.05);
		if (ahead < wanted)
		{
			vehicle.triggerAction('throttle', true);
			vehicle.triggerAction('reverse', false);
		}
		else if (ahead > wanted + 2.5)
		{
			vehicle.triggerAction('throttle', false);
			vehicle.triggerAction('reverse', true);
		}
		else
		{
			vehicle.triggerAction('throttle', false);
			vehicle.triggerAction('reverse', false);
		}
	}

	private release(vehicle: Vehicle): void
	{
		for (const action of ['throttle', 'reverse', 'left', 'right']) vehicle.triggerAction(action, false);
	}
}
