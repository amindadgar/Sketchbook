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
    private static readonly STICK_RADIUS;
    private static readonly DEAD_ZONE;
    /** Past this the stick counts as pushed all the way, which is sprint. */
    private static readonly SPRINT_AT;
    static isTouchDevice(): boolean;
    private world;
    private root;
    private knob;
    private pressed;
    private stickTouch;
    private stickOrigin;
    private lookTouch;
    private lookAt;
    constructor(world: World);
    private build;
    private addButton;
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
