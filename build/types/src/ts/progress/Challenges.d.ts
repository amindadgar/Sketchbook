export interface Challenge {
    id: string;
    label: string;
    /** Which counter it watches, and how much of it finishes the job. */
    metric: string;
    goal: number;
    reward: number;
    /** How to read the running total back, for the panel. */
    unit?: string;
}
/**
 * The pool three of these are drawn from each day.
 *
 * Everything here is something the game already measures, and between them they
 * point at every part of it: drive, fly, race, shoot and crash on purpose. The
 * draw is seeded by the date, so everybody gets the same three on the same day
 * without a server having to decide.
 */
export declare const CHALLENGE_POOL: Challenge[];
/**
 * Three for the given day, the same three for everyone.
 *
 * A tiny hash of the date rather than a random number, because a random draw
 * would give a different set every time the page was refreshed, and a daily
 * challenge that changes when you reload is not a daily challenge.
 */
export declare function challengesFor(day: string): Challenge[];
/** Today, in the player's own timezone, as the key everything hangs off. */
export declare function today(): string;
