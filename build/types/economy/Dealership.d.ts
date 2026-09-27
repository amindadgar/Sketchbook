import { World } from '../world/World';
import { ShopSystem } from './ShopSystem';
import { Vehicle } from '../vehicles/Vehicle';
/**
 * Northside Motors: every car and bike there is, for money, in a colour of
 * your choosing.
 *
 * A bought one is left on the lot beside the counter, and it's yours for
 * good: come back and it's brought round again for nothing, in whatever
 * colour's picked. One at a time: the last one taken out goes back when the
 * next comes out, if nobody's in it.
 */
export declare class Dealership {
    private static readonly COLOR_NAMES;
    private world;
    private shops;
    private site;
    private color;
    private showing;
    /** The one out on the road now. */
    private current;
    /** Everything ever brought round, which has papers: no chop shop will take one. */
    private handedOut;
    constructor(world: World, shops: ShopSystem);
    private show;
    private row;
    /** Brought round to the lot, facing the street. */
    private takeOut;
    /** Whether a vehicle came from here, and so is somebody's, on paper. */
    sold(vehicle: Vehicle): boolean;
    /** The last one out goes back, unless somebody's using it: then it's left to the streets. */
    private putAway;
}
