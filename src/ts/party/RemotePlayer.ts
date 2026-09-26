import * as THREE from 'three';
import { HumanModel } from '../characters/HumanModel';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGLTFLoader } from '../core/Loaders';

import { Character } from '../characters/Character';
import { World } from '../world/World';
import { Vehicle } from '../vehicles/Vehicle';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { SeatType } from '../enums/SeatType';
import { IUpdatable } from '../interfaces/IUpdatable';
import { findWeapon } from '../combat/Weapons';
import { PlayerInfo } from './NetworkClient';

/**
 * Somebody else's character, driven by network updates instead of by input.
 *
 * Their own client simulates them, so physics and the state machine are both
 * switched off here. All this does is ease the model toward the last reported
 * transform and replay whichever animation they said they were playing, sit
 * them where they said they were sitting, and show their gun and their death.
 * The vehicle they drive is steered by the party session, from its own reports.
 */
export class RemotePlayer implements IUpdatable
{
	// Ahead of characters (1) and vehicles (2), so they render this frame's transform
	public updateOrder: number = 0;

	private static loader: GLTFLoader = createGLTFLoader();
	/** How quickly the model closes on where it was reported, per second. */
	private static readonly FOLLOW_RATE: number = 15;
	/** A report is carried forward by the speed it implies, but no further than this. */
	private static readonly MAX_LEAD: number = 0.15;
	/** Further than this is a respawn or a teleport, not movement, so no easing. */
	private static readonly SNAP_DISTANCE: number = 10;
	private static readonly MAX_SPEED: number = 60;

	public info: PlayerInfo;
	public character: Character;

	private world: World;
	private disposed: boolean = false;

	private targetPosition: THREE.Vector3 = new THREE.Vector3();
	private targetQuaternion: THREE.Quaternion = new THREE.Quaternion();
	private hasTarget: boolean = false;
	/** Estimated from successive reports, to lead the model into where they are now. */
	private velocity: THREE.Vector3 = new THREE.Vector3();
	private reportedAt: number;
	private animation: string;
	private life: number;
	/** Undefined until they say; null for empty handed. */
	private weaponId: string;
	/** The vehicle painted in their colour, which is only ever one they drive. */
	private paintedVehicle: Vehicle;
	/** The seat whose door they last used, for shutting it behind them. */
	private doorSeat: VehicleSeat;

	constructor(world: World, info: PlayerInfo)
	{
		this.world = world;
		this.info = info;

		// Not routed through LoadingManager on purpose, a player joining mid game
		// shouldn't drag the loading screen back over everybody's world
		RemotePlayer.loader.load(HumanModel.PLAYER, (gltf: any) =>
		{
			if (this.disposed) return;

			this.character = new Character(gltf);
			this.world.add(this.character);

			// Their client owns the simulation, this one only plays it back
			this.character.setPhysicsEnabled(false);
			this.character.charState = undefined;
			this.character.setPlayerAppearance(this.info.name, this.info.color, this.info.hat);
			this.character.networkId = this.info.id;

			if (this.hasTarget)
			{
				this.character.position.copy(this.targetPosition);
				this.character.quaternion.copy(this.targetQuaternion);
			}
		});

		this.world.registerUpdatable(this);
	}

	public setIdentity(name: string, color: string, hat?: string): void
	{
		this.info.name = name;
		this.info.color = color;
		this.info.hat = hat;

		if (this.character !== undefined)
		{
			this.character.setPlayerAppearance(name, color, hat);
		}

		if (this.paintedVehicle !== undefined) this.paintedVehicle.setPlayerTint(color);
	}

