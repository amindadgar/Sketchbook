import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * Rubber left on the road by tyres that are sliding, locked or spinning.
 *
 * Every mark in the world is one mesh: a long run of quads written into a
 * ring, a new one each time a sliding tyre has moved a hand's width. The
 * oldest are faded out as the ring fills and then written over, so the
 * streets keep the last few minutes of driving without it ever costing more
 * than one draw call.
 */
export declare class SkidMarks implements IUpdatable {
    updateOrder: number;
    private static readonly CAPACITY;
    /** Half a tyre's width. */
    private static readonly HALF_WIDTH;
    /** How far a tyre moves between one piece of mark and the next. */
    private static readonly STEP;
    /** Above the road, so a mark doesn't flicker in and out of it. */
    private static readonly LIFT;
    private mesh;
    private positions;
    private strengths;
    private serials;
    private uniforms;
    private head;
    private written;
    private frame;
    private trails;
    private static side;
    private static flat;
    constructor(world: World);
    update(timeStep: number): void;
    /**
     * A tyre sliding this frame.
     * @param key anything that identifies the tyre, so its mark is one unbroken line
     * @param strength 0 to 1, how dark the mark is
     */
    mark(key: any, point: THREE.Vector3, normal: THREE.Vector3, travel: THREE.Vector3, strength: number): void;
    private write;
}
