import * as THREE from 'three';
import { Job } from './Job';
import { JobSystem, JobMarker } from './JobSystem';
import { Driver, laneRoute, nearestLane } from './JobAI';
import { Character } from '../characters/Character';
import { Vehicle } from '../vehicles/Vehicle';
import { Blip } from '../core/Minimap';
import { CityPlan } from '../city/CityPlan';

type Stage = 'gathering' | 'countdown' | 'racing';

/** One of the other cars in the race. */
interface Rival
{
	/** Its place on the grid, as a point along the route. */
	grid: number;
	/** How fast it drives when it's level with the player. */
	pace: number;
	paint: number;
	vehicle: Vehicle;
	driver: Character;
	ai: Driver;
	blip: Blip;
	/** The route point it's nearest now. */
	progress: number;
	/** The furthest its driver has got, and how long since it got any further. */
	furthest: number;
	stuckFor: number;
	finished: boolean;
	/** Stuck, stopped or out of the car: not counted any more. */
	out: boolean;
}

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
export class StreetRaceJob extends Job
{
	public readonly id: string = 'streetrace';
	public readonly title: string = 'Street race';
	public readonly description: string = 'Race three locals through the streets from wherever you are. $100 to enter; the first three over the line get paid.';
	public readonly pays: string = '$200 - $900';

	private static readonly FEE: number = 100;
	private static readonly PRIZES: number[] = [900, 450, 200];
	private static readonly PLACES: string[] = ['first', 'second', 'third'];
	private static readonly COLOR: string = '#35c8ff';
	private static readonly AHEAD_COLOR: string = '#1c6680';
	private static readonly FINISH_COLOR: string = '#ffffff';
	private static readonly RIVAL_COLOR: string = '#ff8a1c';
	private static readonly OUT_COLOR: string = '#8c8c8c';
	/** About 140 units between checkpoints, the route's points being 4 apart. */
	private static readonly SPACING: number = 35;
	/** Road past the finish, so the others drive through it rather than park on it. */
	private static readonly RUN_OUT: number = 15;
	/** Points past the finish a rival's driver has to be looking at to have crossed it. */
	private static readonly OVER_LINE: number = 4;
	private static readonly SHORTEST: number = 60;
	/** Grid slots, paces and paint for the three others, front to back: the fastest at the front, so they spread out rather than into each other. */
	private static readonly GRID: number[] = [8, 5, 2];
	private static readonly PACES: number[] = [18, 17, 16];
	private static readonly PAINT: number[] = [5, 9, 7];
	/** A mixed grid: the quick compact, the original car, and a hot hatch. */
	private static readonly MODELS: string[] = ['sleeper', 'car', 'hatchback'];
	private static readonly SLOWEST: number = 13;
	private static readonly FASTEST: number = 21;
	/** How far ahead or behind the player a rival has to be, in units, to go all the way to either. */
	private static readonly BAND: number = 80;
	private static readonly STEP: number = 4;
	private static readonly STUCK_LIMIT: number = 20;
	private static readonly GATHER_LIMIT: number = 15;
	private static readonly CALLS: string[] = ['3', '2', '1'];

	private stage: Stage;
	private route: THREE.Vector3[] = [];
	/** Route points to drive through, the last of them the finish. */
	private checkpoints: number[] = [];
	private next: number = 0;
	private nextMarker: JobMarker;
	private aheadMarker: JobMarker;
	private finishIndex: number = 0;
	private raceLength: number = 0;
	private rivals: Rival[] = [];
	/** The route point the player's nearest, and the last checkpoint they passed. */
	private playerIndex: number = 0;
	private passed: number = 0;
	private timer: number = 0;
	private called: number = 0;
	private timeLeft: number = 0;

	constructor(system: JobSystem)
	{
		super(system);
	}

	public start(): string
	{
		let car = this.system.drivenVehicle();
		if (car === undefined) return 'get behind the wheel of a car first';
		if (this.world.npcs === undefined) return 'the streets aren\'t ready yet';

		// The start line: the road ahead of the car, the way it's pointing
		let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion).setY(0).normalize();
		let found = nearestLane(this.world.npcs.navigation, car.position, forward);
		if (found === undefined || found.gap > 20) return 'line up on a road first';
		let route = laneRoute(found.lane, found.distance + 30, 1800, 0.75);
		if (route.length < StreetRaceJob.SHORTEST + StreetRaceJob.RUN_OUT) return 'there isn\'t enough road ahead';

