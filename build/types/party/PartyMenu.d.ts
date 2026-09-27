import { PlayerIdentity } from './PlayerIdentity';
export interface PartyMenuOptions {
    identity: PlayerIdentity;
    onPlay: () => void;
    onHost: (url: string) => Promise<void>;
    onJoin: (url: string, code: string) => Promise<void>;
}
/**
 * The dialog shown once the world has loaded. Picks the player's name and
 * colour, and optionally starts or joins a party before the game begins.
 */
export declare class PartyMenu {
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
    /**
     * Signing in is optional: the party works without it. What it buys is having
     * kills counted against a name that persists, which is what a leaderboard
     * will be built on.
     */
    private static bindAccount;
    private static googleScript;
    private static googleClient;
    private static googleMode;
    /**
     * Google's answer, used for what its button was shown for: adding Google
     * to the account that was signed in then, or signing in. If the page has
     * changed hands since, it's refused rather than guessed at.
     */
    private static googleAnswered;
    /** Google's sign-in script, fetched the first time a server offers Google. */
    private static loadGoogle;
    /**
     * Google's button, where it belongs: in the sign-in panel for somebody
     * signed out, and under the account for somebody signed in without it,
     * to put it on their account. Nothing at all if the server has no Google.
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
