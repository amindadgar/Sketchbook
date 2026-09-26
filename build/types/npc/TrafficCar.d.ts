import * as THREE from 'three';
import * as CANNON from 'cannon';
import { Lane } from './Navigation';
import { SkidMarks } from '../vehicles/SkidMarks';
/**
 * A car in the city's traffic.
 *
 * Driven along the lane graph rather than simulated: a real car per bit of
 * background traffic would cost the physics engine a wheeled vehicle each and
 * drive about as badly as the race drivers do in a city. Instead it follows
 * its lane at a speed worked out from the car in front, the lights, and
 * anyone in the road, carrying a moving body shaped like the car.
 *
 * That body can't be pushed while it's driving. When something is about to
 * hit it, it's knocked: it becomes an ordinary body with the weight of a car,
 * so a hit shoves it, spins it and slides it along on its tyres, and once it
 * has come to rest it pulls back into a lane and drives on. Roll it and it
 * stays where it lies.
 */
export declare class TrafficCar {
    static readonly COLORS: number[];
    /** How far above the road the model's origin sits, from the size of its wheels. */
    private static readonly RIDE;
    private static readonly WHEEL_RADIUS;
    /** The same as a player's car, so the two push each other about evenly. */
    static readonly MASS: number;
    /**
     * How fast tyres slow a knocked car, per second: rolling along it doesn't
     * lose much, sliding sideways stops it short, and on its side or roof it
     * scrapes to a halt whichever way. The physics engine's own friction is
     * all but off for it, since it takes the full grip at every point touching
     * the ground, which on four wheels stopped a shoved car almost dead.
     */
    private static readonly ROLLING;
    private static readonly SLIDING;
    private static readonly SCRAPING;
    /** How quickly a car that's pulled back into its lane eases across, per second. */
    private static readonly BLEND_RATE;
    private static readonly TURNING;
    private static material;
    id: number;
    color: number;
    object: THREE.Object3D;
    body: CANNON.Body;
    lane: Lane;
    nextLane: Lane;
    distance: number;
    speed: number;
    /** Seconds stopped at a junction without lights, before going. */
    waited: number;
    /** Set after a knock, when it sits there for a bit before driving on. */
    stunned: number;
    /** Free in the physics world rather than driven along its lane. */
    knocked: boolean;
    /** On its side or roof, or nowhere near a lane, so it isn't going anywhere. */
    wrecked: boolean;
    /**
     * What the client simulating the city says: 0 driving, 1 an upright wreck,
     * 2 on its roof. Kept apart from wrecked, which this client's own physics
     * sets and clears while it has the car.
     */
    reportedWreck: number;
    /** How long it has been at rest since it was knocked. */
    still: number;
    /** How long since it was knocked. */
    knockedFor: number;
    /** Its outline from above, for working out what's about to hit it. */
    halfWidth: number;
    halfLength: number;
    /** Where each tyre meets the road, in the car's own frame, and the ball that stands for it. */
    private tyreSpots;
    private tyreBalls;
    /** Where it came to rest, drawn eased back into its lane as it pulls away. */
    private blendOffset;
    private blendHeading;
    position: THREE.Vector3;
    heading: number;
    forward: THREE.Vector3;
    target: THREE.Vector3;
    targetHeading: number;
    fresh: boolean;
    private wheels;
    private lamps;
    constructor(id: number, color: number, template: THREE.Object3D, lampTexture: THREE.Texture);
    /**
     * The model's own collision boxes, the ones the player's car of the same
     * model has, and a ball at each wheel for it to stand and slide on once
     * it's knocked loose, since there are no real wheels under it.
     */
    private buildShapes;
    /** Lets go of the lane: from now on the physics world moves it. */
    knock(): void;
    /** Grip, once a physics step, while it's loose. */
    private tyres;
    /** Back on the lane graph, driven again. */
    unknock(): void;
    /** Where the physics world has put it, while it's knocked. */
    readBody(): void;
    /** Rubber on the road from tyres dragged sideways, while it's knocked about. */
    leaveMarks(marks: SkidMarks): void;
    /** Right way up, more or less. */
    get upright(): boolean;
    /**
     * Driving on from where it came to rest: the body goes straight to its
     * lane, and the model is drawn easing across to it.
     */
    resumeFrom(rest: THREE.Vector3, restHeading: number): void;
    setLights(on: boolean): void;
    /** Places the model and its collider, and turns the wheels. */
    updateVisual(timeStep: number): void;
    /** Places the car on its lane, pointed along it. */
    placeOnLane(): void;
    private sampleAlong;
    follow(timeStep: number): void;
}
