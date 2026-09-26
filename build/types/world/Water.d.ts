import * as THREE from 'three';
import { World } from './World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * The sea: one plane out to the horizon at sea level.
 *
 * It's an ordinary physically based material, dark and very smooth, so the
 * sky and the sun do the work: the environment map gives it the sky's
 * reflection with the right fresnel, the sun lays a glint across it, and the
 * shadow cascades fall on it like anything else. The ripples are two layers
 * of the same tileable normal map sliding past each other in world space,
 * fading out with distance so the horizon doesn't shimmer.
 */
export declare class Water implements IUpdatable {
    updateOrder: number;
    mesh: THREE.Mesh;
    level: number;
    private time;
    private material;
    /**
     * `hole` is a rectangle in x and z the sea stays out of: the island, whose
     * sunken race tracks sit below sea level inside its walls.
     */
    constructor(world: World, level: number, size?: number, hole?: {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
    });
    /** A square of sea, in the XY plane before it's laid flat, with the hole cut out. */
    private static surface;
    update(timeStep: number, unscaledTimeStep: number): void;
    /**
     * A tileable ripple texture drawn on the spot, so the sea costs nothing to
     * download. Sums of waves whose frequencies are whole numbers of cycles
     * across the tile, so it wraps without a seam, stored as tangent space
     * normals the usual way.
     */
    private static createNormalMap;
}
