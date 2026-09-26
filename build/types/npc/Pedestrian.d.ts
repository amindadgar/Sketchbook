import * as THREE from 'three';
import * as CANNON from 'cannon';
import { Route, Crossing } from './Navigation';
export type PedestrianState = 'walk' | 'wait' | 'idle' | 'flee' | 'dead';
/** The animation set a pedestrian uses, built once per body type. */
export interface PedestrianClips {
    idle: THREE.AnimationClip;
    walk: THREE.AnimationClip;
    run: THREE.AnimationClip;
}
/**
 * Someone walking the pavements.
 *
 * On whichever client simulates the city, a pedestrian walks the loop of
 * pavement round a block, sometimes stops, sometimes crosses at the lights to
 * the next block, runs from gunfire and falls when shot or run over. Everyone
 * else is shown where they are and what they're doing, a few times a second.
 *
 * There's no skeleton physics: the body is a skinned mesh walked along a
 * route, with a small sphere in the physics world so a player can't walk
 * straight through them.
 */
export declare class Pedestrian {
    static readonly WALK_SPEED: number;
    static readonly RUN_SPEED: number;
    /** The walk clip covers this much ground per second at normal speed. */
    private static readonly WALK_STRIDE;
    static readonly COLLISION_GROUP: number;
    id: number;
    variant: number;
    object: THREE.Group;
    model: THREE.Object3D;
    body: CANNON.Body;
    health: number;
    state: PedestrianState;
    route: Route;
    distance: number;
    direction: number;
    speed: number;
    timer: number;
    fleeFrom: THREE.Vector3;
    pendingCrossing: Crossing;
    lastCorner: number;
    position: THREE.Vector3;
    heading: number;
    target: THREE.Vector3;
    targetHeading: number;
    fresh: boolean;
    private mixer;
    private actions;
    private current;
    private fall;
    private animationSkip;
    constructor(id: number, variant: number, model: THREE.Object3D, clips: PedestrianClips);
    get alive(): boolean;
    private play;
    /** Pose, place and animate, from wherever the position came from. */
    updateVisual(timeStep: number, cameraDistance: number): void;
    private skipCounter;
    private meshes;
    /** Eases toward a position from a snapshot, for clients that don't simulate. */
    follow(timeStep: number): void;
    dispose(): void;
}
