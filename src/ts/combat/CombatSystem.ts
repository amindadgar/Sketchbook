import * as THREE from 'three';
import * as CANNON from 'cannon';

import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Character } from '../characters/Character';
import { UIManager } from '../core/UIManager';
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

	private world: World;
	public pickups: WeaponPickup[] = [];

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

	constructor(world: World)
	{
		this.world = world;
		this.world.registerUpdatable(this);
		this.loadGunAudio();
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
		let context = this.world.audioListener.context;
		let length = Math.floor(context.sampleRate * 0.05);
		let buffer = context.createBuffer(1, length, context.sampleRate);
		let samples = buffer.getChannelData(0);

		for (let i = 0; i < length; i++)
		{
			let t = i / context.sampleRate;
			samples[i] = Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 90) * 0.5;
		}

		this.hitSound = new THREE.Audio(this.world.audioListener);
		this.hitSound.setBuffer(buffer);
		this.hitSound.setVolume(0.35);
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
		let character = this.world.localCharacter;
		if (character === undefined) return;

		if (character.health <= 0)
		{
			this.deathTimer -= unscaledTimeStep;
			this.spectate(character);
			if (this.deathTimer <= 0) this.respawn(character);
			UIManager.setCombatHud(0, undefined, 0, 0);
			this.setAiming(false);
			return;
		}

		this.collectPickups(character);
		this.setAiming(character.actions.secondary.isPressed === true
			&& character.weapon !== undefined
			&& character.occupyingSeat === null);
		this.updateTrigger(character, unscaledTimeStep);

		// The gun is stowed while driving, so the readout goes with it rather than
		// sitting over the windscreen advertising a trigger that does nothing
		let inHand = character.weapon !== undefined && character.occupyingSeat === null;

		UIManager.setCombatHud(
			character.health / Character.MAX_HEALTH,
			inHand ? character.weapon.name : undefined,
			character.ammo,
			character.reserve
		);
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
		// No shooting from the driver's seat, the gun is stowed while driving
		let ready = weapon !== undefined && character.occupyingSeat === null;
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

		let aim = new THREE.Vector3().copy(character.viewVector).normalize();
		let eye = new THREE.Vector3().copy(character.position).setY(character.position.y + CombatSystem.EYE_HEIGHT);
		let muzzle = character.getMuzzlePosition();

		let cone = weapon.spread * (this.aiming ? CombatSystem.AIM_SPREAD_FACTOR : 1);
		let landed = false;

		for (let i = 0; i < weapon.pellets; i++)
		{
			let direction = CombatSystem.spread(aim, cone);
			// Started ahead of the shooter so the ray can't open on their own capsule
			let origin = new THREE.Vector3().copy(eye).addScaledVector(direction, 0.7);
			let hit = this.trace(origin, direction, weapon.range, character);

			this.addTracer(muzzle, hit.point, weapon.color);

			if (hit.character !== undefined)
			{
				this.reportHit(hit.character, weapon, eye);
				landed = true;
			}
		}

		// One marker for the shot rather than one per pellet, otherwise a shotgun
		// at close range restarts it eight times and it never animates
		if (landed) this.markHit();

		this.world.cameraOperator.addRecoil(weapon.recoil);
		this.addMuzzleFlash(muzzle);
		this.playGunSound(weapon.id, muzzle);

		if (character.ammo <= 0) this.beginReload(character, weapon);

		this.world.party.publishShot(muzzle, aim, weapon.id);
	}

	/**
	 * Walls first to find how far the shot carries, then people against that.
	 *
	 * People are tested analytically rather than by raycasting the physics world,
	 * because everyone but the local player has their physics switched off: their
	 * capsule isn't in the physics world at all, so a ray could never find it.
	 */
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

	private trace(origin: THREE.Vector3, direction: THREE.Vector3, range: number, shooter?: Character):
		{ point: THREE.Vector3, character: Character }
	{
		let end = new THREE.Vector3().copy(origin).addScaledVector(direction, range);
		let reach = range;

		let result = new CANNON.RaycastResult();
		this.world.physicsWorld.raycastClosest(
			new CANNON.Vec3(origin.x, origin.y, origin.z),
			new CANNON.Vec3(end.x, end.y, end.z),
			{ collisionFilterMask: -1, collisionFilterGroup: -1, skipBackfaces: true },
			result
		);

		if (result.hasHit === true)
		{
			end.set(result.hitPointWorld.x, result.hitPointWorld.y, result.hitPointWorld.z);
			reach = origin.distanceTo(end);
		}

		let victim: Character;

		for (const character of this.world.characters)
		{
			if (character === shooter || character.health <= 0) continue;

			let distance = CombatSystem.rayHitsCharacter(origin, direction, character);
			if (distance === undefined || distance > reach) continue;

			reach = distance;
			victim = character;
		}

		if (victim !== undefined)
		{
			end = new THREE.Vector3().copy(origin).addScaledVector(direction, reach);
		}

		return { point: end, character: victim };
	}

	/**
	 * Ray against an upright cylinder standing where the character does.
	 * Returns the distance along the ray, or undefined for a miss.
	 */
	private static rayHitsCharacter(origin: THREE.Vector3, direction: THREE.Vector3, character: Character): number
	{
		const radius = 0.45;
		const below = 0.7;
		const above = 0.8;

		let dx = origin.x - character.position.x;
		let dz = origin.z - character.position.z;

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
		if (y < character.position.y - below || y > character.position.y + above) return undefined;

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

	private reportHit(target: Character, weapon: WeaponSpec, from: THREE.Vector3): void
	{
		// Their client owns their health, so it's told rather than told about
		if (target.networkId !== undefined && target !== this.world.localCharacter)
		{
			this.world.party.publishHit(target.networkId, weapon.damage, weapon.id, from);
			return;
		}

		this.applyDamage(target, weapon.damage, undefined);
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
	}

	/**
	 * A hit arriving from somebody else's client.
	 *
	 * The relay has already checked what it can, but it has never seen the map
	 * and so can't tell a clear shot from one through a wall. This client can:
	 * it holds the map, and it is the authority on where it is standing. So the
	 * last word on whether a bullet could have arrived is here.
	 */
	public takeRemoteHit(damage: number, attackerId: number, from?: THREE.Vector3, weapon?: string): void
	{
		let character = this.world.localCharacter;
		if (character === undefined || character.health <= 0) return;

		if (from !== undefined && this.behindCover(from, character)) return;

		this.lastWeapon = weapon;
		this.applyDamage(character, damage, attackerId);
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

	/** True when something solid stands between the shot and this player. */
	private behindCover(from: THREE.Vector3, character: Character): boolean
	{
		let eye = new THREE.Vector3().copy(character.position);
		eye.y += CombatSystem.EYE_HEIGHT;

		let toward = new THREE.Vector3().subVectors(eye, from);
		let distance = toward.length();
		if (distance < 1) return false;

		toward.divideScalar(distance);

		// Started clear of the shooter and stopped short of this player, so
		// neither capsule can be mistaken for a wall
		let start = new THREE.Vector3().copy(from).addScaledVector(toward, 0.7);
		let end = new THREE.Vector3().copy(eye).addScaledVector(toward, -0.7);

		let result = new CANNON.RaycastResult();
		this.world.physicsWorld.raycastClosest(
			new CANNON.Vec3(start.x, start.y, start.z),
			new CANNON.Vec3(end.x, end.y, end.z),
			{ collisionFilterMask: -1, collisionFilterGroup: -1, skipBackfaces: true },
			result
		);

		if (result.hasHit !== true) return false;

		// Both ends of the shot are a moment out of date by the time it lands, so
		// only something well short of the player counts as cover
		let blocker = new THREE.Vector3(
			result.hitPointWorld.x, result.hitPointWorld.y, result.hitPointWorld.z);

		return blocker.distanceTo(eye) > CombatSystem.COVER_SLACK;
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
			this.world.party.publishDeath(attackerId, this.lastWeapon);
			this.world.party.reportOwnDeath(attackerId, this.lastWeapon);
		}
	}

	/**
	 * Watches somebody still standing rather than a body on the floor. The
	 * killer if they can be found, otherwise whoever is nearest, and nobody at
	 * all when playing alone, in which case the view stays where it fell.
	 *
	 * This runs after the camera has already been pointed at the corpse for the
	 * frame, so the override lands one frame late, which nobody can see.
	 */
	private spectate(character: Character): void
	{
		let watched: Character;
		let nearest = Number.POSITIVE_INFINITY;

		for (const other of this.world.characters)
		{
			if (other === character || other.health <= 0) continue;

			if (other.networkId !== undefined && other.networkId === this.lastKiller)
			{
				watched = other;
				break;
			}

			let distance = other.position.distanceToSquared(character.position);
			if (distance >= nearest) continue;

			nearest = distance;
			watched = other;
		}

		UIManager.setDeathNotice(this.deathTimer, watched !== undefined ? watched.playerName : undefined);

		if (watched === undefined) return;

		watched.getWorldPosition(this.world.cameraOperator.target);
	}

	private respawn(character: Character): void
	{
		UIManager.setDeathNotice(undefined);
		this.lastKiller = undefined;
		this.lastWeapon = undefined;

		character.health = Character.MAX_HEALTH;
		character.ammo = 0;

		if (this.respawnPoints.length > 0)
		{
			let point = this.respawnPoints[Math.floor(Math.random() * this.respawnPoints.length)];
			character.setPosition(point.x, point.y + 1, point.z);
			character.resetVelocity();
		}
	}

	// ----------------------------------------------------------------- effects

	private collectPickups(character: Character): void
	{
		for (const pickup of this.pickups)
		{
			if (!pickup.covers(character.position)) continue;

			character.equipWeapon(pickup.spec);
			pickup.consume();
			this.world.progress.addPickup();
			this.world.notices.say('Picked up ' + pickup.spec.name);
			break;
		}
	}

	/** Shows somebody else's shot: their flash and their tracer. */
	public showRemoteShot(from: THREE.Vector3, direction: THREE.Vector3, weaponId: string): void
	{
		let weapon = findWeapon(weaponId);
		if (weapon === undefined) return;

		let hit = this.trace(from, direction, weapon.range);
		this.addMuzzleFlash(from);
		this.addTracer(from, hit.point, weapon.color);
		this.playGunSound(weaponId, from);
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

		this.world.effects.add(sprite, 0.06);

		let light = new THREE.PointLight(0xffaa44, 2.6, 7);
		light.position.copy(position);
		this.world.effects.add(light, 0.06);
	}

	private addTracer(from: THREE.Vector3, to: THREE.Vector3, color: string): void
	{
		let length = from.distanceTo(to);
		if (length < 0.01) return;

		let geometry = new THREE.CylinderGeometry(0.015, 0.015, length, 5, 1, true);
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

		this.world.effects.add(tracer, 0.07);
	}
}
