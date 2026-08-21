import { PlayerIdentity } from './PlayerIdentity';
/**
 * The dialog shown once the world has loaded, where the player picks the name
 * and colour their character, their car and their name tag will use.
 */
export declare class PartyMenu {
    static show(identity: PlayerIdentity, onPlay: () => void): void;
    private static buildHtml;
    private static bindSwatches;
    private static selectedColor;
    /** Names end up in innerHTML, so they can't be trusted verbatim. */
    private static escape;
}
