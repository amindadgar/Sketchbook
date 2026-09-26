import * as THREE from 'three';
import { Pedestrian } from '../npc/Pedestrian';
import * as CANNON from 'cannon';

import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Character } from '../characters/Character';
import { Vehicle } from '../vehicles/Vehicle';
import { UIManager } from '../core/UIManager';
import { CollisionGroups } from '../enums/CollisionGroups';
import { WEAPONS, WeaponSpec, findWeapon, getFlashTexture } from './Weapons';
import { WeaponPickup } from './WeaponPickup';

/**
 * Guns, health and kills.
 *
 * Every client is the authority on its own health, matching how the rest of the
 * party layer already works. A shooter reports the hit, the player who was hit
 * decides what it did to them, and their death is what awards the point. That
 * keeps one owner per number instead of two clients disagreeing about it.
 */
export class CombatSystem implements IUpdatable
{
	public updateOrder: number = 14;

	private static readonly RESPAWN_DELAY: number = 3;
	private static readonly EYE_HEIGHT: number = 0.6;
	/** Aiming is worth something beyond the view: shots land tighter. */
	private static readonly AIM_SPREAD_FACTOR: number = 0.35;
	/**
	 * What a run of kills is called, and where it stops being called anything.
	 * The reward is a magazine of spare rounds, which is help rather than a
	 * head start: a streak that armed the leader properly would end the round.
	 */
	private static readonly STREAK_REWARDS: { [count: number]: string } = {
		3: 'On a roll', 5: 'Rampage', 7: 'Unstoppable', 10: 'Godlike'
	};
	/** How near a wall has to be to the player before it counts as their cover. */
	private static readonly COVER_SLACK: number = 1.5;
	/**
	 * Hits from other players are ignored for this long after coming back, so
	 * nobody is shot as they appear, and a burst aimed at the body they left
	 * doesn't follow them to the spawn point.
	 */
	private static readonly SPAWN_PROTECTION: number = 1.5;
	/** Shortest gap between two respawns asked for in a party, so Shift+R isn't a teleport. */
	private static readonly RESPAWN_COOLDOWN: number = 3;
	/** One shotgun blast is eight confirmations arriving together; they light one marker. */
	private static readonly MARKER_GAP: number = 0.06;
	private static readonly FLASH_INTENSITY: number = 2.6;
	private static readonly FLASH_LIFE: number = 0.06;

	private static scratch: THREE.Vector3 = new THREE.Vector3();

	private world: World;
	public pickups: WeaponPickup[] = [];
	/**
	 * Which life the local player is on. It goes out with every movement update
	 * and comes back on the hits aimed at them, so a hit meant for a life that
	 * has ended is recognisable when it arrives.
	 */
	public life: number = 0;

	private cooldown: number = 0;
	private reloadTimer: number = 0;
	private triggerWasDown: boolean = false;
	private deathTimer: number = 0;
	/** Who to watch while down, when the shot came from someone in the party. */
	private lastKiller: number;
	private lastWeapon: string;
	/** Kills since last dying. Announced at three, five, seven and ten. */
	private streak: number = 0;
	private aiming: boolean = false;
	private respawnPoints: THREE.Vector3[] = [];
	private gunBuffers: { [id: string]: AudioBuffer } = {};
	private audioPool: THREE.PositionalAudio[] = [];
	private audioCursor: number = 0;
	private hitSound: THREE.Audio;
	private hurtSound: THREE.Audio;
	/**
	 * A fixed pair of lights reused by every muzzle flash. Adding and removing
	 * a light changes the light count, which makes three.js rebuild the program
	 * of every lit material in the scene: a hitch on every shot in a fight.
	 */
	private flashLights: THREE.PointLight[] = [];
	private flashLife: number[] = [];
	private flashCursor: number = 0;
	private protection: number = 0;
	private respawnCooldown: number = 0;
	private markerCooldown: number = 0;
	/** Died while in or getting into a vehicle; they're pulled out next update. */
	private pendingEject: boolean = false;
	/** The local character this was last looking after, to notice it being replaced. */
	private knownCharacter: Character;

	constructor(world: World)
	{
		this.world = world;
		this.world.registerUpdatable(this);
		this.loadGunAudio();
		this.createFlashLights();
	}

