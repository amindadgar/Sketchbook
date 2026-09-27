import { World } from '../world/World';
import { Challenge } from './Challenges';
export interface ProgressState {
    xp: number;
    day: string;
    counters: {
        [metric: string]: number;
    };
    done: string[];
}
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
    /** Goes up with every change that matters to keep: not the metres ticking up as you drive. */
    changes: number;
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
    /** A job done, or a part of one: experience for it, and a count towards today's challenges. */
    addJob(kind: string, xp: number): void;
    /** Somebody held up in the street. */
    addMugging(): void;
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
    /** A copy of everything kept, for keeping somewhere else. */
    snapshot(): ProgressState;
    /**
     * Everything kept, replaced: an account's copy, loaded on sign-in. A copy
     * from another day keeps its experience and starts today's challenges afresh.
     */
    adopt(state: ProgressState): void;
    private write;
}
