import { World } from '../world/World';
import { Challenge } from './Challenges';
/**
 * Experience, a level, and three things to do today.
 *
 * Everything is counted in the browser rather than on the server. The relay
 * already counts kills against an account, and a second, differently trusted
 * tally of the same thing living beside it would only ever disagree with it.
 * This is the player's own record of their own afternoon.
 */
export declare class Progress {
    private static readonly STORAGE_KEY;
    /** Experience for a kill, a lap, a race finished, and per stunt point. */
    private static readonly XP_KILL;
    private static readonly XP_LAP;
    private static readonly XP_RACE;
    private static readonly XP_PER_STUNT_POINT;
    private world;
    private state;
    private challenges;
    /** Distance ticks up every frame, and localStorage is not a per frame thing. */
    private dirty;
    private sinceSave;
    constructor(world: World);
    get xp(): number;
    /** Levels widen as they go: 100 experience to reach two, 400 to reach three. */
    get level(): number;
    get levelFloor(): number;
    get levelCeiling(): number;
    get todaysChallenges(): Challenge[];
    progressOn(challenge: Challenge): number;
    isDone(challenge: Challenge): boolean;
    addKill(): void;
    addLap(): void;
    addRaceFinish(place: number): void;
    addStuntPoints(points: number): void;
    addDistance(metres: number): void;
    addAirtime(seconds: number): void;
    addFlightTime(seconds: number): void;
    addPickup(): void;
    /** A high water mark rather than a total, for the "go this fast" sort. */
    noteSpeed(metresPerSecond: number): void;
    /** Everything the world measures continuously, rolled up once a frame. */
    addDriving(metres: number, speed: number, flightSeconds: number, airSeconds: number): void;
    /** Called from the world's own loop, to flush at a sane rate. */
    update(unscaledTimeStep: number): void;
    private award;
    private count;
    private checkChallenges;
    /** Counters and challenges are the day's, experience and level are forever. */
    private rollOverIfNewDay;
    private load;
    /** Marks it worth writing. The write itself waits for the next flush. */
    private save;
    private write;
}
