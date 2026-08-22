import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Scenario } from '../world/Scenario';
/**
 * Laps, times and running order for the race scenarios.
 *
 * The world file has shipped the tracks all along: each race parks a grid of
 * cars and points the computer drivers at a ring of path nodes, and the
 * scenario blurbs say outright that there is no lap or position tracking yet.
 * That ring is the track, so it is what the gates are made of, rather than a
 * second set of coordinates written down somewhere that could drift from it.
 */
export declare class RaceSystem implements IUpdatable {
    updateOrder: number;
    private static readonly LAPS;
    private static readonly COUNTDOWN;
    /** How near a gate counts as through it. The drivers use ten for the same ring. */
    private static readonly GATE_RADIUS;
    private static readonly BEST_KEY;
    private static scratch;
    private world;
    private gates;
    private marker;
    private track;
    private armed;
    private countdown;
    private running;
    private lap;
    private gate;
    private lapTime;
    private bestLap;
    private totalTime;
    private place;
    private field;
    constructor(world: World);
    /** True while the lights are still on, which is what holds the grid. */
    get holding(): boolean;
    get active(): boolean;
    /** Which circuit is being driven, for the board that goes with it. */
    get trackId(): string;
    /**
     * A scenario is a race when it hands a computer driver a path to follow.
     * Nothing is matched on names, so a new race added to the world file gets
     * timed without anything here being told about it.
     */
    begin(scenario: Scenario): void;
    stop(): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    /** Walks the ring of path nodes from the one the drivers are given. */
    private readTrack;
    private findNode;
    private checkGate;
    private completeLap;
    private finish;
    /** Everyone on track, the player and the computer drivers, in running order. */
    private rank;
    private gateIndexOf;
    /**
     * Holds the grid with the brakes rather than by ignoring the controls.
     * Swallowing the keys would mean a driver already on the throttle when the
     * lights went out sat there until they let go and pressed it again.
     *
     * The cars update before this does, so whatever the last frame asked the
     * engine for is overwritten here and never reaches the solver.
     */
    private holdGrid;
    private releaseGrid;
    /** Holds the computer drivers on the grid until the lights go out. */
    private setFieldPaused;
    private eachDriver;
    /**
     * One ring, moved to whichever gate is next, rather than a fence of thirty
     * of them. It's there to say which way to go, and the way to go is next.
     */
    private buildMarker;
    private moveMarker;
    private disposeMarker;
    private draw;
    static clock(seconds: number): string;
    private static pad;
    /**
     * Kept in the browser either way, and sent up to the account as well when
     * there is one, so a signed out lap still counts for something.
     */
    private loadBest;
    private saveBest;
}
