import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * Esc. Playing alone, the world stands still and goes quiet until it's
 * resumed; in a party it can't, so it says so and carries on underneath.
 *
 * With the mouse held by the game, the browser keeps Esc for itself and only
 * lets go of the mouse, so that's what opens this: see InputManager.
 */
export declare class PauseMenu implements IUpdatable {
    updateOrder: number;
    private world;
    private root;
    private list;
    private pane;
    private state;
    private who;
    private items;
    private index;
    /** This pause stopped the world, and it's to be started again after. */
    private froze;
    constructor(world: World);
    /** Only runs in a party, where the world doesn't stop: a scenario loading takes the screen it's on. */
    update(timeStep: number, unscaledTimeStep: number): void;
    get isOpen(): boolean;
    /** Whether the world is standing still for it. */
    get freezes(): boolean;
    open(): void;
    close(): void;
    toggle(): void;
    /**
     * Whatever was held when it opened lets go: the key that let go of it will
     * go to the menu, so without this the player walks on after resuming.
     */
    private releaseControls;
    private makeItems;
    private draw;
    private pick;
    private onKey;
    private build;
}
