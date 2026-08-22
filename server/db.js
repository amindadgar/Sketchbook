/**
 * Postgres for accounts and their tallies.
 *
 * The schema is created on boot rather than by a migration tool: there are two
 * tables and a hobby game doesn't need a migration framework to look after
 * them. If this ever grows a third table with a shape that changes, that's the
 * moment to bring one in.
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

	pool = new Pool({
		connectionString: url,
		// Managed providers present certificates the client can't chain
		ssl: wantsSsl ? { rejectUnauthorized: false } : false,
		max: 5
	});

	await pool.query(SCHEMA);
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
		'SELECT id, username, password FROM users WHERE username_key = $1', [key(username)]);

	return result.rows[0] || null;
}

async function getProfile(userId)
{
	const result = await pool.query(
		`SELECT u.id, u.username, s.kills, s.deaths, s.played
		 FROM users u LEFT JOIN stats s ON s.user_id = u.id
		 WHERE u.id = $1`, [userId]);

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
	recordLap, lapBoard
};
