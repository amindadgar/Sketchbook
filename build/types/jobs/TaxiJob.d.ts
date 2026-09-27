import { Job } from './Job';
import { JobSystem } from './JobSystem';
/**
 * Fares, one after another, in whatever car the player's driving.
 *
 * Somebody waits at the kerb, marked on the map; stop beside them and they
 * climb in and say where they're going, and there's a clock on it. Pull up
 * there and they pay: more for a longer trip, more for time to spare, and
 * less for every knock the car took with them in it. Run out the clock and
 * they get out in a huff without paying. The next fare is already waiting.
 */
export declare class TaxiJob extends Job {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly pays: string;
    private static readonly COLOR;
    private stage;
    private fare;
    private marker;
    private seat;
    private destination;
    private tripLength;
    private timeLeft;
    private timer;
    private integrityAtPickup;
    private fares;
    private awayFromCar;
    /** The last fare, walking off after being dropped, and how long they have left in view. */
    private leaving;
    private leavingFor;
    constructor(system: JobSystem);
    start(): string;
    update(timeStep: number): void;
    cleanup(): void;
    private nextFare;
    private waitForPickup;
    /** Walks to the car and gets in. Straight in if the walk takes too long. */
    private board;
    private ride;
    private fareFor;
    /** Out of the car and off up the pavement, and the next one's waiting. */
    private dropOff;
    private walkOffLastFare;
    private static passengerSeat;
}
