export interface Challenge
{
	id: string;
	label: string;
	/** Which counter it watches, and how much of it finishes the job. */
	metric: string;
	goal: number;
	reward: number;
	/** How to read the running total back, for the panel. */
	unit?: string;
}

/**
 * The pool three of these are drawn from each day.
 *
 * Everything here is something the game already measures, and between them they
 * point at every part of it: drive, fly, race, shoot and crash on purpose. The
 * draw is seeded by the date, so everybody gets the same three on the same day
 * without a server having to decide.
 */
export const CHALLENGE_POOL: Challenge[] = [
	{ id: 'drive', label: 'Drive 3 km', metric: 'distance', goal: 3000, reward: 200, unit: 'm' },
	{ id: 'drive-far', label: 'Drive 8 km', metric: 'distance', goal: 8000, reward: 400, unit: 'm' },
	{ id: 'kills', label: 'Take out 5 players', metric: 'kills', goal: 5, reward: 300 },
	{ id: 'stunts', label: 'Score 2500 stunt points', metric: 'stunt', goal: 2500, reward: 300 },
	{ id: 'big-stunts', label: 'Score 6000 stunt points', metric: 'stunt', goal: 6000, reward: 500 },
	{ id: 'laps', label: 'Complete 6 laps', metric: 'laps', goal: 6, reward: 250 },
	{ id: 'finish', label: 'Finish a race', metric: 'races', goal: 1, reward: 300 },
	{ id: 'podium', label: 'Finish a race in the top three', metric: 'podiums', goal: 1, reward: 500 },
	{ id: 'airtime', label: 'Spend 20 seconds in the air', metric: 'airtime', goal: 20, reward: 250, unit: 's' },
	{ id: 'fast', label: 'Reach 30 metres a second', metric: 'topSpeed', goal: 30, reward: 200 },
	{ id: 'armed', label: 'Pick up 4 weapons', metric: 'pickups', goal: 4, reward: 150 },
	{ id: 'flight', label: 'Fly for 90 seconds', metric: 'flight', goal: 90, reward: 250, unit: 's' },
];

/**
 * Three for the given day, the same three for everyone.
 *
 * A tiny hash of the date rather than a random number, because a random draw
 * would give a different set every time the page was refreshed, and a daily
 * challenge that changes when you reload is not a daily challenge.
 */
export function challengesFor(day: string): Challenge[]
{
	let seed = 0;
	for (let i = 0; i < day.length; i++) seed = (seed * 31 + day.charCodeAt(i)) >>> 0;

	let pool = CHALLENGE_POOL.slice();
	let picked: Challenge[] = [];

	while (picked.length < 3 && pool.length > 0)
	{
		seed = (seed * 1103515245 + 12345) >>> 0;
		let index = seed % pool.length;
		let choice = pool.splice(index, 1)[0];

		// Never two that watch the same counter: finishing one would finish both
		if (picked.some((entry) => entry.metric === choice.metric)) continue;

		picked.push(choice);
	}

	return picked;
}

/** Today, in the player's own timezone, as the key everything hangs off. */
export function today(): string
{
	let now = new Date();
	let month = now.getMonth() + 1;
	let day = now.getDate();

	return now.getFullYear() + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
}
