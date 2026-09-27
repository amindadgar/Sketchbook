/**
 * What a signed-in player keeps between visits and devices: their money and
 * what it bought, and their experience and today's challenges.
 *
 * The game plays these out on its own screen, as it always has; the server
 * only keeps the result. So it can't say a fare was really driven, and it
 * doesn't try. What it does do is take nothing it doesn't recognise: every
 * field is rebuilt from what's expected, numbers are made whole and kept in
 * bounds, and lists are capped, so a save is always small and always shaped
 * the way the game reads it.
 */

const WEAPON_IDS = new Set(require('../shared/weapons.json').weapons.map((w) => w.id));

/** Enough for anyone playing honestly for a very long time. */
const MAX_MONEY = 1e9;
const MAX_XP = 1e9;
const MAX_VEHICLES = 64;
const MAX_COUNTERS = 64;
const MAX_DONE = 16;
const NAME = /^[a-z0-9_]{1,32}$/;
/** Counters are named as the game names them, topSpeed included. */
const COUNTER = /^[A-Za-z0-9_]{1,32}$/;

function whole(value, max)
{
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) return 0;
	return Math.min(max, Math.round(number));
}

function wallet(input)
{
	const source = input !== null && typeof input === 'object' ? input : {};
	const guns = Array.isArray(source.guns)
		? [...new Set(source.guns.filter((id) => typeof id === 'string' && WEAPON_IDS.has(id)))]
		: [];
	const vehicles = Array.isArray(source.vehicles)
		? source.vehicles
			.filter((v) => v !== null && typeof v === 'object' && typeof v.model === 'string' && NAME.test(v.model))
			.slice(0, MAX_VEHICLES)
			.map((v) => ({ model: v.model, color: whole(v.color, 99) }))
		: [];
	return {
		cash: whole(source.cash, MAX_MONEY),
		guns: guns,
		vehicles: vehicles,
		earned: whole(source.earned, MAX_MONEY)
	};
}

function progress(input)
{
	const source = input !== null && typeof input === 'object' ? input : {};
	const counters = {};
	if (source.counters !== null && typeof source.counters === 'object' && !Array.isArray(source.counters))
	{
		for (const key of Object.keys(source.counters).slice(0, MAX_COUNTERS))
		{
			if (!COUNTER.test(key)) continue;
			const value = Number(source.counters[key]);
			// Distance and airtime count in fractions
			if (Number.isFinite(value) && value >= 0) counters[key] = Math.min(MAX_XP, value);
		}
	}
	const done = Array.isArray(source.done)
		? source.done.filter((id) => typeof id === 'string' && id.length <= 40).slice(0, MAX_DONE)
		: [];
	const day = typeof source.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.day) ? source.day : '';
	// Stunts pay experience in fractions, and a copy that comes back rounded
	// would look like a change every time it's compared with the game's own
	const xp = Number(source.xp);
	return {
		xp: Number.isFinite(xp) && xp >= 0 ? Math.min(MAX_XP, xp) : 0,
		day: day,
		counters: counters,
		done: done
	};
}

/** A save as the game sends it, rebuilt into exactly what's kept, or null if it isn't one. */
function clean(input)
{
	if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
	return { v: 1, wallet: wallet(input.wallet), progress: progress(input.progress) };
}

module.exports = { clean };
