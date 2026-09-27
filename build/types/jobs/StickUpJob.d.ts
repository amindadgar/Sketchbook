import { Job } from './Job';
import { JobSystem } from './JobSystem';
/**
 * Three well-off people out on the town, marked on the map, and their money.
 *
 * Get behind one on foot and E lifts their wallet without a word, most of
 * the time: get caught and they run. Or hold them up: keep a gun on them from
 * close by and they drop it and run. Shooting them works too, but only half
 * of it survives, and it's a lot louder. Some carry a gun of their own and use
 * it once they've been robbed. Done when all three have been dealt with,
 * with a bonus for a job done without a body.
 */
export declare class StickUpJob extends Job {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly pays: string;
    private static readonly COLOR;
    private static readonly MARKS;
    private static readonly TIME;
    /** Close enough to put your hand in their pocket. */
    private static readonly REACH;
    private static readonly HOLD_RANGE;
    private static readonly HOLD_TIME;
    private marks;
    private timeLeft;
    private robbed;
    private killed;
    private waiting;
    constructor(system: JobSystem);
    start(): string;
    update(timeStep: number): void;
    cleanup(): void;
    private placeMarks;
    /** Up and down their bit of pavement, not in a hurry. */
    private stroll;
    private updateMark;
    private pickpocket;
    private handOver;
    /** Experience for money off the floor, which the wallet has already counted. */
    private pickedUp;
    /** Running, and marked as running away unless they've already been dealt with. */
    private flee;
    /** Out comes a gun of their own. */
    private fightBack;
    private finishWith;
    private wrapUp;
    private removeBlip;
    /** Whether the player's gun is up and the crosshair is on this person, near enough to count. */
    private aimedAt;
    /** Ray against an upright cylinder where somebody stands, as the guns test it. */
    private static rayHits;
}