		// Nothing's taken until it's sure the race can run
		if (!this.world.wallet.spend(StreetRaceJob.FEE)) return 'the entry fee is $100';

		this.route = route;
		this.finishIndex = route.length - 1 - StreetRaceJob.RUN_OUT;
		this.checkpoints = [];
		for (let i = StreetRaceJob.SPACING; i < this.finishIndex - StreetRaceJob.SPACING / 2; i += StreetRaceJob.SPACING) this.checkpoints.push(i);
		this.checkpoints.push(this.finishIndex);
		this.raceLength = 30;
		for (let i = 1; i <= this.finishIndex; i++) this.raceLength += route[i].distanceTo(route[i - 1]);

		this.next = 0;
		this.passed = 0;
		this.playerIndex = 0;
		this.nextMarker = undefined;
		this.aheadMarker = undefined;
		this.showCheckpoints();

		// Before the cars are asked for: one already loaded arrives straight away
		this.stage = 'gathering';
		this.timer = 0;

		// The others, one behind another on the road ahead
		this.rivals = [];
		for (let i = 0; i < StreetRaceJob.GRID.length; i++)
		{
			let grid = StreetRaceJob.GRID[i];
			let rival: Rival = {
				grid: grid,
				pace: StreetRaceJob.PACES[i] + (Math.random() - 0.5),
				paint: StreetRaceJob.PAINT[i],
				vehicle: undefined,
				driver: undefined,
				ai: undefined,
				blip: { position: route[grid].clone(), color: StreetRaceJob.RIVAL_COLOR, shape: 'dot' },
				progress: grid,
				furthest: grid,
				stuckFor: 0,
				finished: false,
				out: false
			};
			this.world.blips.push(rival.blip);
			this.rivals.push(rival);
			let along = route[grid + 1].clone().sub(route[grid]);
			this.system.addVehicle(route[grid], Math.atan2(along.x, along.z), rival.paint, (vehicle) => this.arrive(rival, vehicle), StreetRaceJob.MODELS[i]);
		}

