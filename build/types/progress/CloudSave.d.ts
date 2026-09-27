import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * Money, what it bought, and experience, kept on the account as well as in
 * the browser, so they follow a signed-in player to any device.
 *
 * The browser remembers the last copy the account was known to hold. When
 * the two meet, on signing in or when another device has saved in between,
 * what happened here since that copy is added to what the account has now:
 * money made and spent on both sides, experience from both, anything bought
 * on either. Without that last copy, the first time on a browser, whichever
 * side has seen more play is taken, with everything bought on both.
 *
 * A browser is one account's at a time. Signing in as somebody else puts the
 * first account's progress aside, kept for when they sign back in, rather
 * than lending it to the new one or throwing it away.
 *
 * Changes are sent a few seconds after they stop, at most every quarter of a
 * minute while they don't, and once more as the tab goes. Each save says
 * which revision it was made from, so a device that saved in between is
 * noticed and its copy put together with this one's before trying again.
 */
export declare class CloudSave implements IUpdatable {
    updateOrder: number;
    private static readonly OWNER_KEY;
    private static readonly BASE_KEY;
    private static readonly STASH_KEY;
    /** Seconds of quiet after a change before sending it. */
    private static readonly QUIET;
    /** Never more often than this, however much is going on. */
    private static readonly MIN_GAP;
    /** And never longer than this, while it keeps changing. */
    private static readonly MAX_WAIT;
    private static readonly RETRY;
    /** Kept here too, for a browser that won't store anything. */
    private static memoryOwner;
    private static memoryBase;
    private world;
    /** Whose copy this is, and which revision of theirs it was last in step with. */
    private userId;
    private revision;
    /** Loaded and put together: from here, changes are sent. */
    private ready;
    private busy;
    private exiting;
    /** The change count at the last acknowledged send or load, -1 while something's owed. */
    private sent;
    private lastSeen;
    private quietFor;
    private sinceSend;
    private waitFor;
    private loadPending;
    constructor(world: World);
    update(timeStep: number, unscaledTimeStep: number): void;
    private signedIn;
    private signedOut;
    private load;
    /**
     * The account's copy and this browser's, made one, and sent back if that
     * isn't what the account already has.
     */
    private reconcile;
    /** In step from here: changes are counted from now, and the browser's copy is this account's. */
    private begin;
    private apply;
    /** The session's over: signed out, and what's here stays here until they sign in again. */
    private expired;
    private send;
    /** The server has it: that's the new last known copy. Anything changed since is still owed. */
    private acknowledged;
    /**
     * Whatever hasn't gone yet, as the tab goes. The browser finishes sending
     * it; if the page is only hidden and hears back, it's taken as sent.
     */
    private sendOnExit;
    private snapshot;
    private changes;
    /** Nothing played yet: what anybody starts with. */
    private static untouched;
    /** How much play a copy has seen: money made and experience, neither of which spending undoes. */
    private static score;
    /** One copy, with everything the other bought as well. */
    private static union;
    /**
     * The account's copy now, plus what this browser did since the copy both
     * last agreed on: money in and out, experience, today's counts, anything
     * bought.
     */
    private static threeWay;
    /**
     * The same copy, written the same way whatever order its fields arrived
     * in: the database hands them back in an order of its own, and that isn't
     * a change worth saving.
     */
    private static canonical;
    private static fresh;
    private static copy;
    /** Which account this browser's copy is. */
    private static owner;
    private static setOwner;
    private static loadBase;
    private static saveBase;
    /** Somebody's progress put aside while another account uses this browser. */
    private static stash;
    private static unstash;
    private static get;
    private static set;
    /** The body of a good answer, or a rejection carrying the status and body of a bad one. */
    private static read;
}
