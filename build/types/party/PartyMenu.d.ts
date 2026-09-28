import { PlayerIdentity } from './PlayerIdentity';
export interface PartyMenuOptions {
    identity: PlayerIdentity;
    onPlay: () => void;
    onHost: (url: string) => Promise<void>;
    onJoin: (url: string, code: string) => Promise<void>;
}
/**
 * The dialog shown once the world has loaded. Signs the player in, picks
 * their name and colour, and optionally starts or joins a party before the
 * game begins.
 *
 * Where the game's own relay has Google sign-in set up, signing in with it
 * is how the game starts: playing solo, hosting and joining all wait for it.
 */
export declare class PartyMenu {
    /** Whether playing waits for a Google sign-in. Undefined until the relay has said. */
    private static required;
    /** A stored session being picked back up, which may well make signing in unnecessary. */
    private static resuming;
    private static showing;
    /** A party being hosted or joined, which holds the buttons down until it's settled. */
    private static connecting;
    private static googleClientId;
    private static retryTimer;
    private static readonly RETRY_MS;
    static show(options: PartyMenuOptions): void;
    private static buildHtml;
    /**
     * Phones run this far better once installed, so say so, but only where it
     * can actually be acted on: a touch device that isn't already standalone.
     */
    private static buildInstallHint;
    private static isInstalled;
    private static isIOS;
    private static bindPartyButtons;
    /**
     * The server row: what it's set to now, and a way to change it. Presets are
     * labelled with the address they resolve to, so picking one is a choice
     * between places rather than a URL to be typed correctly.
     */
    private static bindServerPicker;
    /** Where accounts live: always the game's own relay, whichever server a party is on. */
    private static accountServer;
    /** Signed in the way this server needs, or it needs nothing. */
    private static mayPlay;
    /** Play, host and join, usable or greyed out to match. */
    private static updateGate;
    /** Served from this machine, where the game is being worked on and a relay may not be running. */
    private static isLocalPage;
    /**
     * Asks the relay whether it has Google sign-in, which makes it required.
     * A relay that can't be reached is asked again until it answers: playing
     * without the sign-in it may want isn't an option. Except on this machine,
     * where nobody should need a relay running to try a change.
     */
    private static checkRequired;
    /**
     * The account: signed in or not, and how to be. With Google required
     * that's its button and nothing else, apart from a way for somebody who
     * made an account with a password before to sign in to it once and put
     * Google on it. Without Google it's names and passwords, and optional.
     */
    private static bindAccount;
    private static passwordAgain;
    private static offerMove;
    private static googleScript;
    private static googleClient;
    private static googleMode;
    /**
     * Google's answer, used for what its button was shown for: adding Google
     * to the account that was signed in then, or signing in. If the page has
     * changed hands since, it's refused rather than guessed at.
     */
    private static googleAnswered;
    /** Sends Google's answer, and deals with the two ways putting it on an account can be turned down. */
    private static sendGoogle;
    /** Google's sign-in script, fetched the first time a server offers Google. */
    private static loadGoogle;
    /**
     * Google's button, where it belongs: under the account for somebody signed
     * out, to sign in, and for somebody signed in without it, to put it on
     * their account. Nothing at all while the relay is still being asked, or
     * if it has no Google.
     */
    private static showGoogle;
    private static commitIdentity;
    private static serverUrl;
    private static bindSwatches;
    /** One of a row is chosen at a time, and a locked one is never chosen. */
    private static bindPicker;
    private static unlockLabel;
    private static selectedColor;
    private static selectedHat;
    /** Names end up in innerHTML, so they can't be trusted verbatim. */
    private static escape;
}
