import * as THREE from 'three';
import { World } from '../world/World';
import { CityContext } from './CityContext';
/**
 * Street lights, signal masts and pavement clutter that a car snaps off
 * instead of stopping dead against.
 *
 * Each one stands in the physics world as a solid box, so people walk round
 * it and a car creeping into it just stops. After every physics step, each
 * moving car looks at what it's about to reach before the next one: anything
 * it's going fast enough to knock over has its box taken out before the two
 * can collide, the car loses a little speed, and a loose copy falls over. On
 * everyone else's screen it falls too, and a while later, once nobody's
 * looking, it's quietly put back.
 */
export declare class Breakables {
    private static readonly CELL;
    private static readonly DEBRIS_LIFE;
    private static readonly MAX_DEBRIS;
    /** How long something stays knocked down, at the least. */
    private static readonly RESTORE_AFTER;
    /** And how far off everyone has to be before it's put back. */
    private static readonly RESTORE_DISTANCE;
    private world;
    private context;
    private grid;
    private broken;
    private debris;
    private bounds;
    private material;
    private onLenses;
    private static toLocal;
    private static localVelocity;
    private static inverse;
    constructor(world: World, context: CityContext, onLenses: (lenses: number[], hidden: boolean) => void);
    private static cellOf;
    /** Knocked over on somebody else's screen. */
    knockRemote(id: number, velocity: THREE.Vector3): void;
    update(timeStep: number): void;
    private vehicleOver;
    /** After each physics step: whatever each moving car is about to hit, and whether it goes over. */
    private afterStep;
    /**
     * Whether the car's box, carried on a step and a half at the speed it's
     * going, reaches the thing's box. In the car's own frame, so a car at an
     * angle doesn't clip what it's only passing.
     */
    private aboutToHit;
    /** The car's boxes, as one box in its own frame. */
    private boundsOf;
    /** Takes it out of the world and drops a loose copy where it stood. */
    private knock;
    private restore;
    private dropPiece;
    private removeDebris;
}