		return undefined;
	}

	public update(timeStep: number): void
	{
		this.followRivals();
		switch (this.stage)
		{
			case 'gathering': this.gather(timeStep); break;
			case 'countdown': this.countDown(timeStep); break;
			case 'racing': this.race(timeStep); break;
		}
	}

	public cleanup(): void
	{
		for (const rival of this.rivals) this.removeBlip(rival.blip);
		this.rivals = [];
		this.nextMarker = undefined;
		this.aheadMarker = undefined;
	}

	// The stages

	/** Waits for the others' cars to arrive and their drivers to get in. Goes with whoever's made it if some never do. */
	private gather(timeStep: number): void
	{
		this.timer += timeStep;
		this.system.setHud('Line up at the start', 'the others are pulling up');
		for (const rival of this.rivals)
		{
			if (rival.vehicle !== undefined && rival.ai === undefined) this.seat(rival);
		}
		let waiting = this.rivals.filter((rival) => rival.ai === undefined);
		if (waiting.length > 0 && this.timer < StreetRaceJob.GATHER_LIMIT) return;

		for (const rival of waiting) this.scratch(rival);
		if (this.rivals.length === 0)
		{
			// Nobody to race: the fee goes back
			this.world.wallet.add(StreetRaceJob.FEE, 'entry fee back');
			this.system.fail('nobody turned up to race');
			return;
		}
		this.stage = 'countdown';
		this.timer = -0.6;
		this.called = 0;
	}

	/** Three, two, one: the others held at the line, the player on their honour. */
	private countDown(timeStep: number): void
	{
		this.timer += timeStep;
		this.system.setHud('Get ready', 'go on GO');
		if (this.called < StreetRaceJob.CALLS.length && this.timer >= this.called)
		{
			this.world.notices.say(StreetRaceJob.CALLS[this.called]);
			this.called++;
		}
		if (this.timer < StreetRaceJob.CALLS.length) return;

		this.world.notices.say('GO', 'good', Math.round(this.raceLength / CityPlan.METRE) + ' m to the finish');
		for (const rival of this.rivals) rival.ai.paused = false;
		this.timeLeft = Math.round(this.raceLength / 11 + 20);
		this.stage = 'racing';
	}

	private race(timeStep: number): void
	{
		this.timeLeft -= timeStep;
		let car = this.system.drivenVehicle();
		let at = car !== undefined ? car.position : this.system.playerPosition();
		this.playerIndex = Math.max(this.passed, this.nearestIndex(at, this.playerIndex, 20, 80));
		this.pace(timeStep);

		// Only driven through counts
		if (car !== undefined && this.nextMarker !== undefined && this.nextMarker.contains(car.position, 2))
		{
			this.passed = this.checkpoints[this.next];
			this.next++;
			if (this.next >= this.checkpoints.length)
			{
				this.cross();
				return;
			}
			this.showCheckpoints();
		}

		if (this.timeLeft <= 0)
		{
			this.system.fail('too slow');
			return;
		}

		let racing = 1 + this.rivals.filter((rival) => !rival.out).length;
		let detail = 'position ' + this.place() + ' of ' + racing;
		if (car === undefined) this.system.setHud('Get back in a car', detail, this.timeLeft);
		else this.system.setHud('Checkpoint ' + (this.next + 1) + ' / ' + this.checkpoints.length, detail, this.timeLeft);
	}

	/** Over the line: paid by the place, and last place pays nothing. */
	private cross(): void
	{
		let place = 1 + this.rivals.filter((rival) => rival.finished).length;
		// Last of whoever actually raced gets nothing, however few made the grid
		let field = 1 + this.rivals.filter((rival) => rival.finished || !rival.out).length;
		if (place > StreetRaceJob.PRIZES.length || (field > 1 && place === field))
		{
			this.system.fail(StreetRaceJob.PLACES[place - 1] + ' and last: better luck next time');
			return;
		}
		let placing = StreetRaceJob.PLACES[place - 1];
		this.system.pay(StreetRaceJob.PRIZES[place - 1], placing + ' in a street race');
		this.system.finish(placing + ' over the line');
	}

	// The others

	private arrive(rival: Rival, vehicle: Vehicle): void
	{
		// Too late: the race went without it
		if (this.stage !== 'gathering' || this.rivals.indexOf(rival) < 0)
		{
			this.system.removeVehicle(vehicle);
			return;
		}
		rival.vehicle = vehicle;
		this.seat(rival);
	}

	/** A driver into the car, held at the line. Tried again next frame while the people are loading. */
	private seat(rival: Rival): void
	{
		let driver = this.system.seatPerson(rival.vehicle, true);
		if (driver === undefined) return;
		rival.driver = driver;
		rival.ai = new Driver(this.route, rival.pace);
		// Picks up the route from its own slot on the grid, not back at the start
		rival.ai.index = rival.grid;
		rival.ai.paused = true;
		this.system.setMind(driver, rival.ai);
	}

	/** Never made it to the line. */
	private scratch(rival: Rival): void
	{
		if (rival.vehicle !== undefined) this.system.removeVehicle(rival.vehicle);
		this.removeBlip(rival.blip);
		let i = this.rivals.indexOf(rival);
		if (i >= 0) this.rivals.splice(i, 1);
	}

	/**
	 * Who's crossed the line, who's dropped out, and how hard each of the rest
	 * pushes: slower the further ahead of the player, faster the further behind.
	 */
	private pace(timeStep: number): void
	{
		for (const rival of this.rivals)
		{
			if (rival.out || rival.finished) continue;
			if (rival.ai.done || rival.ai.index > this.finishIndex + StreetRaceJob.OVER_LINE)
			{
				rival.finished = true;
				continue;
			}

			// Out of it: the car's gone, or the driver's down or out of it
			if (rival.vehicle.world === undefined || rival.driver.health <= 0 || rival.driver.occupyingSeat === null)
			{
				this.dropOut(rival);
				continue;
			}
			rival.progress = this.nearestIndex(rival.vehicle.position, Math.min(rival.ai.index, this.route.length - 1), 8, 0);

			// Going nowhere for too long: left out of the placings
			if (rival.ai.index > rival.furthest)
			{
				rival.furthest = rival.ai.index;
				rival.stuckFor = 0;
			}
			else
			{
				rival.stuckFor += timeStep;
				if (rival.stuckFor > StreetRaceJob.STUCK_LIMIT)
				{
					this.dropOut(rival);
					continue;
				}
			}

			let lead = THREE.MathUtils.clamp((rival.progress - this.playerIndex) * StreetRaceJob.STEP / StreetRaceJob.BAND, -1, 1);
			let wanted = lead > 0
				? THREE.MathUtils.lerp(rival.pace, StreetRaceJob.SLOWEST, lead)
				: THREE.MathUtils.lerp(rival.pace, StreetRaceJob.FASTEST, -lead);

			// Not into the back of another of them: no faster than them when right behind
			for (const other of this.rivals)
			{
				if (other === rival || other.out || other.finished) continue;
				let gap = other.progress - rival.progress;
				if (gap > 0 && gap <= 3) wanted = Math.min(wanted, other.ai.speed - 1.5);
			}
			wanted = Math.max(8, wanted);
			rival.ai.speed += (wanted - rival.ai.speed) * Math.min(1, timeStep * 0.6);
		}
	}

	private dropOut(rival: Rival): void
	{
		rival.out = true;
		rival.blip.color = StreetRaceJob.OUT_COLOR;
		this.world.notices.say('A rival dropped out');
	}

	/** The rivals on the map, where they are this frame. */
	private followRivals(): void
	{
		for (const rival of this.rivals)
		{
			if (rival.vehicle !== undefined && rival.vehicle.world !== undefined) rival.blip.position.copy(rival.vehicle.position);
		}
	}

	/** The player's place: behind everyone who's finished, and everyone still in it who's further along. */
	private place(): number
	{
		return 1 + this.rivals.filter((rival) => rival.finished || (!rival.out && rival.progress > this.playerIndex)).length;
	}

	// The route

	/** The next checkpoint, bright, and the one after it, dimmer. */
	private showCheckpoints(): void
	{
		this.system.removeMarker(this.nextMarker);
		this.system.removeMarker(this.aheadMarker);
		this.nextMarker = this.checkpointMarker(this.next, StreetRaceJob.COLOR);
		this.aheadMarker = this.next + 1 < this.checkpoints.length ? this.checkpointMarker(this.next + 1, StreetRaceJob.AHEAD_COLOR) : undefined;
		// The panel's arrow is for the one to drive through now
		this.system.wayTo = this.nextMarker.position;
		if (this.aheadMarker !== undefined) this.aheadMarker.blip.pin = false;
	}

	private checkpointMarker(n: number, color: string): JobMarker
	{
		let finish = n === this.checkpoints.length - 1;
		return this.system.addMarker(this.route[this.checkpoints[n]], finish ? StreetRaceJob.FINISH_COLOR : color, 5, finish ? 'Finish' : 'Checkpoint');
	}

	/**
	 * The route point nearest a place, looking only a little way either side of
	 * where it was last, so a road the route crosses twice isn't confused for a
	 * later stretch of it.
	 */
	private nearestIndex(at: THREE.Vector3, around: number, back: number, ahead: number): number
	{
		let from = Math.max(0, around - back);
		let to = Math.min(this.route.length - 1, around + ahead);
		let best = around;
		let bestGap = Infinity;
		for (let i = from; i <= to; i++)
		{
			let dx = this.route[i].x - at.x;
			let dz = this.route[i].z - at.z;
			let gap = dx * dx + dz * dz;
			if (gap < bestGap)
			{
				bestGap = gap;
				best = i;
			}
		}
		return best;
	}

	private removeBlip(blip: Blip): void
	{
		let i = this.world.blips.indexOf(blip);
		if (i >= 0) this.world.blips.splice(i, 1);
	}
}
