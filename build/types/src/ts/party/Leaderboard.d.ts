import { World } from '../world/World';
/**
 * The boards the server has been keeping all along and nothing ever showed:
 * kills across every party, and best laps per circuit.
 */
export declare class Leaderboard {
    private world;
    private panel;
    private open;
    constructor(world: World);
    toggle(): void;
    hide(): void;
    show(): void;
    private fill;
    /** Everything here came off the network, so all of it is written as text. */
    private setRows;
}
