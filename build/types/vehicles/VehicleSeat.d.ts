import * as THREE from 'three';
import { SeatType } from '../enums/SeatType';
import { IControllable } from '../interfaces/IControllable';
import { VehicleDoor } from './VehicleDoor';
import { Character } from '../characters/Character';
export declare class VehicleSeat {
    vehicle: IControllable;
    seatPointObject: THREE.Object3D;
    connectedSeatsString: string;
    connectedSeats: VehicleSeat[];
    type: SeatType;
    entryPoints: THREE.Object3D[];
    door: VehicleDoor;
    occupiedBy: Character;
    /**
     * How far above the seat point a seated character's origin sits. The model
     * hangs below its origin, so anything seating a character without this puts
     * them through the floor with their legs under the car.
     */
    static readonly SIT_HEIGHT: number;
    constructor(vehicle: IControllable, object: THREE.Object3D, gltf: any);
    /** Where a seated character's origin goes, in the vehicle's own space. */
    getSitPosition(out: THREE.Vector3): THREE.Vector3;
    update(timeStep: number): void;
}
