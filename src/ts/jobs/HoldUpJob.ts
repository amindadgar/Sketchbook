import * as THREE from 'three';
import { Job } from './Job';
import { JobSystem, JobMarker } from './JobSystem';
import { Gunman, Runner, Driver, nearestLane } from './JobAI';
import { Character } from '../characters/Character';
import { Vehicle } from '../vehicles/Vehicle';
import { Blip } from '../core/Minimap';
import { ShopSystem } from '../economy/ShopSystem';
import { CityPlan } from '../city/CityPlan';
import { Lane } from '../npc/Navigation';

type Stage = 'approach' | 'robbing' | 'escape';
type BackupStage = 'none' | 'driving' | 'stopping' | 'out';

/** Somebody with a gun on the other side: a guard on the door, or one of the crew sent after the player. */
interface Armed
{
	person: Character;
	/** Their mind once they're fighting. The crew only get one once they're out of the car. */
	gunman: Gunman;
	weapon: string;
	blip: Blip;
	/** Seen to the floor, and counted. */
	down: boolean;
}

/**
 * Holding up a corner shop at gunpoint.
 *
 * A Quik Mart somewhere across town, marked on the map, with the clerk at
 * the door and a guard or two on the pavement. Get there and keep a gun on
 * the clerk, close up, until the till's empty; the guards open fire the
 * moment the gun comes up, and if the clerk dies the till stays shut. Then
 * the clerk runs, a car of the owner's friends turns up with guns, and
 * there's a clock on getting clear before the police close the streets off.
 * Far enough away and the take is the player's, with something extra for
 * every gunman put down on the way.
 */
export class HoldUpJob extends Job
{
	public readonly id: string = 'holdup';
	public readonly title: string = 'Hold-up';
	public readonly description: string = 'Rob a corner shop at gunpoint. Keep the gun on the clerk till the till is empty, then get clear before the police close in.';
	public readonly pays: string = '$450 - $900';

	private static readonly COLOR: string = '#f0a030';
	private static readonly HOSTILE: string = '#e2574c';
	/** How close to the clerk a gun counts, and how long it has to be held on them in all. */
	private static readonly REACH: number = 9;
	private static readonly TILL_TIME: number = 3;
	/** How far from the store is clear, and how long there is to get that far. */
	private static readonly CLEAR: number = 220;
	private static readonly ESCAPE_TIME: number = 100;
	/** Extra for every gunman put down. */
	private static readonly BOUNTY: number = 40;
	private static readonly GUARD_WEAPONS: string[] = ['handgun', 'shotgun'];
	private static readonly CREW_WEAPONS: string[] = ['smg', 'shotgun', 'handgun'];

	private stage: Stage;
	private store: THREE.Vector3;
	private inward: THREE.Vector3;
	private sign: THREE.Mesh;
	private marker: JobMarker;
	private blips: Blip[] = [];

	private clerk: Character;
	private clerkHealth: number = 0;
	/** Where the guards stand, made as soon as there are bodies to make them from. */
	private posts: { position: THREE.Vector3, weapon: string, placed: boolean }[] = [];
	private armed: Armed[] = [];
	private alarm: boolean = false;
	private till: number = 0;
	private take: number = 0;
	private kills: number = 0;
	private timeLeft: number = 0;

	private backupIn: number = 0;
	private backupCalled: boolean = false;
	private backupStage: BackupStage = 'none';
	private backupCar: Vehicle;
	private backupDriver: Driver;
	private backupTime: number = 0;

	constructor(system: JobSystem)
	{
		super(system);
	}

