import * as THREE from 'three';
import { SeatType } from '../enums/SeatType';
import { Side } from '../enums/Side';
import { IControllable } from '../interfaces/IControllable';
import { VehicleDoor } from './VehicleDoor';
import { Vehicle } from './Vehicle';
import { Character } from '../characters/Character';

export class VehicleSeat
{
	public vehicle: IControllable;
	public seatPointObject: THREE.Object3D;

	// String of names of connected seats
	public connectedSeatsString: string;
	// Actual seatPoint objects, need to be identified
	// by parsing connectedSeatsString *after* all seats are imported
	public connectedSeats: VehicleSeat[] = [];

	public type: SeatType;
	public entryPoints: THREE.Object3D[] = [];
	public door: VehicleDoor;

	public occupiedBy: Character = null;

	/**
	 * How far above the seat point a seated character's origin sits. The model
	 * hangs below its origin, so anything seating a character without this puts
	 * them through the floor with their legs under the car.
	 */
	public static readonly SIT_HEIGHT: number = 0.6;

	constructor(vehicle: IControllable, object: THREE.Object3D, gltf: any)
	{
		this.vehicle = vehicle;
		this.seatPointObject = object;

		if (object.hasOwnProperty('userData') && object.userData.hasOwnProperty('data'))
		{
			if (object.userData.hasOwnProperty('door_object')) 
			{
				this.door = new VehicleDoor(this, gltf.scene.getObjectByName(object.userData.door_object));
			}

			if (object.userData.hasOwnProperty('entry_points')) 
			{
				let entry_points = (object.userData.entry_points as string).split(';');
				for (const entry_point of entry_points)
				{
					if (entry_point.length > 0)
					{
						this.entryPoints.push(gltf.scene.getObjectByName(entry_point));
					}
				}
			}
			else
			{
				console.error('Seat object ' + object + ' has no entry point reference property.');
			}

			if (object.userData.hasOwnProperty('seat_type')) 
			{
				this.type = object.userData.seat_type;
			}
			else
			{
				console.error('Seat object ' + object + ' has no seat type property.');
			}

			if (object.userData.hasOwnProperty('connected_seats')) 
			{
				this.connectedSeatsString = object.userData.connected_seats;
			}
		}
	}

	/** Where a seated character's origin goes, in the vehicle's own space. */
	public getSitPosition(out: THREE.Vector3): THREE.Vector3
	{
		out.copy(this.seatPointObject.position);
		out.y += VehicleSeat.SIT_HEIGHT;
		return out;
	}

	public update(timeStep: number): void
	{
		if (this.door !== undefined)
		{
			this.door.update(timeStep);
		}
	}
}