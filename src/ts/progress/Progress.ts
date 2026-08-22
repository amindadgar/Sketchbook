import { World } from '../world/World';
import { Challenge, challengesFor, today } from './Challenges';

interface Saved
{
	xp: number;
	day: string;
	counters: { [metric: string]: number };
	done: string[];
}

/**
 * Experience, a level, and three things to do today.
 *
 * Everything is counted in the browser rather than on the server. The relay
 * already counts kills against an account, and a second, differently trusted
 * tally of the same thing living beside it would only ever disagree with it.
 * This is the player's own record of their own afternoon.
 */
export class Progress
{
	private static readonly STORAGE_KEY: string = 'sketchbook.progress';
	/** Experience for a kill, a lap, a race finished, and per stunt point. */
	private static readonly XP_KILL: number = 50;
	private static readonly XP_LAP: number = 30;
	private static readonly XP_RACE: number = 120;
	private static readonly XP_PER_STUNT_POINT: number = 0.05;

	private world: World;
	private state: Saved;
	private challenges: Challenge[];
	/** Distance ticks up every frame, and localStorage is not a per frame thing. */
	private dirty: boolean = false;
	private sinceSave: number = 0;

	constructor(world: World)
	{
		this.world = world;
		this.state = this.load();
		this.challenges = challengesFor(this.state.day);
	}

	public get xp(): number
	{
		return Math.floor(this.state.xp);
	}

	/** Levels widen as they go: 100 experience to reach two, 400 to reach three. */
	public get level(): number
	{
		return Math.floor(Math.sqrt(this.xp / 100)) + 1;
	}

	public get levelFloor(): number
	{
		let level = this.level - 1;
		return level * level * 100;
	}

	public get levelCeiling(): number
	{
		return this.level * this.level * 100;
	}

	public get todaysChallenges(): Challenge[]
	{
		return this.challenges;
	}

	public progressOn(challenge: Challenge): number
	{
		return this.state.counters[challenge.metric] || 0;
	}

	public isDone(challenge: Challenge): boolean
	{
		return this.state.done.indexOf(challenge.id) >= 0;
	}

	// ------------------------------------------------------------------ events

	public addKill(): void
	{
		this.award(Progress.XP_KILL);
		this.count('kills', 1);
	}

	public addLap(): void
	{
		this.award(Progress.XP_LAP);
		this.count('laps', 1);
	}

	public addRaceFinish(place: number): void
	{
		this.award(Progress.XP_RACE);
		this.count('races', 1);
		if (place <= 3) this.count('podiums', 1);
	}

	public addStuntPoints(points: number): void
	{
		this.award(points * Progress.XP_PER_STUNT_POINT);
		this.count('stunt', points);
	}

	public addDistance(metres: number): void
	{
		this.count('distance', metres);
	}

	public addAirtime(seconds: number): void
	{
		this.count('airtime', seconds);
	}

	public addFlightTime(seconds: number): void
	{
		this.count('flight', seconds);
	}

	public addPickup(): void
	{
		this.count('pickups', 1);
	}

	/** A high water mark rather than a total, for the "go this fast" sort. */
	public noteSpeed(metresPerSecond: number): void
	{
		this.rollOverIfNewDay();

		if ((this.state.counters['topSpeed'] || 0) >= metresPerSecond) return;

		this.state.counters['topSpeed'] = metresPerSecond;
		this.checkChallenges();
		this.save();
	}

	/** Everything the world measures continuously, rolled up once a frame. */
	public addDriving(metres: number, speed: number, flightSeconds: number, airSeconds: number): void
	{
		if (metres > 0) this.count('distance', metres);
		if (flightSeconds > 0) this.count('flight', flightSeconds);
		if (airSeconds > 0) this.count('airtime', airSeconds);
		if (speed > 0) this.noteSpeed(speed);
	}

	/** Called from the world's own loop, to flush at a sane rate. */
	public update(unscaledTimeStep: number): void
	{
		if (!this.dirty) return;

		this.sinceSave += unscaledTimeStep;
		if (this.sinceSave < 2) return;

		this.sinceSave = 0;
		this.dirty = false;
		this.write();
	}

	// ------------------------------------------------------------------- inner

	private award(xp: number): void
	{
		let before = this.level;
		this.state.xp += xp;

		if (this.level > before)
		{
			this.world.notices.say('Level ' + this.level, 'good', 'reached');
		}

		this.save();
	}

	private count(metric: string, amount: number): void
	{
		this.rollOverIfNewDay();

		this.state.counters[metric] = (this.state.counters[metric] || 0) + amount;
		this.checkChallenges();
		this.save();
	}

	private checkChallenges(): void
	{
		for (const challenge of this.challenges)
		{
			if (this.isDone(challenge)) continue;
			if (this.progressOn(challenge) < challenge.goal) continue;

			this.state.done.push(challenge.id);
			this.state.xp += challenge.reward;

			this.world.notices.say('Challenge done', 'good',
				challenge.label + '  +' + challenge.reward + ' XP');
		}
	}

	/** Counters and challenges are the day's, experience and level are forever. */
	private rollOverIfNewDay(): void
	{
		let now = today();
		if (this.state.day === now) return;

		this.state.day = now;
		this.state.counters = {};
		this.state.done = [];
		this.challenges = challengesFor(now);
	}

	private load(): Saved
	{
		let fresh: Saved = { xp: 0, day: today(), counters: {}, done: [] };

		try
		{
			let raw = window.localStorage.getItem(Progress.STORAGE_KEY);
			if (raw === null) return fresh;

			let saved = JSON.parse(raw);
			let state: Saved = {
				xp: Number(saved.xp) || 0,
				day: typeof saved.day === 'string' ? saved.day : fresh.day,
				counters: saved.counters || {},
				done: Array.isArray(saved.done) ? saved.done : []
			};

			// A save from yesterday keeps its experience and loses its counters
			if (state.day !== fresh.day)
			{
				state.day = fresh.day;
				state.counters = {};
				state.done = [];
			}

			return state;
		}
		catch (error)
		{
			return fresh;
		}
	}

	/** Marks it worth writing. The write itself waits for the next flush. */
	private save(): void
	{
		this.dirty = true;
	}

	private write(): void
	{
		try
		{
			window.localStorage.setItem(Progress.STORAGE_KEY, JSON.stringify(this.state));
		}
		catch (error)
		{
			// Private browsing. The afternoon still counts, it just isn't kept.
		}
	}
}