	/**
	 * One buffer per weapon, played through a small pool of positional nodes.
	 * The automatic fires twelve times a second, and building and discarding a
	 * dozen audio nodes a second to keep up with it would be silly.
	 */
	private loadGunAudio(): void
	{
		let loader = new THREE.AudioLoader();

		WEAPONS.forEach((weapon) =>
		{
			loader.load('build/assets/gun_' + weapon.id + '.wav',
				(buffer: AudioBuffer) =>
				{
					this.gunBuffers[weapon.id] = buffer;
				},
				undefined,
				() =>
				{
					console.warn('Couldn\'t load the gun sound for ' + weapon.id + '.');
				});
		});

		for (let i = 0; i < 8; i++)
		{
			let sound = new THREE.PositionalAudio(this.world.audioListener);
			sound.setRefDistance(14);
			sound.setRolloffFactor(1.4);
			this.world.graphicsWorld.add(sound);
			this.audioPool.push(sound);
		}
	}

	/** Made once, while the world is still loading, so the shaders account for them from the start. */
	private createFlashLights(): void
	{
		for (let i = 0; i < 2; i++)
		{
			let light = new THREE.PointLight(0xffaa44, 0, 7);
			this.world.graphicsWorld.add(light);
			this.flashLights.push(light);
			this.flashLife.push(0);
		}
	}

	private playGunSound(weaponId: string, position: THREE.Vector3): void
	{
		let buffer = this.gunBuffers[weaponId];
		if (buffer === undefined || this.audioPool.length === 0) return;

		let sound = this.audioPool[this.audioCursor];
		this.audioCursor = (this.audioCursor + 1) % this.audioPool.length;

		if (sound.isPlaying) sound.stop();

		sound.position.copy(position);
		sound.setBuffer(buffer);
		sound.play();
		// The panner only follows the matrix while playing, so move it after
		sound.updateMatrixWorld(true);
	}

