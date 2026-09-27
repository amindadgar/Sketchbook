import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * Holding people up in the street, whenever, job or no job.
 *
 * Aim a gun at somebody on the pavement from close by and keep it on them:
 * they stop with the gun on them, and after a moment they drop what they're
 * carrying and run. Everybody carries something, a few carry a lot, and
 * nobody can be robbed twice. Looking away lets them go.
 */
export declare class Mugging implements IUpdatable {
    updateOrder: number;
    /** Near enough to be threatening. */
    private static readonly REACH;
    /** How long the gun has to stay on them. */
    private static readonly HOLD;
    private world;
    private target;
    private held;
    private robbed;
    private announced;
    private prompt;
    private external;
    constructor(world: World);
    /** A job holding somebody up of its own shows how far along it is on the same ring, for this frame. */
    showHoldUp(fraction: number): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    /** Who's under the crosshair, if a gun's up and they can still be robbed. */
    private aimedAt;
    /** A ring filling round the crosshair while they hand it over. */
    private showProgress;
}
