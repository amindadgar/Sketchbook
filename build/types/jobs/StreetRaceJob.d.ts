import { Job } from './Job';
import { JobSystem } from './JobSystem';
/**
 * A race through the streets against three locals, starting on the road
 * ahead of wherever the player's car is pointing.
 *
 * It costs $100 to enter. The others pull up on the road ahead, there's a
 * count of three, and then it's checkpoint to checkpoint to the finish, the
 * next two showing at a time. The others ease off when they're ahead and push
 * on when they're behind, so it stays close to the end. The first three over
 * the line are paid; last pays nothing, and neither does running out of time.
 */
export declare class StreetRaceJob extends Job {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly pays: string;
    private static readonly FEE;
    private static readonly PRIZES;
    private static readonly PLACES;
    private static readonly COLOR;
    private static readonly AHEAD_COLOR;
    private static readonly FINISH_COLOR;
    private static readonly RIVAL_COLOR;
    private static readonly OUT_COLOR;
    /** About 140 units between checkpoints, the route's points being 4 apart. */
    private static readonly SPACING;
    /** Road past the finish, so the others drive through it rather than park on it. */
    private static readonly RUN_OUT;
    /** Points past the finish a rival's driver has to be looking at to have crossed it. */
    private static readonly OVER_LINE;
    private static readonly SHORTEST;
    /** Grid slots, paces and paint for the three others, front to back: the fastest at the front, so they spread out rather than into each other. */
    private static readonly GRID;
    private static readonly PACES;
    private static readonly PAINT;
    /** A mixed grid: the quick compact, the original car, and a hot hatch. */
    private static readonly MODELS;
    private static readonly SLOWEST;
    private static readonly FASTEST;
    /** How far ahead or behind the player a rival has to be, in units, to go all the way to either. */
    private static readonly BAND;
    private static readonly STEP;
    private static readonly STUCK_LIMIT;
    private static readonly GATHER_LIMIT;
    private static readonly CALLS;
    private stage;
    private route;
    /** Route points to drive through, the last of them the finish. */
    private checkpoints;
    private next;
    private nextMarker;
    private aheadMarker;
    private finishIndex;
    private raceLength;
    private rivals;
    /** The route point the player's nearest, and the last checkpoint they passed. */
    private playerIndex;
    private passed;
    private timer;
    private called;
    private timeLeft;
    constructor(system: JobSystem);
    start(): string;
    update(timeStep: number): void;
    cleanup(): void;
    /** Waits for the others' cars to arrive and their drivers to get in. Goes with whoever's made it if some never do. */
    private gather;
    /** Three, two, one: the others held at the line, the player on their honour. */
    private countDown;
    private race;
    /** Over the line: paid by the place, and last place pays nothing. */
    private cross;
    private arrive;
    /** A driver into the car, held at the line. Tried again next frame while the people are loading. */
    private seat;
    /** Never made it to the line. */
    private scratch;
    /**
     * Who's crossed the line, who's dropped out, and how hard each of the rest
     * pushes: slower the further ahead of the player, faster the further behind.
     */
    private pace;
    private dropOut;
    /** The rivals on the map, where they are this frame. */
    private followRivals;
    /** The player's place: behind everyone who's finished, and everyone still in it who's further along. */
    private place;
    /** The next checkpoint, bright, and the one after it, dimmer. */
    private showCheckpoints;
    private checkpointMarker;
    /**
     * The route point nearest a place, looking only a little way either side of
     * where it was last, so a road the route crosses twice isn't confused for a
     * later stretch of it.
     */
    private nearestIndex;
    private removeBlip;
}