	public start(): string
	{
		let player = this.world.localCharacter;
		if (this.world.combat.carriedIds().length === 0 && player.weapon === undefined) return 'you need a gun for this: try Bullseye Guns';
		let spot = this.findStore();
		if (spot === undefined) return 'every shop round here has shut';

		this.stage = 'approach';
		this.store = spot.position.clone();
		this.inward = spot.inward.clone();
		this.clerk = undefined;
		this.clerkHealth = 0;
		this.posts = [];
		this.armed = [];
		this.alarm = false;
		this.till = 0;
		this.take = 0;
		this.kills = 0;
		this.timeLeft = 0;
		this.backupIn = 0;
		this.backupCalled = false;
		this.backupStage = 'none';
		this.backupCar = undefined;
		this.backupDriver = undefined;
		this.backupTime = 0;

		// The sign over the door, as the real shops have theirs
		let out = this.inward.clone().negate();
		this.sign = ShopSystem.sign('Quik Mart', '24 HOURS', HoldUpJob.COLOR);
		this.sign.position.copy(this.store).addScaledVector(this.inward, 0.62);
		this.sign.position.y = this.store.y + 2.9;
		this.sign.lookAt(this.sign.position.clone().add(out));
		this.world.graphicsWorld.add(this.sign);
		this.marker = this.system.addMarker(this.store, HoldUpJob.COLOR, 3, 'Store');

		// A guard or two up the pavement from the door, either side
		let along = new THREE.Vector3(-this.inward.z, 0, this.inward.x).normalize();
		let sides = Math.random() < 0.5 ? [Math.random() < 0.5 ? 1 : -1] : [1, -1];
		for (const side of sides)
		{
			this.posts.push({
				position: this.store.clone().addScaledVector(along, side * 3.4),
				weapon: HoldUpJob.pick(HoldUpJob.GUARD_WEAPONS),
				placed: false
			});
		}
		this.placePeople();
		return undefined;
	}

	public update(timeStep: number): void
	{
		this.placePeople();
		this.trackArmed();

		if (this.stage !== 'escape')
		{
			if (this.clerk !== undefined && this.clerk.health <= 0)
			{
				this.system.fail('the clerk is dead, and so is the till');
				return;
			}
			this.watchForTrouble();
		}

		switch (this.stage)
		{
			case 'approach': this.approach(); break;
			case 'robbing': this.rob(timeStep); break;
			case 'escape': this.escape(timeStep); break;
		}
	}

	public cleanup(): void
	{
		if (this.sign !== undefined)
		{
			this.world.graphicsWorld.remove(this.sign);
			this.sign.geometry.dispose();
			let material = this.sign.material as THREE.MeshBasicMaterial;
			if (material.map !== null) material.map.dispose();
			material.dispose();
			this.sign = undefined;
		}
		for (const blip of this.blips)
		{
			let i = this.world.blips.indexOf(blip);
			if (i >= 0) this.world.blips.splice(i, 1);
		}
		this.blips = [];
		for (const armed of this.armed) armed.blip = undefined;
		this.armed = [];
		this.posts = [];
		this.clerk = undefined;
		this.marker = undefined;
		this.backupCar = undefined;
		this.backupDriver = undefined;
	}

	// The stages

	private approach(): void
	{
		this.system.setHud('Get to the Quik Mart', this.posts.length > 1 ? 'two armed guards on the door' : 'an armed guard on the door');
		if (this.marker.contains(this.system.playerPosition(), 9)) this.stage = 'robbing';
	}

	/** A gun on the clerk, close up, until the till's empty. Time with the gun off them isn't lost, only paused. */
	private rob(timeStep: number): void
	{
		if (this.clerk === undefined)
		{
			this.system.setHud('Hold up the clerk', 'waiting for the clerk');
			return;
		}
		let player = this.world.localCharacter;
		let here = this.system.playerPosition();
		let at = this.clerk.getWorldPosition(new THREE.Vector3());
		let done = Math.floor(this.till / HoldUpJob.TILL_TIME * 100) + '%';

		if (player.occupyingSeat !== null)
		{
			this.system.setHud('Hold up the clerk', 'get out of the car first');
			return;
		}
		if (!this.world.combat.isAiming)
		{
			this.system.setHud('Hold up the clerk', this.till > 0 ? 'gun back on them: the till is ' + done + ' empty' : 'aim your gun at the clerk');
			return;
		}
		if (Math.hypot(at.x - here.x, at.z - here.z) > HoldUpJob.REACH)
		{
			this.system.setHud('Hold up the clerk', 'get closer to the clerk');
			return;
		}
		if (!this.onClerk(at))
		{
			this.system.setHud('Hold up the clerk', 'point the gun at the clerk');
			return;
		}

		// The gun's up: the guards aren't standing for it
		if (!this.alarm) this.raiseAlarm();
		let toPlayer = here.clone().sub(at).setY(0);
		if (toPlayer.lengthSq() > 0.01) this.clerk.setOrientation(toPlayer.normalize());

		this.till += timeStep;
		if (this.till >= HoldUpJob.TILL_TIME)
		{
			this.emptied();
			return;
		}
		this.system.setHud('Hold up the clerk', 'emptying the till ' + Math.floor(this.till / HoldUpJob.TILL_TIME * 100) + '%');
	}

