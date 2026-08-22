import { World } from '../world/World';
/**
 * Touch controls, built only when the device actually has a coarse pointer.
 *
 * Nothing here reaches into the game's own logic. A finger on the stick
 * dispatches the same key events a keyboard would, so every input receiver the
 * engine already has, on foot, in a car, in an aeroplane, keeps its own mapping
 * and none of them need to know touch exists. Desktop never constructs this
 * class at all.
 */
export declare class TouchControls {
    /**
     * What the buttons say and do depends on what the player is currently
     * driving, so ENTER becomes EXIT and a helicopter gets a collective rather
     * than a trigger. The grid is anchored to the bottom right corner and fills
     * row by row, so the last entries keep their place as the set grows: put the
     * buttons that mean the same thing everywhere at the end.
     */
    private static readonly LAYOUTS;
    private static readonly STICK_RADIUS;
    private static readonly DEAD_ZONE;
    /** Past this the stick counts as pushed all the way, which is sprint. */
    private static readonly SPRINT_AT;
    static isTouchDevice(): boolean;
    private world;
    private root;
    private knob;
    private buttonBar;
    private context;
    private pressed;
    private stickTouch;
    private stickOrigin;
    private lookTouch;
    private lookAt;
    constructor(world: World);
    /**
     * Only works where the page is already fullscreen or installed to a home
     * screen, and throws outright on iOS, so the portrait notice is what actually
     * carries this. This is the nicety on top of it.
     */
    private static lockLandscape;
    private build;
    /** Held rather than tapped: firing, braking and climbing all want holding. */
    private addButton;
    /** Called every frame by the world; swapping the buttons is the rare case. */
    update(): void;
    private readContext;
    private applyContext;
    private releaseAll;
    private onStickStart;
    private onStickMove;
    private onStickEnd;
    private moveKnob;
    private onLookStart;
    private onLookMove;
    private onLookEnd;
    private findTouch;
    /** The same key events a keyboard would send, so every receiver maps them itself. */
    private press;
    /**
     * Straight to the receiver rather than through a synthetic mouse event:
     * the mouse path asks for pointer lock, which mobile browsers don't have.
     */
    private mouse;
}
