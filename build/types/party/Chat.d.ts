import { World } from '../world/World';
/**
 * Party chat: a log that fades out and a line you type into.
 *
 * The game reads the keyboard off the document, so while the box has focus
 * every key has to be kept away from it, or saying hello walks the character
 * into the sea. That's what the typing flag is for.
 */
export declare class Chat {
    private static readonly HISTORY;
    /** How long a line stays on screen once nobody is typing. */
    private static readonly LINGER;
    private world;
    private input;
    private log;
    private open;
    private visible;
    private linger;
    constructor(world: World);
    /** True while the box has focus, which is when the game must ignore the keys. */
    get typing(): boolean;
    get available(): boolean;
    begin(): void;
    close(): void;
    update(unscaledTimeStep: number): void;
    /** Somebody said something, including this player. */
    receive(name: string, color: string, text: string): void;
    private onInputKey;
}