	/** Money in hand, the clerk off down the street, and help on its way for the shop. */
	private emptied(): void
	{
		this.take = Math.round((450 + Math.random() * 450) / 5) * 5;
		this.system.setMind(this.clerk, new Runner(this.world));
		this.system.removeMarker(this.marker);
		this.marker = undefined;
		this.addBlip({ position: this.store.clone(), color: HoldUpJob.COLOR, label: 'Store', shape: 'square' });
		this.stage = 'escape';
		this.timeLeft = HoldUpJob.ESCAPE_TIME;
		this.backupIn = 4 + Math.random() * 2;
		this.world.notices.say('Till emptied', 'good', '$' + this.take + ': now get clear');
	}

	private escape(timeStep: number): void
	{
		this.timeLeft -= timeStep;
		this.updateBackup(timeStep);

		let here = this.system.playerPosition();
		let away = Math.hypot(here.x - this.store.x, here.z - this.store.z);
		let bonus = this.kills * HoldUpJob.BOUNTY;
		if (away >= HoldUpJob.CLEAR)
		{
			this.system.pay(this.take, 'hold-up');
			if (bonus > 0) this.system.pay(bonus, this.kills + (this.kills === 1 ? ' guard' : ' guards') + ' down');
			this.system.finish('clean getaway');
			return;
		}
		if (this.timeLeft <= 0)
		{
			this.system.fail('the police cordon closed in');
			return;
		}
		let left = Math.ceil((HoldUpJob.CLEAR - away) / CityPlan.METRE);
		let money = '$' + this.take + (bonus > 0 ? ' + $' + bonus : '');
		this.system.setHud('Get clear of the store', money + ' on you, ' + left + ' m to go', this.timeLeft);
	}

	// The people

	/** The clerk and the guards, as soon as there are bodies to make them from. */
	private placePeople(): void
	{
		if (this.stage === 'escape') return;
		let out = this.inward.clone().negate();
		if (this.clerk === undefined)
		{
			this.clerk = this.system.addPerson(this.store, out);
			if (this.clerk !== undefined) this.clerkHealth = this.clerk.health;
		}
		// Nobody new turns up mid-fight
		if (this.alarm) return;
		for (const post of this.posts)
		{
			if (post.placed) continue;
			let gunman = this.system.addGunman(post.position, out, { weapon: post.weapon, accuracy: 0.35, leash: 30 });
			if (gunman === undefined) continue;
			post.placed = true;
			this.armed.push({ person: gunman.character, gunman: gunman, weapon: post.weapon, blip: undefined, down: false });
		}
	}

	/** Shots at the guards or the clerk start it as surely as a gun in the clerk's face. */
	private watchForTrouble(): void
	{
		if (this.alarm) return;
		let shotAt = this.armed.some((armed) => armed.gunman !== undefined && armed.gunman.hostile);
		let clerkHurt = this.clerk !== undefined && this.clerk.health < this.clerkHealth;
		if (shotAt || clerkHurt) this.raiseAlarm();
	}

	private raiseAlarm(): void
	{
		this.alarm = true;
		for (const armed of this.armed)
		{
			if (armed.gunman !== undefined) armed.gunman.hostile = true;
		}
	}

	/** A mark on the map for everyone shooting at the player, and a count of those put down. */
	private trackArmed(): void
	{
		for (const armed of this.armed)
		{
			if (armed.down) continue;
			let person = armed.person;
			if (person.world === undefined || person.health <= 0)
			{
				armed.down = true;
				if (person.health <= 0) this.kills++;
				this.removeBlip(armed.blip);
				armed.blip = undefined;
				continue;
			}
			let hostile = armed.gunman === undefined || armed.gunman.hostile;
			if (!hostile) continue;
			if (armed.blip === undefined) armed.blip = this.addBlip({ position: new THREE.Vector3(), color: HoldUpJob.HOSTILE, shape: 'dot' });
			person.getWorldPosition(armed.blip.position);
		}
	}

	// The backup

