import { Job } from './Job';
import { JobSystem } from './JobSystem';
/**
 * Three parcels from a depot to three doors across town, on foot or in
 * whatever the player's driving.
 *
 * The depot is marked on the map, a stack of boxes by its ring; stand in it,
 * or stop in it, and the parcels are loaded. All three addresses show at
 * once, so the order is the player's to plan, against one clock for the lot.
 * Each pays on the doorstep, more the further it's come. One is fragile: it
 * pays more, but every knock the car takes and every hard landing while it's
 * aboard comes off what it pays. Time left at the last door is a bonus; run
 * out of it and the rest are late, though what's been delivered stays paid.
 */
export declare class CourierJob extends Job {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly pays: string;
    private static readonly COLOR;
    private static readonly FRAGILE_COLOR;
    private static readonly PARCELS;
    private static readonly DEPOT_RADIUS;
    private static readonly DOOR_RADIUS;
    /** A car's middle can't get as far onto the pavement as a pair of feet can, so it gets more room round a ring. */
    private static readonly CAR_SLACK;
    private static readonly FOOT_SLACK;
    private static readonly PICKUP_SPEED;
    private static readonly DROP_SPEED;
    /** Taken off the fragile parcel for each point off the car and each hard landing. */
    private static readonly KNOCK_COST;
    /** Falling faster than this as the wheels touch down is a hard landing: a drop of two metres or so. */
    private static readonly HARD_FALL;
    /** Shorter than this in the air is a bump in the road. */
    private static readonly MIN_AIRTIME;
    private static cardboard;
    private static tape;
    private static fragileTape;
    private static wood;
    private stage;
    private depot;
    private depotSpot;
    private parcels;
    private timeLeft;
    /** Everything this job put in the scene: the depot's stack, and the parcels left on doorsteps. */
    private props;
    /** The top of the stack, which is what gets taken away. */
    private loads;
    private knocks;
    private landings;
    private watched;
    private lastIntegrity;
    private airborne;
    private airtime;
    private falling;
    private rolling;
    constructor(system: JobSystem);
    start(): string;
    update(timeStep: number): void;
    cleanup(): void;
    private collect;
    /** Loaded up: the addresses go on the map and the clock starts. */
    private pickUp;
    private deliver;
    /** On the doorstep and paid for. */
    private handOver;
    private payFor;
    private penalty;
    /**
     * While it's aboard, every point off whatever's being driven counts
     * against it, and so does every hard landing, in a car or on foot. A
     * change of car starts from however the new one was found.
     */
    private mindFragile;
    /** Wheels off the ground, then back on it falling fast. */
    private watchLanding;
    private hardLanding;
    private isRolling;
    private fragileParcel;
    /**
     * Three doors, each a fair way from the depot and none on top of another.
     * Undefined if the city won't give three.
     */
    private pickAddresses;
    /** Where the player counts as being for a ring, how much room that gets, and how fast they're going. */
    private reach;
    /** Whatever the player's at the controls of: a helicopter's knocks shake a parcel as much as a car's. */
    private drivingVehicle;
    /** Nearest door next, each time, as the crow flies. */
    private static roundLength;
    private static flat;
    /** A pallet of boxes just along the pavement from the depot's ring, the top three being the job's. */
    private buildStack;
    /** The parcel, left by the door, until the job's over. */
    private leaveOnDoorstep;
    /** A cardboard box standing on its base, with a band of tape round it: red for fragile. */
    private static box;
    private static materials;
}
