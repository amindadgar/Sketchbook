import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * The phone, the way GTA does it: up brings it out at the bottom right, the
 * arrows walk the apps, Enter opens one and Backspace comes back. The
 * player can keep walking or driving with it out. Everything the corner of
 * the screen used to list, the keys included, lives in here now.
 *
 * On a phone, a button beside the map brings it out, and the apps are tapped.
 */
export declare class Phone implements IUpdatable {
    updateOrder: number;
    private static readonly REFRESH;
    private world;
    private root;
    private clock;
    private title;
    private home;
    private view;
    private content;
    private hint;
    private apps;
    private selected;
    private current;
    private rows;
    private rowElements;
    private row;
    /** The line a tap or click has picked, which a second one acts on. Arrows don't set it. */
    private armed;
    /** What the app drew last, so a second's redraw that changes nothing leaves it alone. */
    private drawn;
    /** A finger or button down on the phone: a redraw now would take the thing being clicked away. */
    private pressing;
    /** What each address's copy button says, since the rows are drawn afresh. */
    private copied;
    private sinceRefresh;
    /** Asked for the board, and whether that answer is still wanted when it comes. */
    private boardRequest;
    constructor(world: World);
    get isOpen(): boolean;
    open(): void;
    close(): void;
    toggle(): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    /** The game on screen, not a loading screen or a dialog over it. */
    private canShow;
    private canOpen;
    private onKey;
    /** Round the grid on the home screen, wrapping as GTA's does; up and down a list in an app. */
    private move;
    private activate;
    /** Out of an app to the home screen, and from there away. */
    private back;
    private showHome;
    private drawHome;
    private showApp;
    /**
     * Draws the app again, keeping the line picked where it was. Built aside
     * first, and only put on screen if it's changed: most seconds nothing has,
     * and swapping the lines out under a click would lose the click.
     */
    private drawView;
    private select;
    private pickable;
    private rowElement;
    private updateClock;
    /** The game's own time of day, with the sun up at six and down at six. */
    static timeOfDay(world: World): string;
    private makeApps;
    private jobRows;
    /** The boards, from where accounts live: kills, or best laps on the circuit being driven. */
    private showBoard;
    private partyRows;
    private musicRows;
    private supportRows;
    private build;
}
