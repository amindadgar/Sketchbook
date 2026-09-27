import { Job } from './Job';
import { JobSystem } from './JobSystem';
/**
 * A security van on its round, and what it's carrying.
 *
 * The van is out on the streets across town, marked on the map, with a
 * driver and a guard aboard and a yellow bar on the roof. Stop it: ram it
 * until it gives up, shoot the driver through the window, or box it in and
 * wait. It puts its foot down once it sees you coming, and if it gets far
 * enough ahead it's gone. Stopped, the two of them get out shooting and four
 * cash bags land in the road behind it; each one is money in the wallet as
 * soon as it's picked up. With the first one a safehouse turns up on the
 * map: get there with any at all before the police find the van, for a bonus
 * on every bag brought in.
 */
export declare class HeistJob extends Job {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly pays: string;
    private static readonly VAN_COLOR;
    private static readonly SAFEHOUSE_COLOR;
    private static readonly BAGS;
    private static readonly BONUS;
    /** To stop the van, from the start. */
    private static readonly CHASE_TIME;
    /** From the van stopping to the police turning up at it. */
    private static readonly LOOT_TIME;
    private static readonly SPAWN_MIN;
    private static readonly SPAWN_MAX;
    private static readonly CRUISE;
    private static readonly FLEE;
    /** Near enough for the crew to see who's after them. */
    private static readonly SPOTTED;
    private static readonly LOST;
    /** Knocked about this badly, the driver gives up. */
    private static readonly WRECKED_BELOW;
    /** Held still this long with the player close by, it's been boxed in. */
    private static readonly BOXED_TIME;
    private static readonly BOXED_NEAR;
    /** Longest the van's given to roll to a stop before the crew get out anyway. */
    private static readonly HALT_MAX;
    private static readonly BAG_LIFE;
    /** Each stretch of the round asked for at a time. */
    private static readonly ROUTE;
    /** How long the van has to turn up before it's put down to bad luck. */
    private static readonly ARRIVAL_TIME;
    private stage;
    /** Bumped at every start and end, so a bag picked up after the job's over doesn't count for the next one. */
    private run;
    private van;
    private driver;
    private guard;
    private driverAI;
    private blip;
    private lightBar;
    private barGeometry;
    private barMaterial;
    private safehouse;
    private timeLeft;
    private lootLeft;
    private waiting;
    private halting;
    private stuck;
    private spotted;
    private bagsTaken;
    private bags;
    constructor(system: JobSystem);
    start(): string;
    update(timeStep: number): void;
    cleanup(): void;
    private waitForVan;
    /** Loaded and on the road: marked, lit, and the crew aboard as soon as they can be. */
    private vanArrived;
    private chase;
    /** Pulled up: the driver's foot on the brake, and the police are on their way. */
    private stop;
    private halt;
    private loot;
    /** The driver and the guard, as soon as there are bodies to make them from. */
    private boardCrew;
    /** Both of them out and shooting, whoever's still alive. */
    private crewOut;
    /** Four bags out of the back and into the road behind, each a little to one side. */
    private dropBags;
    /** Somewhere to lie low, well away. False if there's nowhere yet: it's asked for again. */
    private placeSafehouse;
    /** A spot on a lane, far enough off to go looking for, on land and clear of the traffic. */
    private findStart;
    /** More of the round, on from wherever the last stretch ended, so the van never runs out of road. */
    private moreRoad;
    /** Run out of road all the same: a fresh round from where it's sitting. */
    private newRound;
    private routeFrom;
    /** A yellow bar across the roof, so the van can be picked out of the traffic. */
    private buildLightBar;
    /** The bar and the map mark keep up with the van; vehicles move earlier in the frame than jobs do. */
    private followVan;
    private removeBlip;
    /** The fixed ground under a point, for a bag to lie on rather than float over; the van's own height if there's none. */
    private groundBelow;
    /**
     * Where the top of the car's body is, from its origin and turned with it.
     * Measured before anyone's sat in it, since the people ride along as part
     * of the car.
     */
    private static roofOf;
}
