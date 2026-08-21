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
    private static bindPartyButtons;
    private static commitIdentity;
    private static serverUrl;
    private static bindSwatches;
    private static selectedColor;
    /** Names end up in innerHTML, so they can't be trusted verbatim. */
    private static escape;
}
