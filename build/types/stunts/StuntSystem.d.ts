import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * Points for driving badly on purpose.
 *
 * This map is a stunt park. It has a mega ramp, a loop, and half the scenery is
 * something to jump off, and until now none of it counted for anything. Airtime
 * and rotation are measured off the physics body while the wheels are off the
 * ground, and paid out on a clean landing.
 *
 * Rotation comes from integrating angular velocity along the car's own axes
 * rather than comparing quaternions: the axes turn with the car, which is what
 * makes a barrel roll a barrel roll no matter which way the car is pointing.
 */
export declare class StuntSystem implements IUpdatable {
    updateOrder: number;
    /** Below this an air is a bump in the road, not a jump. */
    private static readonly MIN_AIRTIME;
    private static readonly POINTS_PER_SECOND;
    private static readonly POINTS_PER_FLIP;
    private static readonly POINTS_PER_ROLL;
    private static readonly POINTS_PER_SPIN;
    /** How long a landing keeps the chain alive for the next one. */
    private static readonly COMBO_WINDOW;
    private static readonly MAX_COMBO;
    private static readonly BEST_KEY;
    private world;
    private airborne;
    private airtime;
    private launchHeight;
    private peakHeight;
    private flipSpin;
    private rollSpin;
    private yawSpin;
    private combo;
    private comboTimer;
    private session;
    private best;
    private static forward;
    private static right;
    private static up;
    constructor(world: World);
    get sessionScore(): number;
    update(timeStep: number, unscaledTimeStep: number): void;
    private drivenCar;
    private stayUp;
    private land;
    /** What the car just did, in words, for the toast and the live readout. */
    private describe;
    private turns;
    private reset;
    private loadBest;
    private saveBest;
}
