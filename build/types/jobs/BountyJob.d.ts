import { Job } from './Job';
import { JobSystem } from './JobSystem';
/**
 * A price on a man's head.
 *
 * He hangs about in a parking lot across town beside his car, with two or
 * three bodyguards, and the lot's marked on the map with him on it. Walk up,
 * point a gun his way or let one off nearby, and the guards open up while he
 * makes for the car and drives off through the streets. Wreck the car and he
 * runs for it on foot; if the car's no use to him at all he stands and fights.
 * He pays out dead, with a bit more for every bodyguard dropped on the way.
 * Let him get far enough off, or run out the clock, and the bounty's gone.
 */
export declare class BountyJob extends Job {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly pays: string;
    private static readonly AREA_COLOR;
    private static readonly TARGET_COLOR;
    private static readonly NAMES;
    private static readonly GUARD_WEAPONS;
    private static readonly CAR_COLORS;
    private static readonly TIME_LIMIT;
    /** How far off the lot can be. */
    private static readonly NEAREST;
    private static readonly FURTHEST;
    /** Close enough for them to notice the player. */
    private static readonly NOTICE;
    /** A gun pointed at them from this close, in plain view, gives the game away. */
    private static readonly AIM_NOTICE;
    /** A shot heard from this close does too. */
    private static readonly SHOT_NOTICE;
    private static readonly GOT_AWAY;
    private static readonly GUARD_BONUS;
    private static readonly DRIVE_SPEED;
    /** Below this the car's no good to him. */
    private static readonly WRECKED;
    private stage;
    private name;
    private bounty;
    private elapsed;
    /** Time in the current stage. */
    private timer;
    private area;
    private blip;
    private carSpot;
    private carHeading;
    private car;
    private targetSpot;
    private targetFacing;
    private target;
    /** Bodyguards still to be made, while the bodies load. */
    private guardSpots;
    private guards;
    private walker;
    private driver;
    private stuckFor;
    /** The player's gun last frame, to tell a shot from the magazine going down. */
    private lastWeapon;
    private lastAmmo;
    constructor(system: JobSystem);
    start(): string;
    update(timeStep: number): void;
    cleanup(): void;
    /** An open lot a fair way off: not the dealership's, not the garage's, and not one of the corners the ring road cuts through. */
    private findLot;
    /** Where the car, the man and his bodyguards go in the lot. */
    private plan;
    /** Makes whoever isn't made yet. Called again next frame while the bodies are loading. */
    private spawnCrew;
    /** Too close, shot at, a shot nearby, or a gun pointed their way where they can see it. */
    private alerted;
    /** The guards open up and he's off in a moment. The lot's found, so its ring goes. */
    private startle;
    /** For the car if it'll still take him anywhere, otherwise he makes a stand. */
    private getAway;
    private run;
    /** To the driver's door, following the car if it's been shoved, and in. */
    private runToCar;
    private board;
    /** Off through the streets until the car gives out, or he's stuck, or it's on its roof. */
    private drive;
    private bail;
    /** Out of the door, then off on foot. Pulled out if the door won't let him. */
    private getOut;
    private flee;
    /** No way out: he turns and shoots it out where he stands. */
    private fight;
    private collect;
    private hud;
    private timeLeft;
    /** Whether the player let one off since last frame: the round in the chamber went, on the same gun. */
    private playerFired;
    /** There, whole, on its wheels, and nobody else in it or getting in, least of all the player. */
    private carUsable;
    private doorOf;
    /** Onto the nearest lane and away along the streets. */
    private routeFrom;
    /** More road on from the end of the last, the same way, so he never runs out of city to drive. */
    private moreRoad;
    private static driverSeat;
    private static upturned;
    /** How far apart two lots are, edge to edge. */
    private static gap;
    /**
     * The corner blocks the ring road cuts through are zoned for parking but
     * never built as lots, only left as ground with a road across; the same
     * test the city's builder makes, on the block round the lot.
     */
    private static cutByRing;
}
