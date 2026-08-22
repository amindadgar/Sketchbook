import { World } from '../world/World';
/**
 * The four things somebody needs to know in their first ten seconds.
 *
 * Desktop has the whole control list down the left hand side, so this is mostly
 * for a phone, where the keyboard hints are hidden and the buttons are the only
 * clue. Shown once, remembered, and dismissed by touching anything.
 */
export declare class Onboarding {
    private static readonly STORAGE_KEY;
    private static readonly LINGER;
    private world;
    private card;
    private left;
    private showing;
    constructor(world: World);
    /** Called once the menu is out of the way and the game is actually running. */
    begin(): void;
    update(unscaledTimeStep: number): void;
    private hide;
    private static lines;
    private seen;
    private remember;
}