	/** A car with two more gunmen, some way up the street and driving in to the store. Skipped if it can't be made. */
	private callBackup(): void
	{
		this.backupCalled = true;
		if (this.world.npcs === undefined || this.world.npcs.navigation === undefined) return;
		let route = this.routeToStore();
		if (route === undefined) return;
		let heading = Math.atan2(route[1].x - route[0].x, route[1].z - route[0].z);
		this.system.addVehicle(route[0], heading, 1, (vehicle) =>
		{
			if (this.stage !== 'escape')
			{
				this.system.removeVehicle(vehicle);
				return;
			}
			let driver = this.system.seatPerson(vehicle, true);
			if (driver === undefined)
			{
				this.system.removeVehicle(vehicle);
				return;
			}
			let ai = new Driver(route, 11);
			this.system.setMind(driver, ai);
			this.backupCar = vehicle;
			this.backupDriver = ai;
			this.backupTime = 0;
			this.backupStage = 'driving';
			this.addCrew(driver);
			let mate = this.system.seatPerson(vehicle, false);
			if (mate !== undefined) this.addCrew(mate);
			this.world.notices.say('Trouble on the way', 'bad', 'the owner sent friends');
		}, 'sedan');
	}

	private addCrew(person: Character): void
	{
		this.armed.push({ person: person, gunman: undefined, weapon: HoldUpJob.pick(HoldUpJob.CREW_WEAPONS), blip: undefined, down: false });
	}

	/** Drives in, pulls up, and they get out shooting: close to the store, or when it's taking too long. */
	private updateBackup(timeStep: number): void
	{
		if (!this.backupCalled)
		{
			this.backupIn -= timeStep;
			if (this.backupIn <= 0) this.callBackup();
			return;
		}
		if (this.backupStage === 'none') return;
		this.backupTime += timeStep;
		let car = this.backupCar;
		let gone = car === undefined || car.world === undefined;

		if (this.backupStage === 'driving')
		{
			let driver = this.backupDriver.character;
			let lostDriver = driver === undefined || driver.health <= 0 || driver.occupyingSeat === null;
			let near = !gone && Math.hypot(car.position.x - this.store.x, car.position.z - this.store.z) < 15;
			if (gone || near || lostDriver || this.backupDriver.done || this.backupTime > 25)
			{
				this.backupDriver.paused = true;
				this.backupStage = 'stopping';
				this.backupTime = 0;
			}
			return;
		}

		if (this.backupStage === 'stopping')
		{
			if (!gone && car.collision.velocity.length() > 1.5 && this.backupTime < 2) return;
			for (const armed of this.armed)
			{
				if (armed.gunman !== undefined || armed.down) continue;
				if (armed.person.occupyingSeat !== null) armed.person.exitVehicle();
			}
			this.backupStage = 'out';
			this.backupTime = 0;
			return;
		}

		// Out of the car and on the pavement: a gun each, and after the player
		for (const armed of this.armed)
		{
			if (armed.gunman !== undefined || armed.down || armed.person.world === undefined) continue;
			let out = armed.person.occupyingSeat === null && !armed.person.isBusyWithVehicle();
			if (!out && this.backupTime < 5) continue;
			let gunman = new Gunman(this.world, { weapon: armed.weapon, hostile: true, accuracy: 0.35, sight: 50, leash: 45 });
			this.system.setMind(armed.person, gunman);
			gunman.arm();
			armed.gunman = gunman;
		}
	}

