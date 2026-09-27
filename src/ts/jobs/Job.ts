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
export abstract class Job
{
	public abstract readonly id: string;
	public abstract readonly title: string;
	/** A line on the job board saying what it is. */
	public abstract readonly description: string;
	/** What it pays, roughly, for the board. */
	public abstract readonly pays: string;

	protected system: JobSystem;
	protected world: World;

	constructor(system: JobSystem)
	{
		this.system = system;
		this.world = system.world;
	}

	/** Sets the job up. A reason it can't be started, or undefined when it has. */
	public abstract start(): string;

	public abstract update(timeStep: number, unscaledTimeStep: number): void;

	/** Everything this job made, put away. Called however the job ends. */
	public abstract cleanup(): void;

	/** Other players shouldn't see this job's actors as part of the world: most jobs run on this screen only. */
	public get solo(): boolean
	{
		return true;
	}
}