	/**
	 * The click that says a shot landed. Synthesised rather than shipped: it's
	 * two hundredths of a second of decaying tone, which is a strange thing to
	 * make the player download.
	 */
	private buildHitSound(): void
	{
		this.hitSound = this.synthesise(0.05, 0.35, (t) => Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 90) * 0.5);
	}

	/** A low thump for being hit, made the same way as the hit click. */
	private buildHurtSound(): void
	{
		this.hurtSound = this.synthesise(0.14, 0.5, (t) =>
			(Math.sin(2 * Math.PI * 140 * t) + 0.35 * Math.sin(2 * Math.PI * 67 * t)) * Math.exp(-t * 28) * 0.55);
	}

	private synthesise(seconds: number, volume: number, wave: (t: number) => number): THREE.Audio
	{
		let context = this.world.audioListener.context;
		let length = Math.floor(context.sampleRate * seconds);
		let buffer = context.createBuffer(1, length, context.sampleRate);
		let samples = buffer.getChannelData(0);

		for (let i = 0; i < length; i++)
		{
			samples[i] = wave(i / context.sampleRate);
		}

		let sound = new THREE.Audio(this.world.audioListener);
		sound.setBuffer(buffer);
		sound.setVolume(volume);
		return sound;
	}

	private markHit(): void
	{
		UIManager.flashHitMarker();

		if (this.hitSound === undefined) this.buildHitSound();
		if (this.hitSound.isPlaying) this.hitSound.stop();
		this.hitSound.play();
	}

	public setRespawnPoints(points: THREE.Vector3[]): void
	{
		this.respawnPoints = points;
	}

	/** One weapon per anchor, cycling the types so no corner is all shotguns. */
	public placePickups(anchors: THREE.Vector3[]): void
	{
		this.pickups.forEach((pickup) => pickup.dispose());
		this.pickups = [];

		anchors.forEach((anchor, index) =>
		{
			this.pickups.push(new WeaponPickup(this.world, WEAPONS[index % WEAPONS.length], anchor));
		});
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		this.fadeFlashLights(unscaledTimeStep);
		if (this.protection > 0) this.protection -= unscaledTimeStep;
		if (this.respawnCooldown > 0) this.respawnCooldown -= unscaledTimeStep;
		if (this.markerCooldown > 0) this.markerCooldown -= unscaledTimeStep;

		let character = this.world.localCharacter;
		if (character !== this.knownCharacter) this.onCharacterReplaced(character);
		if (character === undefined) return;

		// Out here rather than where the death happened: a crash kills from
		// inside the physics step, which is no place to add a body back to it
		if (this.pendingEject)
		{
			this.pendingEject = false;
			character.forceLeaveVehicle();
		}

		if (character.health <= 0)
		{
			this.deathTimer -= unscaledTimeStep;
			this.spectate(character);
			if (this.deathTimer <= 0) this.respawn(character);
			UIManager.setCombatHud(0, undefined, 0, 0);
			this.setAiming(false);
			return;
		}

		// No guns while in a car, or climbing into or out of one
		let onFoot = !character.isBusyWithVehicle();

		if (onFoot) this.collectPickups(character);
		this.setAiming(character.actions.secondary.isPressed === true
			&& character.weapon !== undefined
			&& onFoot);
		this.updateTrigger(character, unscaledTimeStep);

		// The gun is stowed while driving, so the readout goes with it rather than
		// sitting over the windscreen advertising a trigger that does nothing
		let inHand = character.weapon !== undefined && onFoot;

		UIManager.setCombatHud(
			character.health / Character.MAX_HEALTH,
			inHand ? character.weapon.name : undefined,
			character.ammo,
			character.reserve
		);
	}

	/**
	 * A new local character: a scenario launch, or the player's own restart.
	 * Whatever was going on with the last one, a countdown to respawning, a
	 * camera on the killer, a reload, is over, and the new one is a new life.
	 */
	private onCharacterReplaced(character: Character): void
	{
		this.knownCharacter = character;

		this.deathTimer = 0;
		this.lastKiller = undefined;
		this.lastWeapon = undefined;
		this.pendingEject = false;
		this.cooldown = 0;
		this.reloadTimer = 0;
		this.triggerWasDown = false;
		this.setAiming(false);
		this.world.cameraOperator.spectateTarget = undefined;
		UIManager.setDeathNotice(undefined);

		if (character !== undefined)
		{
			this.life++;
			this.protection = CombatSystem.SPAWN_PROTECTION;
		}
	}

	// ---------------------------------------------------------------- shooting

	/** Held right button, but only with a gun in hand and out of a vehicle. */
	private setAiming(value: boolean): void
	{
		if (this.aiming === value) return;

		this.aiming = value;
		this.world.cameraOperator.aiming = value;
		UIManager.setReticleVisible(value);
	}

	private updateTrigger(character: Character, timeStep: number): void
	{
		if (this.cooldown > 0) this.cooldown -= timeStep;

		if (this.reloadTimer > 0)
		{
			this.reloadTimer -= timeStep;
			if (this.reloadTimer <= 0) this.finishReload(character);
		}

		let weapon = character.weapon;

		// Aiming holds the gun up along the line of the camera
		if (this.aiming && weapon !== undefined)
		{
			character.aimUntil = Math.max(character.aimUntil, performance.now() / 1000 + 0.15);
			this.world.camera.getWorldDirection(character.aimAlong);
		}

		// Not from the driver's seat, and not halfway through a car door either,
		// where the character belongs to the car and its own position is local
		let ready = weapon !== undefined && !character.isBusyWithVehicle();
		let down = character.actions.primary.isPressed === true;

		if (ready && down && this.cooldown <= 0 && this.reloadTimer <= 0)
		{
			// A held trigger only repeats for the automatic
			if (weapon.automatic || !this.triggerWasDown)
			{
				if (character.ammo > 0) this.fire(character, weapon);
				else this.beginReload(character, weapon);
			}
		}

		this.triggerWasDown = down;
	}

	private fire(character: Character, weapon: WeaponSpec): void
	{
		character.ammo--;
		this.cooldown = weapon.fireInterval;

		let eye = character.getWorldPosition(new THREE.Vector3());
		eye.y += CombatSystem.EYE_HEIGHT;

		let aim = this.aimDirection(character, eye, weapon);
		let muzzle = character.getMuzzlePosition();

		let cone = weapon.spread * (this.aiming ? CombatSystem.AIM_SPREAD_FACTOR : 1);
		let landed = false;
		let ends: THREE.Vector3[] = [];

		for (let i = 0; i < weapon.pellets; i++)
		{
			let direction = CombatSystem.spread(aim, cone);
			// From the eye itself: starting further along let a player with
			// their back to a wall, or their face against one, shoot through it.
			// Capsules are left out of the physics ray, so the shooter's own
			// can't catch it; people are tested against the ray separately.
			let hit = this.trace(eye, direction, weapon.range, character);

			this.addTracer(muzzle, hit.point, weapon.color, false);
			ends.push(hit.point);

			if (hit.character !== undefined && this.reportHit(hit.character, weapon, eye)) landed = true;
			if (hit.pedestrian !== undefined)
			{
				this.world.npcs.damagePedestrian(hit.pedestrian.id, weapon.damage, eye);
				landed = true;
			}
		}

		// Everyone in earshot runs for it
		if (this.world.npcs !== undefined) this.world.npcs.onGunshot(eye);

		// The arm stays up a moment after the shot
		character.aimUntil = performance.now() / 1000 + 1.2;
		character.aimAlong.copy(aim);

		// One marker for the shot rather than one per pellet, otherwise a shotgun
		// at close range restarts it eight times and it never animates
		if (landed) this.markHit();

		// Turned to face the shot, so the gun on everyone else's screen points
		// the way the tracer goes
		let flat = new THREE.Vector3(aim.x, 0, aim.z);
		if (flat.lengthSq() > 0.0001) character.setOrientation(flat);

		this.world.cameraOperator.addRecoil(weapon.recoil);
		this.addMuzzleFlash(muzzle);
		this.playGunSound(weapon.id, muzzle);

		if (character.ammo <= 0) this.beginReload(character, weapon);

		this.world.party.publishShot(muzzle, aim, weapon.id, ends);
	}

	/**
	 * Toward whatever is under the crosshair.
	 *
	 * The crosshair is the middle of the screen, which is the camera's line of
	 * sight, and while aiming the camera slides over a shoulder. Firing along
	 * the line from the camera to the character, as this used to, put every
	 * aimed shot about twenty degrees to the side of the reticle. So the camera's
	 * own line is traced to find what it's on, and the shot goes from the eye to
	 * that. The trace starts level with the shooter, so nothing standing behind
	 * them, between them and the camera, can catch it.
	 */
	private aimDirection(character: Character, eye: THREE.Vector3, weapon: WeaponSpec): THREE.Vector3
	{
		let camera = this.world.camera;
		let from = camera.getWorldPosition(new THREE.Vector3());
		let forward = camera.getWorldDirection(new THREE.Vector3());

		let along = Math.max(0, new THREE.Vector3().subVectors(eye, from).dot(forward));
		let start = from.addScaledVector(forward, along);

		let target = this.trace(start, forward, weapon.range, character).point;
		let direction = target.sub(eye);

		// Pressed up against something, the line from the eye can point anywhere
		if (direction.length() < 1) return forward;

		return direction.normalize();
	}

	/** Nothing left to load means the gun is spent, so it's dropped. */
	private beginReload(character: Character, weapon: WeaponSpec): void
	{
		if (character.reserve <= 0)
		{
			character.unequipWeapon();
			return;
		}

		this.reloadTimer = weapon.reloadTime;
	}

	private finishReload(character: Character): void
	{
		if (character.weapon === undefined) return;

		let wanted = character.weapon.magazine - character.ammo;
		let taken = Math.min(wanted, character.reserve);

		character.ammo += taken;
		character.reserve -= taken;

		if (character.ammo <= 0) character.unequipWeapon();
	}

	/**
	 * Walls first to find how far the shot carries, then people against that.
	 *
	 * People are tested analytically rather than by raycasting the physics world,
	 * because everyone but the local player has their physics switched off: their
	 * capsule isn't in the physics world at all, so a ray could never find it.
	 *
	 * Every surface along the ray is collected rather than just the first,
	 * because the first is the car body when the target is sitting inside a car.
	 * Their own car doesn't shield them; anything else in the way still does.
	 */
	private trace(origin: THREE.Vector3, direction: THREE.Vector3, range: number, shooter?: Character):
		{ point: THREE.Vector3, character: Character, pedestrian?: Pedestrian }
	{
		let end = new THREE.Vector3().copy(origin).addScaledVector(direction, range);

		let hits: { distance: number, body: CANNON.Body }[] = [];
		this.world.physicsWorld.raycastAll(
			new CANNON.Vec3(origin.x, origin.y, origin.z),
			new CANNON.Vec3(end.x, end.y, end.z),
			// Pedestrians' bodies are only there to be bumped into; they're tested below
			// tslint:disable-next-line: no-bitwise
			{ collisionFilterMask: ~(CollisionGroups.Characters | CollisionGroups.Pedestrians), collisionFilterGroup: -1, skipBackfaces: true },
			(result: CANNON.RaycastResult) =>
			{
				// The result object is reused for every hit, so it's copied out
				hits.push({ distance: result.distance, body: result.body });
			}
		);

		// Unordered as they come
		let wall = range;
		for (const hit of hits) wall = Math.min(wall, hit.distance);

		let victim: Character;
		let reach = wall;

		for (const character of this.world.characters)
		{
			if (character === shooter || character.health <= 0) continue;

			let distance = CombatSystem.rayHitsCharacter(origin, direction, character);
			if (distance === undefined || distance > range) continue;
			if (victim !== undefined && distance >= reach) continue;

			let ownVehicle = CombatSystem.vehicleBodyOf(character);
			let blocked = false;

			for (const hit of hits)
			{
				if (hit.distance < distance && hit.body !== ownVehicle)
				{
					blocked = true;
					break;
				}
			}

			if (blocked) continue;

			reach = distance;
			victim = character;
		}

		// The city's pedestrians, the same way, behind the same walls
		let pedestrian: Pedestrian;
		if (this.world.npcs !== undefined)
		{
			let npc = this.world.npcs.rayHitsPedestrian(origin, direction, range);
			if (npc !== undefined && npc.distance < reach && !hits.some((hit) => hit.distance < npc.distance))
			{
				reach = npc.distance;
				victim = undefined;
				pedestrian = npc.pedestrian;
			}
		}

		return { point: new THREE.Vector3().copy(origin).addScaledVector(direction, reach), character: victim, pedestrian: pedestrian };
	}

	/** The body of the vehicle a character sits in or is climbing into, if any. */
	private static vehicleBodyOf(character: Character): CANNON.Body
	{
		if (character.occupyingSeat !== null)
		{
			return (character.occupyingSeat.vehicle as unknown as Vehicle).collision;
		}

		let parent = character.parent as any;
		if (parent !== null && parent.collision instanceof CANNON.Body) return parent.collision;

		return undefined;
	}

	/**
	 * Ray against an upright cylinder standing where the character does.
	 * Returns the distance along the ray, or undefined for a miss. Measured at
	 * the world position: a seated character belongs to its car, and its own
	 * position is only where in the car it is.
	 */
	private static rayHitsCharacter(origin: THREE.Vector3, direction: THREE.Vector3, character: Character): number
	{
		const radius = 0.45;
		const below = 0.7;
		const above = 0.8;

		let at = character.getWorldPosition(CombatSystem.scratch);

		let dx = origin.x - at.x;
		let dz = origin.z - at.z;

		let a = direction.x * direction.x + direction.z * direction.z;
		if (a < 0.000001) return undefined;

		let b = 2 * (dx * direction.x + dz * direction.z);
		let c = dx * dx + dz * dz - radius * radius;

		let discriminant = b * b - 4 * a * c;
		if (discriminant < 0) return undefined;

		let root = Math.sqrt(discriminant);
		let distance = (-b - root) / (2 * a);
		if (distance < 0) distance = (-b + root) / (2 * a);
		if (distance < 0) return undefined;

		let y = origin.y + direction.y * distance;
		if (y < at.y - below || y > at.y + above) return undefined;

		return distance;
	}

	/** Random direction inside a cone, so a spread weapon doesn't fire a line. */
	private static spread(aim: THREE.Vector3, amount: number): THREE.Vector3
	{
		if (amount <= 0) return aim.clone();

		let angle = Math.random() * Math.PI * 2;
		let radius = Math.sqrt(Math.random()) * amount;

		let side = new THREE.Vector3(0, 1, 0).cross(aim).normalize();
		if (side.lengthSq() < 0.001) side.set(1, 0, 0);
		let up = new THREE.Vector3().crossVectors(aim, side).normalize();

		return aim.clone()
			.addScaledVector(side, Math.cos(angle) * radius)
			.addScaledVector(up, Math.sin(angle) * radius)
			.normalize();
	}

	// ------------------------------------------------------------------ damage

	/**
	 * Returns whether the hit marker should show right away. For someone in
	 * the party it waits for their client to say the hit counted, since the
	 * relay or their cover check can still turn it down, and a marker for a hit
	 * that did nothing is exactly what "my shots don't register" looks like.
	 */
	private reportHit(target: Character, weapon: WeaponSpec, from: THREE.Vector3): boolean
	{
		// Their client owns their health, so it's told rather than told about
		if (target.networkId !== undefined && target !== this.world.localCharacter)
		{
			this.world.party.publishHit(target.networkId, weapon.damage, weapon.id, from, target.networkLife);

			// An older relay can't carry the answer back, so guess as before
			return !this.world.party.hasFeature('hurt');
		}

		this.applyDamage(target, weapon.damage, undefined);
		return true;
	}

	/** The player we shot says it counted. */
	public confirmHit(dead: boolean): void
	{
		if (this.markerCooldown > 0) return;

		this.markerCooldown = CombatSystem.MARKER_GAP;
		this.markHit();
	}

	/**
	 * Damage from driving into something, rather than from being shot. Nobody
	 * gets the point for it, so there's no attacker to name.
	 */
	public applyCrashDamage(damage: number): void
	{
		let character = this.world.localCharacter;
		if (character === undefined || character.health <= 0) return;

		this.applyDamage(character, damage, undefined);
		UIManager.flashDamage();
	}

	/**
	 * A hit arriving from somebody else's client.
	 *
	 * The relay has already checked what it can, but it has never seen the map
	 * and so can't tell a clear shot from one through a wall. This client can:
	 * it holds the map, and it is the authority on where it is standing. So the
	 * last word on whether a bullet could have arrived is here.
	 */
	public takeRemoteHit(damage: number, attackerId: number, from?: THREE.Vector3, weapon?: string, life?: number): void
	{
		let character = this.world.localCharacter;
		if (character === undefined || character.health <= 0) return;

		// Just back, or aimed at the life before this one
		if (this.protection > 0) return;
		if (life !== undefined && life !== this.life) return;

		if (from !== undefined && this.behindCover(from, character)) return;

		this.lastWeapon = weapon;
		this.applyDamage(character, damage, attackerId);

		// Tells the shooter it counted, which is what lights their hit marker
		this.world.party.publishHurt(attackerId, damage, character.health <= 0);
		this.feelHit(character, from);
	}

	/** The red at the edges, a wedge toward the shooter, and a thump. */
	private feelHit(character: Character, from?: THREE.Vector3): void
	{
		let angle: number;

		if (from !== undefined)
		{
			let toward = new THREE.Vector3().subVectors(from, character.getWorldPosition(new THREE.Vector3()));
			let forward = this.world.camera.getWorldDirection(new THREE.Vector3());
			// The camera's right, on the ground plane
			let right = new THREE.Vector3(-forward.z, 0, forward.x);
			forward.y = 0;

			if (toward.lengthSq() > 0.0001 && forward.lengthSq() > 0.0001)
			{
				angle = Math.atan2(toward.dot(right), toward.dot(forward));
			}
		}

		UIManager.flashDamage(angle);

		if (this.hurtSound === undefined) this.buildHurtSound();
		if (this.hurtSound.isPlaying) this.hurtSound.stop();
		this.hurtSound.play();
	}

	/**
	 * A kill by the local player, learned from the room rather than claimed:
	 * the client that died is the one that reports it, so this is the first
	 * this client hears of it.
	 */
	public creditKill(): void
	{
		this.streak++;
		this.world.progress.addKill();

		let reward = CombatSystem.STREAK_REWARDS[this.streak];
		if (reward === undefined) return;

		this.world.notices.say(reward, 'good', this.streak + ' in a row');

		// Something small enough that being ahead doesn't run away with the round
		let character = this.world.localCharacter;
		if (character !== undefined && character.weapon !== undefined)
		{
			character.reserve += character.weapon.magazine;
		}
	}

	/**
	 * True when something solid stands between the shot and this player, at
	 * both head and chest height: one of them showing over a low wall is still
	 * a clear shot.
	 *
	 * Only fixed scenery counts. Cars and their doors are simulated by every
	 * client separately, so a parked car can be somewhere else on this screen
	 * than on the shooter's; the shooter's own trace already stops at the cars
	 * it could see.
	 */
	private behindCover(from: THREE.Vector3, character: Character): boolean
	{
		let body = character.getWorldPosition(new THREE.Vector3());

		let head = body.clone();
		head.y += CombatSystem.EYE_HEIGHT;
		let chest = body.clone();
		chest.y += 0.1;

		return this.blockedBetween(from, head) && this.blockedBetween(from, chest);
	}

	private blockedBetween(from: THREE.Vector3, point: THREE.Vector3): boolean
	{
		let toward = new THREE.Vector3().subVectors(point, from);
		let distance = toward.length();
		if (distance < 1) return false;

		toward.divideScalar(distance);

		// From the shooter's eye, whose capsule isn't in this physics world, and
		// stopped short of this player so their own capsule isn't mistaken for a wall
		let end = new THREE.Vector3().copy(point).addScaledVector(toward, -0.7);

		let nearest = Number.POSITIVE_INFINITY;
		this.world.physicsWorld.raycastAll(
			new CANNON.Vec3(from.x, from.y, from.z),
			new CANNON.Vec3(end.x, end.y, end.z),
			// Pedestrians' bodies are only there to be bumped into; they're tested below
			// tslint:disable-next-line: no-bitwise
			{ collisionFilterMask: ~(CollisionGroups.Characters | CollisionGroups.Pedestrians), collisionFilterGroup: -1, skipBackfaces: true },
			(result: CANNON.RaycastResult) =>
			{
				if (result.body.mass === 0) nearest = Math.min(nearest, result.distance);
			}
		);

		if (nearest === Number.POSITIVE_INFINITY) return false;

		// Both ends of the shot are a moment out of date by the time it lands, so
		// only something well short of the player counts as cover
		return distance - nearest > CombatSystem.COVER_SLACK;
	}

	private applyDamage(target: Character, damage: number, attackerId: number): void
	{
		if (target.health <= 0) return;

		target.health = Math.max(0, target.health - damage);

		if (target.health > 0) return;

		if (target === this.world.localCharacter)
		{
			this.deathTimer = CombatSystem.RESPAWN_DELAY;
			this.lastKiller = attackerId;
			this.streak = 0;
			// Whatever was held at the moment of death stays held otherwise, and
			// the body walks off under its own steam
			target.resetControls();
			target.unequipWeapon();
			// Dead at the wheel, the body comes out of the car rather than
			// driving on or respawning in the car's own coordinates
			if (target.isBusyWithVehicle()) this.pendingEject = true;
			this.world.party.publishDeath(attackerId, this.lastWeapon);
			this.world.party.reportOwnDeath(attackerId, this.lastWeapon);
		}
	}

	/**
	 * Watches somebody still standing rather than a body on the floor. The
	 * killer if they can be found, otherwise whoever is nearest, and nobody at
	 * all when playing alone, in which case the view stays where it fell.
	 */
	private spectate(character: Character): void
	{
		let watched: Character;
		let nearest = Number.POSITIVE_INFINITY;
		let here = character.getWorldPosition(new THREE.Vector3());

		for (const other of this.world.characters)
		{
			if (other === character || other.health <= 0) continue;

			if (other.networkId !== undefined && other.networkId === this.lastKiller)
			{
				watched = other;
				break;
			}

			let distance = other.getWorldPosition(CombatSystem.scratch).distanceToSquared(here);
			if (distance >= nearest) continue;

			nearest = distance;
			watched = other;
		}

		UIManager.setDeathNotice(this.deathTimer, watched !== undefined ? watched.playerName : undefined);
		this.world.cameraOperator.spectateTarget = watched;
	}

	private respawn(character: Character): void
	{
		UIManager.setDeathNotice(undefined);
		this.lastKiller = undefined;
		this.lastWeapon = undefined;

		character.health = Character.MAX_HEALTH;
		character.ammo = 0;

		this.placeAtRespawnPoint(character);
		this.protection = CombatSystem.SPAWN_PROTECTION;
	}

	/**
	 * Shift+R in a party: back to a spawn point, alone. Health and the gun come
	 * along unchanged, so it gets someone unstuck without being a free heal
	 * mid fight, and there's a short wait between uses.
	 */
	public respawnNow(): void
	{
		let character = this.world.localCharacter;
		if (character === undefined || character.health <= 0) return;

		if (this.respawnCooldown > 0)
		{
			this.world.notices.say('Wait a moment before respawning again');
			return;
		}

		this.respawnCooldown = CombatSystem.RESPAWN_COOLDOWN;
		this.placeAtRespawnPoint(character);
	}

	private placeAtRespawnPoint(character: Character): void
	{
		this.world.cameraOperator.spectateTarget = undefined;
		this.pendingEject = false;

		// Out of any car first: with physics off, a position is in the car's own space
		character.forceLeaveVehicle();

		if (this.respawnPoints.length > 0)
		{
			// Somewhere near where they fell, so dying downtown doesn't mean a
			// drive back from the island
			let here = character.getWorldPosition(new THREE.Vector3());
			let nearby = this.respawnPoints.slice()
				.sort((a, b) => a.distanceToSquared(here) - b.distanceToSquared(here))
				.slice(0, 8);
			let point = nearby[Math.floor(Math.random() * nearby.length)];
			character.setPosition(point.x, point.y + 1, point.z);
			character.resetVelocity();
		}

		// Anything still in flight was aimed at where they were
		this.life++;
	}

	// ----------------------------------------------------------------- effects

	private collectPickups(character: Character): void
	{
		let here = character.getWorldPosition(CombatSystem.scratch);

		for (let i = 0; i < this.pickups.length; i++)
		{
			let pickup = this.pickups[i];
			if (!pickup.covers(here)) continue;

			character.equipWeapon(pickup.spec);
			pickup.consume();
			this.world.party.publishPickup(i);
			this.world.progress.addPickup();
			this.world.notices.say('Picked up ' + pickup.spec.name);
			break;
		}
	}

	/** Somebody else took this one, so it goes dark here too. */
	public remotePickup(index: number): void
	{
		let pickup = this.pickups[index];
		if (pickup !== undefined && pickup.available) pickup.consume();
	}

	/**
	 * Shows somebody else's shot: their flash and their tracers.
	 *
	 * Drawn to where their pellets actually ended when they said, rather than
	 * traced again here from a slightly different place against a slightly
	 * different world, which could show a hit passing beside the person it hit.
	 * Only traced when there are no end points, and then never against the
	 * shooter's own body, which the barrel starts inside.
	 */
	public showRemoteShot(from: THREE.Vector3, direction: THREE.Vector3, weaponId: string,
		shooter?: Character, endpoints?: THREE.Vector3[]): void
	{
		let weapon = findWeapon(weaponId);
		if (weapon === undefined) return;

		this.addMuzzleFlash(from);
		this.playGunSound(weaponId, from);

		// Their arm comes up along the shot on this screen too
		if (shooter !== undefined)
		{
			shooter.aimUntil = performance.now() / 1000 + 1.2;
			shooter.aimAlong.copy(direction).normalize();
		}

		if (endpoints !== undefined && endpoints.length > 0)
		{
			for (const end of endpoints)
			{
				if (!isFinite(end.x) || !isFinite(end.y) || !isFinite(end.z)) continue;

				let point = end.clone();
				if (from.distanceTo(point) > weapon.range + 5)
				{
					point.sub(from).setLength(weapon.range).add(from);
				}

				this.addTracer(from, point, weapon.color, true);
			}

			return;
		}

		let hit = this.trace(from, direction, weapon.range, shooter);
		this.addTracer(from, hit.point, weapon.color, true);
	}

	private addMuzzleFlash(position: THREE.Vector3): void
	{
		let sprite = new THREE.Sprite(new THREE.SpriteMaterial({
			map: getFlashTexture(),
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			transparent: true
		}));
		sprite.position.copy(position);
		// Varied per shot, otherwise repeat fire looks like a stuck frame
		sprite.scale.setScalar(0.28 + Math.random() * 0.16);

		this.world.effects.add(sprite, CombatSystem.FLASH_LIFE);

		let index = this.flashCursor;
		this.flashCursor = (this.flashCursor + 1) % this.flashLights.length;

		this.flashLights[index].position.copy(position);
		this.flashLights[index].intensity = CombatSystem.FLASH_INTENSITY;
		this.flashLife[index] = CombatSystem.FLASH_LIFE;
	}

	private fadeFlashLights(timeStep: number): void
	{
		for (let i = 0; i < this.flashLights.length; i++)
		{
			if (this.flashLife[i] <= 0) continue;

			this.flashLife[i] = Math.max(0, this.flashLife[i] - timeStep);
			this.flashLights[i].intensity = CombatSystem.FLASH_INTENSITY * this.flashLife[i] / CombatSystem.FLASH_LIFE;
		}
	}

	/**
	 * Someone else's are drawn thicker and left up a little longer: a tracer is
	 * how the player being shot at finds out where from, and a hairline gone in
	 * four frames was easy to miss entirely.
	 */
	private addTracer(from: THREE.Vector3, to: THREE.Vector3, color: string, remote: boolean): void
	{
		let length = from.distanceTo(to);
		if (length < 0.01) return;

		let radius = remote ? 0.03 : 0.015;
		let geometry = new THREE.CylinderGeometry(radius, radius, length, 5, 1, true);
		// Cylinders stand up the Y axis, so lay it along the shot and move its
		// midpoint to halfway between the two ends
		geometry.translate(0, length / 2, 0);
		geometry.rotateX(Math.PI / 2);

		let tracer = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
			color: new THREE.Color(color),
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		}));
		tracer.position.copy(from);
		tracer.lookAt(to);

		this.world.effects.add(tracer, remote ? 0.12 : 0.07);
	}
}
