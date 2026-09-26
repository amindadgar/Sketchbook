import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * Short lived visuals: muzzle flashes, tracers, smoke.
 *
 * They all want the same thing, to appear, fade over a fraction of a second and
 * take themselves away again, so they share one list rather than each system
 * keeping its own and its own disposal.
 */
export declare class Effects implements IUpdatable {
    updateOrder: number;
    private static smokeTexture;
    private world;
    private live;
    constructor(world: World);
    add(object: THREE.Object3D, life: number, rise?: number, spread?: number): void;
    /** A puff of exhaust smoke, drifting up and thinning as it goes. */
    addSmoke(position: THREE.Vector3, scale: number, darkness: number): void;
    /** A short lick of flame, for whatever is burning fuel to go faster. */
    addFlame(position: THREE.Vector3, scale: number): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    private static getSmokeTexture;
}
