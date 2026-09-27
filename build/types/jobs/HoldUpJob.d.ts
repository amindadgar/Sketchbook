import { Job } from './Job';
import { JobSystem } from './JobSystem';
/**
 * Holding up a corner shop at gunpoint.
 *
 * A Quik Mart somewhere across town, marked on the map, with the clerk at
 * the door and a guard or two on the pavement. Get there and keep a gun on
 * the clerk, close up, until the till's empty; the guards open fire the
 * moment the gun comes up, and if the clerk dies the till stays shut. Then
 * the clerk runs, a car of the owner's friends turns up with guns, and
 * there's a clock on getting clear before the police close the streets off.
 * Far enough away and the take is the player's, with something extra for
 * every gunman put down on the way.
 */
export declare class HoldUpJob extends Job {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly pays: string;
    private static readonly COLOR;
    private static readonly HOSTILE;
    /** How close to the clerk a gun counts, and how long it has to be held on them in all. */
    private static readonly REACH;
    private static readonly TILL_TIME;
    /** How far from the store is clear, and how long there is to get that far. */
    private static readonly CLEAR;
    private static readonly ESCAPE_TIME;
    /** Extra for every gunman put down. */
    private static readonly BOUNTY;
    private static readonly GUARD_WEAPONS;
    private static readonly CREW_WEAPONS;
    private stage;
    private store;
    private inward;
    private sign;
    private marker;
    private blips;
    private clerk;
    private clerkHealth;
    /** Where the guards stand, made as soon as there are bodies to make them from. */
    private posts;
    private armed;
    private alarm;
    private till;
    private take;
    private kills;
    private timeLeft;
    private backupIn;
    private backupCalled;
    private backupStage;
    private backupCar;
    private backupDriver;
    private backupTime;
    constructor(system: JobSystem);
    start(): string;
    update(timeStep: number): void;
    cleanup(): void;
    private approach;
    /** A gun on the clerk, close up, until the till's empty. Time with the gun off them isn't lost, only paused. */
    private rob;
    /** Money in hand, the clerk off down the street, and help on its way for the shop. */
    private emptied;
    private escape;
    /** The clerk and the guards, as soon as there are bodies to make them from. */
    private placePeople;
    /** Shots at the guards or the clerk start it as surely as a gun in the clerk's face. */
    private watchForTrouble;
    private raiseAlarm;
    /** A mark on the map for everyone shooting at the player, and a count of those put down. */
    private trackArmed;
    /** A car with two more gunmen, some way up the street and driving in to the store. Skipped if it can't be made. */
    private callBackup;
    private addCrew;
    /** Drives in, pulls up, and they get out shooting: close to the store, or when it's taking too long. */
    private updateBackup;
    /**
     * A way in to the store along the streets from some way off: walked
     * backwards from the lane outside the door, lane by lane, then turned
     * round to be driven. Undefined if there's nowhere sensible to start.
     */
    private routeToStore;
    private furthestStart;
    /** A shop front across town: not next door, not miles off, and not next to a gun shop. */
    private findStore;
    /** The crosshair on the clerk: the camera's line through the same upright cylinder shots are tested against. */
    private onClerk;
    private addBlip;
    private removeBlip;
    private static pick;
}
