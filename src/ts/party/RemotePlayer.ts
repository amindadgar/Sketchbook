import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

import { Character } from '../characters/Character';
import { World } from '../world/World';
import { Vehicle } from '../vehicles/Vehicle';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { IUpdatable } from '../interfaces/IUpdatable';
import { PlayerInfo } from './NetworkClient';

/**
 * Somebody else's character, driven by network updates instead of by input.
 *
 * Their own client simulates them, so physics and the state machine are both
 * switched off here. All this does is ease the model toward the last reported
 * transform and replay whichever animation they said they were playing.
 */
export class RemotePlayer implements IUpdatable
{
	// Ahead of characters (1) and vehicles (2), so they render this frame's transform
	public updateOrder: number = 0;

	private static loader: GLTFLoader = new GLTFLoader();

	public info: PlayerInfo;
	public character: Character;

	private world: World;
	private disposed: boolean = false;

	private targetPosition: THREE.Vector3 = new THREE.Vector3();
	private targetQuaternion: THREE.Quaternion = new THREE.Quaternion();
	private hasTarget: boolean = false;
	private animation: string;

	private vehicle: Vehicle;
	private vehicleTargetPosition: THREE.Vector3 = new THREE.Vector3();
	private vehicleTargetQuaternion: THREE.Quaternion = new THREE.Quaternion();
	private hasVehicleTarget: boolean = false;

	constructor(world: World, info: PlayerInfo)
	{
		this.world = world;
		this.info = info;

		// Not routed through LoadingManager on purpose, a player joining mid game
		// shouldn't drag the loading screen back over everybody's world
		RemotePlayer.loader.load('build/assets/boxman.glb', (gltf: any) =>
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

		if (this.vehicle !== undefined) this.vehicle.setPlayerTint(color);
	}

	public applyState(message: any): void
	{
		if (message.p !== undefined) this.targetPosition.set(message.p[0], message.p[1], message.p[2]);
		if (message.q !== undefined) this.targetQuaternion.set(message.q[0], message.q[1], message.q[2], message.q[3]);
		this.hasTarget = true;

		if (this.character === undefined) return;

		if (message.a !== undefined && message.a !== this.animation)
		{
			this.animation = message.a;
			this.character.setAnimation(message.a, 0.15);
		}

		this.applySeat(message.v, message.s);
	}

	public applyVehicleState(message: any): void
	{
		this.vehicleTargetPosition.set(message.p[0], message.p[1], message.p[2]);
		this.vehicleTargetQuaternion.set(message.q[0], message.q[1], message.q[2], message.q[3]);
		this.hasVehicleTarget = true;
	}

	public update(timeStep: number): void
	{
		if (this.character === undefined) return;

		if (this.vehicle !== undefined && this.hasVehicleTarget)
		{
			this.driveVehicle();
		}

		// While seated the character's transform comes from the seat it's parented to
		if (this.hasTarget && this.character.occupyingSeat === null)
		{
			// A big jump means a respawn or a teleport rather than movement, so don't ease into it
			if (this.character.position.distanceTo(this.targetPosition) > 10)
			{
				this.character.position.copy(this.targetPosition);
			}
			else
			{
				this.character.position.lerp(this.targetPosition, 0.25);
			}

			this.character.quaternion.slerp(this.targetQuaternion, 0.25);
		}
	}

	public dispose(): void
	{
		this.disposed = true;
		this.world.unregisterUpdatable(this);

		this.leaveVehicle();

		if (this.character !== undefined)
		{
			this.character.leaveSeat();

			// A scenario launch may have removed it already
			if (this.world.characters.indexOf(this.character) >= 0)
			{
				this.world.remove(this.character);
			}

			this.character = undefined;
		}
	}

	/**
	 * The driver's client is the authority on where their vehicle is, so the
	 * body is pushed toward what they reported and its velocity is cancelled to
	 * stop the local simulation from arguing with it.
	 */
	private driveVehicle(): void
	{
		let body = this.vehicle.collision;

		let position = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
		let quaternion = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);

		if (position.distanceTo(this.vehicleTargetPosition) > 15)
		{
			position.copy(this.vehicleTargetPosition);
			quaternion.copy(this.vehicleTargetQuaternion);
		}
		else
		{
			position.lerp(this.vehicleTargetPosition, 0.3);
			quaternion.slerp(this.vehicleTargetQuaternion, 0.3);
		}

		body.position.set(position.x, position.y, position.z);
		body.interpolatedPosition.set(position.x, position.y, position.z);
		body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
		body.interpolatedQuaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
		body.velocity.setZero();
		body.angularVelocity.setZero();
	}

	private applySeat(vehicleId: string, seatIndex: number): void
	{
		let seat = this.character.occupyingSeat;
		// VehicleSeat types its vehicle as IControllable, which doesn't carry the spawn point
		let seatVehicle = seat !== null ? (seat.vehicle as unknown as Vehicle) : undefined;
		let currentId = (seatVehicle !== undefined && seatVehicle.spawnPoint !== undefined) ? seatVehicle.spawnPoint.name : null;
		let wantedId = (vehicleId === undefined || vehicleId === null) ? null : vehicleId;

		if (currentId === wantedId) return;

		if (wantedId === null)
		{
			this.unseat();
			return;
		}

		let vehicle = this.findVehicle(wantedId);
		if (vehicle === undefined || vehicle.seats[seatIndex] === undefined) return;

		this.unseat();
		this.seat(vehicle, vehicle.seats[seatIndex]);
	}

	/**
	 * A stripped down version of Character.teleportToVehicle. The real one starts
	 * the driving state machine and rewrites the controls panel, which belongs to
	 * the local player, not to somebody being played back.
	 */
	private seat(vehicle: Vehicle, seat: VehicleSeat): void
	{
		// Scenarios with a single player spawn put everyone in the same car. When that
		// happens the local player keeps the seat and the paint job, rather than having
		// a second body stacked into it and the car repainted out from under them.
		if (seat.occupiedBy !== null && seat.occupiedBy !== this.character) return;

		(vehicle as unknown as THREE.Object3D).attach(this.character);

		this.character.position.copy(seat.seatPointObject.position);
		this.character.quaternion.copy(seat.seatPointObject.quaternion);
		this.character.occupySeat(seat);
		this.character.setAnimation('sitting', 0.1);

		this.vehicle = vehicle;
		this.hasVehicleTarget = false;
		vehicle.setPlayerTint(this.info.color);
	}

	private unseat(): void
	{
		if (this.character.occupyingSeat !== null)
		{
			this.character.leaveSeat();
			this.world.graphicsWorld.attach(this.character);
		}

		this.leaveVehicle();
	}

	private leaveVehicle(): void
	{
		if (this.vehicle !== undefined)
		{
			this.vehicle.clearPlayerTint();
			this.vehicle = undefined;
			this.hasVehicleTarget = false;
		}
	}

	private findVehicle(id: string): Vehicle
	{
		for (const vehicle of this.world.vehicles)
		{
			if (vehicle.spawnPoint !== undefined && vehicle.spawnPoint.name === id) return vehicle;
		}

		return undefined;
	}
}
