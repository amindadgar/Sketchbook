import { World } from '../world/World';
import type { JobSystem } from './JobSystem';
/**
 * One kind of work: driving fares, robbing a till, running a parcel across
 * town. The job board lists every one; one runs at a time.
 *
 * A job sets itself up in start(), plays itself out in update(), and pays or
 * fails through the system, which then calls cleanup() to put away whatever
 * it made: its markers, its people, its cars.
 */
export declare abstract class Job {
    abstract readonly id: string;
    abstract readonly title: string;
    /** A line on the job board saying what it is. */
    abstract readonly description: string;
    /** What it pays, roughly, for the board. */
    abstract readonly pays: string;
    protected system: JobSystem;
    protected world: World;
    constructor(system: JobSystem);
    /** Sets the job up. A reason it can't be started, or undefined when it has. */
    abstract start(): string;
    abstract update(timeStep: number, unscaledTimeStep: number): void;
    /** Everything this job made, put away. Called however the job ends. */
    abstract cleanup(): void;
    /** Other players shouldn't see this job's actors as part of the world: most jobs run on this screen only. */
    get solo(): boolean;
}
