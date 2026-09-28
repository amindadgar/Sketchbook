/**
 * Postgres for accounts and their tallies.
 *
 * The schema is created on boot rather than by a migration tool: a handful of
 * tables, and the one change to an existing one is written so it can run on
 * every boot. If this grows changes that can't be, that's the moment to bring
 * in a migration framework.
 */

const { Pool } = require('pg');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
	id           SERIAL PRIMARY KEY,
	username     TEXT NOT NULL,
	username_key TEXT NOT NULL UNIQUE,
	password     TEXT NOT NULL,
	created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS laps (
	user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	track      TEXT NOT NULL,
	best_ms    INTEGER NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, track)
);

CREATE TABLE IF NOT EXISTS stats (
	user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	kills      INTEGER NOT NULL DEFAULT 0,
	deaths     INTEGER NOT NULL DEFAULT 0,
	played     INTEGER NOT NULL DEFAULT 0,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saves (
	user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	data       JSONB NOT NULL,
	revision   INTEGER NOT NULL DEFAULT 1,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Signing in with Google: an account known by Google's id for the person, with
-- no password of its own. Each change is made only if it hasn't been, since an
-- ALTER locks the table even when it has nothing to do, on every boot
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'google_sub') THEN
		ALTER TABLE users ADD COLUMN google_sub TEXT;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'email') THEN
		ALTER TABLE users ADD COLUMN email TEXT;
	END IF;
	IF EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'password' AND is_nullable = 'NO') THEN
		ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_indexes
		WHERE schemaname = current_schema() AND indexname = 'users_google_sub') THEN
		CREATE UNIQUE INDEX users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;
	END IF;
