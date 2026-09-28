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
    /**
     * How much of the view a puff may fill, as its width over its distance,
     * before it starts to thin, and where it's gone. Smoke drifts behind a car
     * and the chase camera drives straight through it: without this the screen
     * filled with it. A phone's smaller screen has less to spare.
     */
    private static readonly SMOKE_COVER_FULL;
    private static readonly SMOKE_COVER_GONE;
    /** Puffs in the air at once, however many battered cars there are. */
    private static readonly SMOKE_LIMIT;
    private smokeCount;
    private world;
    private live;
    constructor(world: World);
    add(object: THREE.Object3D, life: number, rise?: number, spread?: number): void;
    /** A puff of smoke from a battered engine, drifting up and thinning as it goes. */
    addSmoke(position: THREE.Vector3, scale: number, darkness: number): void;
    /** A short lick of flame, for whatever is burning fuel to go faster. */
    addFlame(position: THREE.Vector3, scale: number): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    private static getSmokeTexture;
}
