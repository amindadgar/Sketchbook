import * as THREE from 'three';
import { Car } from './Car';
import { Character } from '../characters/Character';
/**
 * Two wheels, driven like a car.
 *
 * Underneath it is one: four raycast wheels set a hand's width apart, which
 * is what keeps the physics sane, and the two wheels you see are turned by
 * hand, the front one on its fork with the steering. What makes it a bike is
 * the lean. Nothing that narrow stays up by itself, so it's held upright the
 * way a rider would, and into a turn it leans over, further the faster it's
 * going. Stopped, it stands as if it had a foot down.
 */
export declare class Motorbike extends Car {
    /** Most it leans, radians, at speed with the bars hard over. */
    private static readonly MAX_LEAN;
    /** How hard it's held at its lean, and how much the wobble is damped. */
    private static readonly STIFFNESS;
    private static readonly DAMPING;
    private static readonly WHEEL_RADIUS;
    private frontWheel;
    private rearWheel;
    private fork;
    /** On the fork, where the front wheel's hub is. */
    private axle;
    private forkRest;
    private frontRest;
    private rearRest;
    private spin;
    private steer;
    /** Where the rider's asking it to go, eased: leaning follows the bars being pushed, not how far the front wheel turns. */
    private leanInput;
    constructor(gltf: any);
    update(timeStep: number): void;
    /**
     * Legs astride the tank rather than out in front the way a car seat has
     * them: thighs down and forward, shins back to the pegs. Over whatever the
     * sitting animation did, every frame someone's on it.
     */
    poseRider(rider: Character): void;
    /** One lamp, on the fork. */
    protected lampSpots(): THREE.Vector3[];
    /**
     * A roll toward the lean it should have: none standing still, into the
     * turn at speed. Applied about the bike's own length, so it doesn't fight
     * the wheels over which way it points.
     */
    private keepUpright;
    /** Where the bars are, from hard left at 1 to hard right at -1, as the physics steers the front wheels. */
    private steeringValue;
}