END $$;
`;

let pool = null;

/** Null when no DATABASE_URL is set: the party still runs, just without accounts. */
function available()
{
	return pool !== null;
}

async function connect()
{
	const url = process.env.DATABASE_URL;

	if (!url)
	{
		console.log('db: no DATABASE_URL, accounts are disabled');
		return false;
	}

	// Only when the connection string asks for it. A managed database reached
	// over a private network doesn't want SSL, and guessing from the hostname
	// gets it wrong for anything that isn't called localhost.
	const wantsSsl = /sslmode=require/i.test(url) || process.env.PGSSLMODE === 'require';

	const candidate = new Pool({
		connectionString: url,
		// Managed providers present certificates the client can't chain
		ssl: wantsSsl ? { rejectUnauthorized: false } : false,
		max: 5
	});

	// On one connection, with a limit on waiting for a lock: a backup or an
	// open transaction holding the table mustn't leave the relay unable to boot
	const client = await candidate.connect();
	try
	{
		await client.query("SET lock_timeout = '5s'");
		await client.query(SCHEMA);
	}
	catch (error)
	{
		client.release(true);
		await candidate.end().catch(() => undefined);
		throw error;
	}
	client.release(true);

	// Only now: accounts on a schema half made would fail in stranger ways than none
	pool = candidate;
	console.log('db: connected, accounts are enabled');
	return true;
}

/** Usernames are matched case insensitively but kept as typed. */
function key(username)
{
	return username.trim().toLowerCase();
}

async function createUser(username, password)
{
	const result = await pool.query(
		`INSERT INTO users (username, username_key, password) VALUES ($1, $2, $3)
		 ON CONFLICT (username_key) DO NOTHING
		 RETURNING id, username`,
		[username.trim(), key(username), password]);

	if (result.rowCount === 0) return null;

	const user = result.rows[0];
	await pool.query('INSERT INTO stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
	return user;
}

async function findUser(username)
{
	const result = await pool.query(
		'SELECT id, username, password, (google_sub IS NOT NULL) AS google FROM users WHERE username_key = $1', [key(username)]);

	return result.rows[0] || null;
}

/**
 * The account and its tallies, or null for none: including one Google was
 * moved off, which has no way in left, so a session it had is over too.
 */
async function getProfile(userId)
{
	const result = await pool.query(
		`SELECT u.id, u.username, s.kills, s.deaths, s.played, (u.google_sub IS NOT NULL) AS google
		 FROM users u LEFT JOIN stats s ON s.user_id = u.id
		 WHERE u.id = $1 AND (u.password IS NOT NULL OR u.google_sub IS NOT NULL)`, [userId]);

	return result.rows[0] || null;
}

async function recordKill(userId)
{
	await pool.query(
		`UPDATE stats SET kills = kills + 1, updated_at = now() WHERE user_id = $1`, [userId]);
}

async function recordDeath(userId)
{
	await pool.query(
		`UPDATE stats SET deaths = deaths + 1, updated_at = now() WHERE user_id = $1`, [userId]);
}

async function recordPlayed(userId)
{
	await pool.query(
		`UPDATE stats SET played = played + 1, updated_at = now() WHERE user_id = $1`, [userId]);
}

/** Ordered by kills, for the board with no track chosen. */
async function leaderboard(limit)
{
	const result = await pool.query(
		`SELECT u.username, s.kills, s.deaths, s.played
		 FROM stats s JOIN users u ON u.id = s.user_id
		 ORDER BY s.kills DESC, s.deaths ASC, u.username ASC
		 LIMIT $1`, [Math.min(limit || 20, 100)]);

	return result.rows;
}

/** The player's kept progress and its revision, or null before the first save. */
async function getSave(userId)
{
	const result = await pool.query('SELECT data, revision FROM saves WHERE user_id = $1', [userId]);
	return result.rows[0] || null;
}

/**
 * Writes a save made from a given revision. Only lands if that's still the
 * latest, so a tab left open on an old copy, or a second device, can't write
 * over something newer without first having seen it. Returns the new
 * revision, or null when somebody got there first.
 */
async function putSave(userId, data, basedOn)
{
	if (basedOn === 0)
	{
		const inserted = await pool.query(
			`INSERT INTO saves (user_id, data) VALUES ($1, $2)
			 ON CONFLICT (user_id) DO NOTHING
			 RETURNING revision`, [userId, JSON.stringify(data)]);
		return inserted.rowCount === 1 ? inserted.rows[0].revision : null;
	}

	const updated = await pool.query(
		`UPDATE saves SET data = $2, revision = revision + 1, updated_at = now()
		 WHERE user_id = $1 AND revision = $3
		 RETURNING revision`, [userId, JSON.stringify(data), basedOn]);
	return updated.rowCount === 1 ? updated.rows[0].revision : null;
}

/** An account by the Google id of the person who signed in with it. */
async function findGoogleUser(sub)
{
	const result = await pool.query('SELECT id, username FROM users WHERE google_sub = $1', [sub]);
	return result.rows[0] || null;
}

/**
 * A new account for somebody signing in with Google for the first time,
 * under the first free name made from the one they gave: Amin, then Amin2.
 */
async function createGoogleUser(sub, email, baseName)
{
	for (let attempt = 0; attempt < 30; attempt++)
	{
		// The name, then numbered, then with a random number, which always finds room
		const suffix = attempt === 0 ? '' : attempt < 6 ? String(attempt + 1) : String(1000 + Math.floor(Math.random() * 9000));
		const name = baseName.slice(0, 16 - suffix.length) + suffix;
		const result = await pool.query(
			`INSERT INTO users (username, username_key, password, google_sub, email) VALUES ($1, $2, NULL, $3, $4)
			 ON CONFLICT DO NOTHING
			 RETURNING id, username`,
			[name, key(name), sub, email]);
		if (result.rowCount === 1)
		{
			const user = result.rows[0];
			await pool.query('INSERT INTO stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
			return user;
		}
		// Taken by the same person a moment ago, in another tab
		const existing = await findGoogleUser(sub);
		if (existing !== null) return existing;
	}
	return null;
}

/** Puts Google sign-in on an account that already exists. False if that Google account is on another. */
async function linkGoogle(userId, sub, email)
{
	const result = await pool.query(
		`UPDATE users SET google_sub = $2, email = COALESCE(email, $3)
		 WHERE id = $1 AND (google_sub IS NULL OR google_sub = $2)
		 AND NOT EXISTS (SELECT 1 FROM users other WHERE other.google_sub = $2 AND other.id <> $1)
		 RETURNING id`, [userId, sub, email]);
	return result.rowCount === 1;
}

/** Who signs in with this Google identity now, and whether they have a password to fall back on. */
async function googleHolder(sub)
{
	const result = await pool.query(
		'SELECT id, username, (password IS NOT NULL) AS "hasPassword" FROM users WHERE google_sub = $1', [sub]);
	return result.rows[0] || null;
}

/**
 * Google taken off a player it made, one with no password and so no other way
 * in, and put on an account the same person made with a password before. The
 * one it came off is kept, out of reach, rather than deleted. All or nothing.
 */
async function moveGoogle(fromId, toId, sub, email)
{
	const client = await pool.connect();
	try
	{
		await client.query('BEGIN');
		const off = await client.query(
			'UPDATE users SET google_sub = NULL WHERE id = $1 AND google_sub = $2 AND password IS NULL RETURNING id', [fromId, sub]);
		const on = off.rowCount === 1 ? await client.query(
			'UPDATE users SET google_sub = $2, email = COALESCE(email, $3) WHERE id = $1 AND google_sub IS NULL RETURNING id',
			[toId, sub, email]) : null;
		if (on === null || on.rowCount !== 1)
		{
			await client.query('ROLLBACK');
			return false;
		}
		await client.query('COMMIT');
		return true;
	}
	catch (error)
	{
		await client.query('ROLLBACK').catch(() => undefined);
		throw error;
	}
	finally
	{
		client.release();
	}
}

/** Only ever moves down: a slower lap than the one on record is not news. */
async function recordLap(userId, track, milliseconds)
{
	await pool.query(
		`INSERT INTO laps (user_id, track, best_ms) VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, track) DO UPDATE
		 SET best_ms = LEAST(laps.best_ms, EXCLUDED.best_ms), updated_at = now()`,
		[userId, track, milliseconds]);
}

async function lapBoard(track, limit)
{
	const result = await pool.query(
		`SELECT u.username, l.best_ms
		 FROM laps l JOIN users u ON u.id = l.user_id
		 WHERE l.track = $1
		 ORDER BY l.best_ms ASC, u.username ASC
		 LIMIT $2`, [track, Math.min(limit || 20, 100)]);

	return result.rows;
}

module.exports = {
	available, connect, createUser, findUser, getProfile,
	recordKill, recordDeath, recordPlayed, leaderboard,
	recordLap, lapBoard, getSave, putSave,
	findGoogleUser, createGoogleUser, linkGoogle, googleHolder, moveGoogle
};