	public applyState(message: any): void
	{
		let now = performance.now() / 1000;
		let p = message.p;

		if (Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2]))
		{
			let reported = new THREE.Vector3(p[0], p[1], p[2]);

			// How fast they're going, from how far they got since the last report
			let gap = this.reportedAt !== undefined ? now - this.reportedAt : 0;
			if (this.hasTarget && gap > 0.01 && gap < 0.5)
			{
				this.velocity.subVectors(reported, this.targetPosition).divideScalar(gap);
				if (this.velocity.length() > RemotePlayer.MAX_SPEED) this.velocity.set(0, 0, 0);
			}
			else
			{
				this.velocity.set(0, 0, 0);
			}

			this.targetPosition.copy(reported);
			this.reportedAt = now;
			this.hasTarget = true;
		}

		let q = message.q;
		if (Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]) && isFinite(q[2]) && isFinite(q[3]))
		{
			this.targetQuaternion.set(q[0], q[1], q[2], q[3]).normalize();
		}

		if (this.character === undefined) return;

		// A new life means they respawned, somewhere else entirely
		let respawned = false;
		if (typeof message.l === 'number')
		{
			respawned = this.life !== undefined && message.l !== this.life;
			this.life = message.l;
			this.character.networkLife = message.l;
		}

		// Their own client owns their health; this copy only needs it to lay the
		// body down, and to stop shooting at one that's already down
		if (typeof message.h === 'number' && isFinite(message.h)) this.character.health = message.h;

		if (message.w !== undefined) this.applyWeapon(message.w);

		this.applySeat(message.v, message.s);

		if (respawned && this.character.occupyingSeat === null)
		{
			this.character.position.copy(this.targetPosition);
			this.character.quaternion.copy(this.targetQuaternion);
			this.velocity.set(0, 0, 0);
			this.character.resetDeathPose();
		}

		// After the seat, so sitting down never overrides the clip they reported
		if (typeof message.a === 'string' && message.a !== this.animation)
		{
			this.animation = message.a;
			this.character.setAnimation(message.a, 0.15);
			this.mirrorDoor(message.a);
		}
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		if (this.character === undefined || !this.hasTarget) return;

		// While seated the character's transform comes from the seat it's parented to
		if (this.character.occupyingSeat !== null) return;

		let lead = Math.min(performance.now() / 1000 - this.reportedAt, RemotePlayer.MAX_LEAD);
		let predicted = new THREE.Vector3().copy(this.targetPosition).addScaledVector(this.velocity, lead);

		if (this.character.position.distanceTo(predicted) > RemotePlayer.SNAP_DISTANCE)
		{
			this.character.position.copy(predicted);
			this.character.quaternion.copy(this.targetQuaternion);
			return;
		}

		// By the time passed rather than a fixed share per frame, which closed the
		// gap twice as fast at 60 frames a second as at 30
		let follow = 1 - Math.exp(-RemotePlayer.FOLLOW_RATE * unscaledTimeStep);

		this.character.position.lerp(predicted, follow);
		this.character.quaternion.slerp(this.targetQuaternion, follow);
	}

	/**
	 * The relay has let go of their seat claim: they've gone quiet in a
	 * background tab, or died, or left. Whoever it was, they aren't sitting
	 * there any more for anyone else's purposes.
	 */
	public seatReleased(): void
	{
		if (this.character !== undefined && this.character.occupyingSeat !== null) this.unseat();
	}

	public dispose(): void
	{
		this.disposed = true;
		this.world.unregisterUpdatable(this);

		if (this.character !== undefined)
		{
			let seat = this.character.occupyingSeat;
			if (seat !== null)
			{
				this.unpaint(seat.vehicle as unknown as Vehicle);
				this.character.leaveSeat();
			}

			// A scenario launch may have removed it already. Removing it takes it
			// off whatever it's parented to, a car included, so nobody is left
			// sitting frozen in a seat after they've gone.
			if (this.world.characters.indexOf(this.character) >= 0)
			{
				this.world.remove(this.character);
			}
			else if (this.character.parent !== null)
			{
				this.character.parent.remove(this.character);
			}

			this.character = undefined;
		}
	}

	private applyWeapon(id: any): void
	{
		let wanted: string = typeof id === 'string' ? id : null;
		if (wanted === this.weaponId) return;

		this.weaponId = wanted;

		let spec = wanted !== null ? findWeapon(wanted) : undefined;
		if (spec !== undefined) this.character.equipWeapon(spec);
		else this.character.unequipWeapon();
	}

	private applySeat(vehicleId: any, seatIndex: any): void
	{
		let wantedId: string = typeof vehicleId === 'string' ? vehicleId : null;
		let wantedIndex = (wantedId !== null && typeof seatIndex === 'number') ? seatIndex : -1;

		let seat = this.character.occupyingSeat;
		let seatVehicle = seat !== null ? (seat.vehicle as unknown as Vehicle) : undefined;
		let currentId = seatVehicle !== undefined ? seatVehicle.getNetworkId() : undefined;
		if (currentId === undefined) currentId = null;
		let currentIndex = seatVehicle !== undefined ? seatVehicle.seats.indexOf(seat) : -1;

		// The same seat, or on foot both times. The index matters as well as the
		// vehicle: sliding over into the driver's seat used to go unnoticed.
		if (currentId === wantedId && currentIndex === wantedIndex) return;

		if (wantedId === null)
		{
			this.unseat();
			return;
		}

		let vehicle = this.findVehicle(wantedId);
		let target = vehicle !== undefined ? vehicle.seats[wantedIndex] : undefined;

		// Not spawned here yet, or their own spare party car this client hasn't
		// made; the next report tries again
		if (target === undefined)
		{
			if (vehicle === undefined) this.world.spawnPartyVehicle(wantedId);
			return;
		}

		// Someone else is in it, here or by the relay's word. They stay on foot,
		// at the spot they reported, rather than being stacked into it.
		if (!this.canTake(target))
		{
			this.unseat();
			return;
		}

		if (seatVehicle === vehicle) this.shiftTo(target);
		else
		{
			this.unseat();
			this.seat(vehicle, target);
		}
	}

	private canTake(seat: VehicleSeat): boolean
	{
		// A computer driver holding their place on the grid moves out for them
		this.world.party.evictAi(seat);

		if (seat.occupiedBy !== null && seat.occupiedBy !== this.character) return false;

		let holder = this.world.party.seatHolder(seat);
		return holder === undefined || holder === this.info.id;
	}

	/**
	 * A stripped down version of Character.teleportToVehicle. The real one starts
	 * the driving state machine and rewrites the controls panel, which belongs to
	 * the local player, not to somebody being played back.
	 */
	private seat(vehicle: Vehicle, seat: VehicleSeat): void
	{
		(vehicle as unknown as THREE.Object3D).attach(this.character);

		// The same height the local seating paths use; without it they sat 0.6
		// lower than on their own screen, with their legs out under the car
		seat.getSitPosition(this.character.position);
		this.character.quaternion.copy(seat.seatPointObject.quaternion);
		this.character.occupySeat(seat);
		this.doorSeat = seat;

		if (seat.type === SeatType.Driver) this.paint(vehicle);
	}

	/** Across to another seat of the same vehicle, without leaving it. */
	private shiftTo(seat: VehicleSeat): void
	{
		let vehicle = seat.vehicle as unknown as Vehicle;

		this.character.leaveSeat();
		seat.getSitPosition(this.character.position);
		this.character.quaternion.copy(seat.seatPointObject.quaternion);
		this.character.occupySeat(seat);
		this.doorSeat = seat;

		if (seat.type === SeatType.Driver) this.paint(vehicle);
		else this.unpaint(vehicle);
	}

	private unseat(): void
	{
		let seat = this.character.occupyingSeat;
		if (seat === null) return;

		this.unpaint(seat.vehicle as unknown as Vehicle);
		this.character.leaveSeat();

		// Keeps the transform it had in the car, and eases on from there
		this.world.graphicsWorld.attach(this.character);
	}

	/** Only the driver's colour goes on a car; a passenger climbing in doesn't repaint it. */
	private paint(vehicle: Vehicle): void
	{
		this.paintedVehicle = vehicle;
		vehicle.setPlayerTint(this.info.color);
	}

	/** Back to the colour of whoever drives it now, if anyone here does. */
	private unpaint(vehicle: Vehicle): void
	{
		if (this.paintedVehicle !== vehicle) return;
		this.paintedVehicle = undefined;

		vehicle.clearPlayerTint();

		let driver = vehicle.controllingCharacter;
		if (driver !== undefined && driver.playerColor !== undefined) vehicle.setPlayerTint(driver.playerColor);
	}

	/**
	 * Opens and shuts the door they're using, which their own client does from
	 * its state machine and nothing here would otherwise touch. Getting in, the
	 * seat is the one they've claimed, since they aren't sitting in it yet.
	 */
	private mirrorDoor(clip: string): void
	{
		let opening = clip.indexOf('open_door') === 0 || clip.indexOf('stand_up') === 0;
		let closing = clip.indexOf('close_door') === 0;
		if (!opening && !closing) return;

		let seat = this.character.occupyingSeat;
		if (seat === null && opening) seat = this.world.party.seatOf(this.info.id);
		if (seat === null || seat === undefined) seat = this.doorSeat;
		if (seat === undefined || seat.door === undefined) return;

		this.doorSeat = seat;

		if (opening) seat.door.open();
		else seat.door.close();
	}

	private findVehicle(id: string): Vehicle
	{
		for (const vehicle of this.world.vehicles)
		{
			if (vehicle.getNetworkId() === id) return vehicle;
		}

		return undefined;
	}
}
