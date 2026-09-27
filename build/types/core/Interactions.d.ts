import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/** Something the player could do right here: walk up to a counter, pull into a garage. */
export interface Offer {
    /** What E does, as the prompt says it: "Browse guns", "Repair the car  $240". */
    text: string;
    action: () => void;
    /** The higher wins when two are on offer at once. */
    priority?: number;
}
/**
 * The one thing E does at the moment, and the prompt that says so.
 *
 * Anything with something to offer puts it forward every frame it's on offer,
 * and whatever wins is shown at the bottom of the screen until the next one.
 * E then does it, on foot or at the wheel; on a phone the prompt itself is the
 * button. E is only taken while there's something to take it for, so the
 * aircraft and the free camera keep theirs.
 */
export declare class Interactions implements IUpdatable {
    updateOrder: number;
    private world;
    private offers;
    private current;
    private prompt;
    private promptText;
    constructor(world: World);
    /** Put forward for this frame only. */
    offer(offer: Offer): void;
    get available(): boolean;
    /** Does whatever is on offer. False if there wasn't anything. */
    trigger(): boolean;
    update(timeStep: number, unscaledTimeStep: number): void;
}
