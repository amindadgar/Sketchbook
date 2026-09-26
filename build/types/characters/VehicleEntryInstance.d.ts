import * as THREE from 'three';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { Character } from './Character';
export declare class VehicleEntryInstance {
    character: Character;
    targetSeat: VehicleSeat;
    entryPoint: THREE.Object3D;
    wantsToDrive: boolean;
    /** Let go of forward at the door to wait for the party to confirm the seat. */
    private heldAtDoor;
    constructor(character: Character);
    update(timeStep: number): void;
}
