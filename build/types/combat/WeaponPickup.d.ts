import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { WeaponSpec } from './Weapons';
/**
 * A weapon turning slowly inside a glowing column, the way pickups worked in
 * the older GTA games. Walk into the column and it's yours; the column goes
 * dark and comes back a while later so a spot can't be farmed.
 */
export declare class WeaponPickup implements IUpdatable {
    updateOrder: number;
    private static readonly RADIUS;
    private static readonly RESPAWN_TIME;
    spec: WeaponSpec;
    available: boolean;
    position: THREE.Vector3;
    private world;
    private group;
    private model;
    private column;
    private ring;
    private spin;
    private cooldown;
    constructor(world: World, spec: WeaponSpec, position: THREE.Vector3);
    update(timeStep: number): void;
    /** True when the given point is inside the column. */
    covers(position: THREE.Vector3): boolean;
    consume(): void;
    dispose(): void;
    private setAvailable;
}