	/**
	 * A way in to the store along the streets from some way off: walked
	 * backwards from the lane outside the door, lane by lane, then turned
	 * round to be driven. Undefined if there's nowhere sensible to start.
	 */
	private routeToStore(): THREE.Vector3[]
	{
		let navigation = this.world.npcs.navigation;
		let end = nearestLane(navigation, this.store);
		if (end === undefined) return undefined;

		// Which lanes lead into each one
		let before = new Map<Lane, Lane[]>();
		for (const lane of navigation.lanes)
		{
			for (const next of lane.next)
			{
				let list = before.get(next);
				if (list === undefined)
				{
					list = [];
					before.set(next, list);
				}
				list.push(lane);
			}
		}

		let player = this.system.playerPosition();
		for (let attempt = 0; attempt < 5; attempt++)
		{
			let wanted = 120 + Math.random() * 80;
			let points: THREE.Vector3[] = [];
			let lane = end.lane;
			let distance = end.distance;
			let steps = 0;
			while (steps++ < 200)
			{
				let point = lane.sample(distance, new THREE.Vector3());
				points.push(point);
				if (Math.hypot(point.x - this.store.x, point.z - this.store.z) >= wanted) break;
				distance -= 4;
				if (distance >= 0) continue;
				// Back onto a lane that leads here, mostly the one heading further off
				let options = before.get(lane);
				if (options === undefined || options.length === 0) break;
				lane = Math.random() < 0.7 ? this.furthestStart(options) : HoldUpJob.pick(options);
				distance += lane.length;
				if (distance < 0) distance = lane.length;
			}
			if (points.length < 3) continue;
			points.reverse();

			// Some way off, not on top of the player, and not into a car already there
			let start = points[0];
			if (Math.hypot(start.x - this.store.x, start.z - this.store.z) < 60) continue;
			if (Math.hypot(start.x - player.x, start.z - player.z) < 40) continue;
			if (this.world.npcs.cars.some((car) => car.position.distanceTo(start) < 7)) continue;
			return points;
		}
		return undefined;
	}

	private furthestStart(lanes: Lane[]): Lane
	{
		let best: Lane;
		let bestDistance = -1;
		for (const lane of lanes)
		{
			let first = lane.points[0];
			let d = Math.hypot(first.x - this.store.x, first.z - this.store.z);
			if (d > bestDistance)
			{
				bestDistance = d;
				best = lane;
			}
		}
		return best;
	}

	// Where and what

	/** A shop front across town: not next door, not miles off, and not next to a gun shop. */
	private findStore(): { position: THREE.Vector3, inward: THREE.Vector3 }
	{
		let from = this.system.playerPosition();
		let guns = this.world.shops.sites.filter((site) => site.kind === 'guns');
		let land = CityPlan.LAND;
		for (let attempt = 0; attempt < 16; attempt++)
		{
			let angle = Math.random() * Math.PI * 2;
			let reach = 150 + Math.random() * 350;
			let x = THREE.MathUtils.clamp(from.x + Math.cos(angle) * reach, land.minX + 10, land.maxX - 10);
			let z = THREE.MathUtils.clamp(from.z + Math.sin(angle) * reach, land.minZ + 10, land.maxZ - 10);
			let spot = this.world.shops.storefrontSpot(new THREE.Vector2(x, z));
			if (spot === undefined) continue;
			let d = Math.hypot(spot.position.x - from.x, spot.position.z - from.z);
			if (d < 150 || d > 500) continue;
			if (guns.some((site) => Math.hypot(site.position.x - spot.position.x, site.position.z - spot.position.z) < 40)) continue;
			return spot;
		}
		return undefined;
	}

	/** The crosshair on the clerk: the camera's line through the same upright cylinder shots are tested against. */
	private onClerk(at: THREE.Vector3): boolean
	{
		let camera = this.world.camera;
		let origin = camera.getWorldPosition(new THREE.Vector3());
		let direction = camera.getWorldDirection(new THREE.Vector3());
		let dx = origin.x - at.x;
		let dz = origin.z - at.z;
		let a = direction.x * direction.x + direction.z * direction.z;
		if (a < 0.000001) return false;
		let b = 2 * (dx * direction.x + dz * direction.z);
		let c = dx * dx + dz * dz - 0.45 * 0.45;
		let discriminant = b * b - 4 * a * c;
		if (discriminant < 0) return false;
		let root = Math.sqrt(discriminant);
		let distance = (-b - root) / (2 * a);
		if (distance < 0) distance = (-b + root) / (2 * a);
		if (distance < 0) return false;
		let y = origin.y + direction.y * distance;
		return y >= at.y - 0.7 && y <= at.y + 0.8;
	}

	private addBlip(blip: Blip): Blip
	{
		this.world.blips.push(blip);
		this.blips.push(blip);
		return blip;
	}

	private removeBlip(blip: Blip): void
	{
		if (blip === undefined) return;
		let i = this.world.blips.indexOf(blip);
		if (i >= 0) this.world.blips.splice(i, 1);
		let j = this.blips.indexOf(blip);
		if (j >= 0) this.blips.splice(j, 1);
	}

	private static pick<T>(options: T[]): T
	{
		return options[Math.floor(Math.random() * options.length)];
	}
}
