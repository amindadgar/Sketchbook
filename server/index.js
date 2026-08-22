/**
 * Sketchbook party relay.
 *
 * Deliberately dumb: it owns room membership and nothing else. Every client
 * simulates its own character and the vehicle it drives, and the server just
 * forwards those updates to the rest of the room. That means a modified client
 * can lie about its position, which is fine for playing with friends and not
 * fine for anything competitive.
 *
 *   node server/index.js            # localhost:9000
 *   PORT=8081 node server/index.js
 */

const http = require('http');
const db = require('./db');
const auth = require('./auth');
// The same table the game builds its weapons from, so the two can't drift
const WEAPONS = new Map(require('../shared/weapons.json').weapons.map((w) => [w.id, w]));
// ws 7 exposes the server as WebSocket.Server, ws 8 also has a named export.
// Going through the class works on both.
const WebSocket = require('ws');

const PORT = process.env.PORT || 9000;
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_MESSAGE_BYTES = 4096;
// Closing a browser closes the socket, and that path is immediate. These two
// cover the cases where it doesn't: a sleeping laptop or dropped wifi can leave
// a half open socket the OS never reports, and a frozen or backgrounded tab
// keeps its socket alive while sending nothing at all. Without them either one
// leaves a player standing in everyone else's world forever.
const HEARTBEAT_INTERVAL = Number(process.env.HEARTBEAT_MS) || 30 * 1000;
const IDLE_TIMEOUT = Number(process.env.IDLE_TIMEOUT_MS) || 5 * 60 * 1000;
// No I/O/0/1, they get misread when someone reads a code out loud
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

// A shot is still reported by the client that fired it, because only that
// client knows what it was aiming at. What can be checked from here is checked:
// that the weapon exists, that it can't do more damage than it has, that the
// target was within its range, and that nobody is firing faster than any real
// weapon can. Line of sight can't be: this server has never seen the map. The
// client being shot at does that part, since it holds both the map and the
// truth about where it is.
const RANGE_SLACK = 1.35;
// The automatic is the fastest honest damage in the game at about 153 a second
const MAX_DAMAGE_PER_SECOND = 220;
const DAMAGE_WINDOW_MS = 1000;
// Long enough to cover the respawn, so one death can't be reported twice
const DEATH_COOLDOWN_MS = 2500;

// A party runs in rounds rather than forever, so the scoreboard means
// something and there's a reason to come back for the next one.
const MATCH_LENGTH_MS = Number(process.env.MATCH_MS) || 5 * 60 * 1000;
const INTERMISSION_MS = Number(process.env.INTERMISSION_MS) || 12 * 1000;
const MATCH_TICK_MS = 1000;
/** How often the deadline is repeated to the room, so nobody drifts. */
const MATCH_SYNC_MS = 5000;

const MAX_CHAT_LENGTH = 160;
/** One line every second and a bit, so nobody can paper over the screen. */
const CHAT_COOLDOWN_MS = 1200;

/** @type {Map<string, {code: string, players: Set<object>, scenario: string}>} */
const rooms = new Map();
/** Every live connection, room or no room, so the sweep can see all of them. */
const connections = new Set();
let nextPlayerId = 1;

function makeRoomCode()
{
	for (let attempt = 0; attempt < 200; attempt++)
	{
		let code = '';
		for (let i = 0; i < CODE_LENGTH; i++)
		{
			code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
		}
		if (!rooms.has(code)) return code;
	}
	return null;
}

function send(player, message)
{
	if (player.ws.readyState === player.ws.OPEN)
	{
		player.ws.send(JSON.stringify(message));
	}
}

function broadcast(room, message, exclude)
{
	for (const player of room.players)
	{
		if (player !== exclude) send(player, message);
	}
}

function publicInfo(player)
{
	return {
		id: player.id, name: player.name, color: player.color, hat: player.hat,
		score: player.score, account: player.account
	};
}

/** Attaches the signed-in account, if the client presented a valid token. */
function adoptToken(player, token)
{
	const claims = auth.verify(token);
	if (claims === null) return;

	player.userId = claims.uid;
	player.account = claims.name;
}

/** Tallies are best effort: a database hiccup shouldn't interrupt a game. */
function tally(action, userId)
{
	if (userId === undefined || !db.available()) return;

	action(userId).catch((error) => console.error('stats:', error.message));
}

function readPoint(value)
{
	if (!Array.isArray(value) || value.length < 3) return null;

	for (let i = 0; i < 3; i++)
	{
		if (typeof value[i] !== 'number' || !Number.isFinite(value[i])) return null;
	}

	return value;
}

function apart(a, b)
{
	const dx = a[0] - b[0];
	const dy = a[1] - b[1];
	const dz = a[2] - b[2];
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function findInRoom(room, id)
{
	for (const player of room.players)
	{
		if (player.id === id) return player;
	}

	return null;
}

/** Everything about a claimed hit that can be judged without the map. */
function hitIsPlausible(player, msg, now)
{
	const weapon = WEAPONS.get(msg.w);
	if (weapon === undefined) return 'unknown weapon';

	if (typeof msg.damage !== 'number' || !(msg.damage > 0)) return 'damage is not a number';
	if (msg.damage > weapon.damage + 0.001) return 'more damage than a ' + weapon.id + ' does';

	const target = findInRoom(player.room, msg.target);
	if (target === null || target === player) return 'no such target';

	// Positions come from the movement updates both clients are already sending
	const from = readPoint(msg.p) || player.position;
	if (from !== null && target.position !== null)
	{
		const reach = weapon.range * RANGE_SLACK;
		if (apart(from, target.position) > reach) return 'further than a ' + weapon.id + ' reaches';
	}

	// Sliding window rather than a shot counter, so swapping the named weapon
	// every message doesn't buy a higher rate
	player.damageWindow = player.damageWindow.filter((entry) => now - entry.at < DAMAGE_WINDOW_MS);
	const recent = player.damageWindow.reduce((total, entry) => total + entry.damage, 0);
	if (recent + msg.damage > MAX_DAMAGE_PER_SECOND) return 'more damage a second than any weapon does';

	player.damageWindow.push({ at: now, damage: msg.damage });
	return null;
}

function standings(room)
{
	return Array.from(room.players)
		.map((player) => ({ name: player.name, color: player.color, score: player.score }))
		.sort((a, b) => b.score - a.score);
}

function matchMessage(room, now)
{
	return {
		t: 'match',
		phase: room.phase,
		// Which round this is, so a client can tell the five second sync of a
		// round already in progress from the start of the next one
		round: room.round,
		remaining: Math.max(0, Math.round((room.endsAt - now) / 1000)),
		results: room.phase === 'over' ? standings(room) : undefined
	};
}

/** Runs the clock for every room: ends rounds, and starts the next one. */
function tickMatches()
{
	const now = Date.now();

	for (const room of rooms.values())
	{
		if (now >= room.endsAt)
		{
			if (room.phase === 'running')
			{
				room.phase = 'over';
				room.endsAt = now + INTERMISSION_MS;
				console.log('room %s: round over', room.code);
			}
			else
			{
				for (const player of room.players) player.score = 0;

				room.phase = 'running';
				room.round++;
				room.endsAt = now + MATCH_LENGTH_MS;
				console.log('room %s: round %d', room.code, room.round);
			}

			room.lastSync = now;
			broadcast(room, matchMessage(room, now));
			continue;
		}

		if (now - room.lastSync >= MATCH_SYNC_MS)
		{
			room.lastSync = now;
			broadcast(room, matchMessage(room, now));
		}
	}
}

function sanitizeName(name)
{
	if (typeof name !== 'string') return 'Player';
	const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, 16);
	return trimmed.length > 0 ? trimmed : 'Player';
}

function sanitizeColor(color)
{
	return (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : '#cccccc';
}

/** Just a shape check. The game falls back to a bare head for anything it
 * doesn't recognise, so the list itself doesn't need to live here too. */
function sanitizeHat(hat)
{
	return (typeof hat === 'string' && /^[a-z]{2,12}$/.test(hat)) ? hat : 'none';
}

function leaveRoom(player)
{
	const room = player.room;
	if (room === null) return;

	room.players.delete(player);
	player.room = null;

	if (room.players.size === 0)
	{
		rooms.delete(room.code);
		console.log('room %s closed', room.code);
	}
	else
	{
		broadcast(room, { t: 'leave', id: player.id });
	}
}

function joinRoom(player, room)
{
	leaveRoom(player);

	const others = Array.from(room.players).map(publicInfo);
	room.players.add(player);
	player.room = room;

	send(player, {
		t: 'joined',
		code: room.code,
		id: player.id,
		scenario: room.scenario,
		players: others
	});

	tally(db.recordPlayed, player.userId);
	broadcast(room, { t: 'join', ...publicInfo(player) }, player);

	// So a late arrival sees the right clock rather than waiting for the next sync
	send(player, matchMessage(room, Date.now()));

	console.log('player %d (%s) joined room %s, %d in room', player.id, player.name, room.code, room.players.size);
}

const server = http.createServer((req, res) =>
{
	const url = (req.url || '/').split('?')[0];

	// Hosting platforms want something to poll
	if (url === '/health')
	{
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ok: true, rooms: rooms.size, accounts: db.available() }));
		return;
	}

	// Answers /auth/* and /leaderboard, and reports whether it did
	auth.handle(req, res, url).then((handled) =>
	{
		if (handled) return;

		res.writeHead(404);
		res.end();
	});
});

const wss = new WebSocket.Server({ server, maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (ws) =>
{
	const player = {
		id: nextPlayerId++,
		ws,
		room: null,
		name: 'Player',
		color: '#cccccc',
		hat: 'none',
		score: 0,
		isAlive: true,
		lastActivity: Date.now(),
		/** Last position from a movement update, for checking claimed hits. */
		position: null,
		damageWindow: [],
		lastDeath: 0,
		lastChat: 0
	};
	connections.add(player);

	ws.on('pong', () =>
	{
		player.isAlive = true;
	});

	ws.on('message', (raw) =>
	{
		player.lastActivity = Date.now();

		let msg;
		try
		{
			msg = JSON.parse(raw.toString());
		}
		catch (error)
		{
			return;
		}
		if (msg === null || typeof msg !== 'object') return;

		switch (msg.t)
		{
			case 'create':
			{
				player.name = sanitizeName(msg.name);
				player.color = sanitizeColor(msg.color);
				player.hat = sanitizeHat(msg.hat);
				adoptToken(player, msg.token);

				const code = makeRoomCode();
				if (code === null)
				{
					send(player, { t: 'error', message: 'Couldn\'t allocate a room code, try again.' });
					return;
				}

				const now = Date.now();
				const room = {
					code, players: new Set(), scenario: msg.scenario || null,
					phase: 'running', round: 1, endsAt: now + MATCH_LENGTH_MS, lastSync: now
				};
				rooms.set(code, room);
				joinRoom(player, room);
				break;
			}

			case 'join':
			{
				player.name = sanitizeName(msg.name);
				player.color = sanitizeColor(msg.color);
				player.hat = sanitizeHat(msg.hat);
				adoptToken(player, msg.token);

				const code = typeof msg.code === 'string' ? msg.code.toUpperCase().trim() : '';
				const room = rooms.get(code);

				if (room === undefined)
				{
					send(player, { t: 'error', message: 'No party with code ' + code + '.' });
					return;
				}
				if (room.players.size >= MAX_PLAYERS_PER_ROOM)
				{
					send(player, { t: 'error', message: 'That party is full.' });
					return;
				}

				joinRoom(player, room);
				break;
			}

			case 'identity':
			{
				player.name = sanitizeName(msg.name);
				player.color = sanitizeColor(msg.color);
				player.hat = sanitizeHat(msg.hat);
				if (player.room !== null)
				{
					broadcast(player.room, { t: 'identity', ...publicInfo(player) }, player);
				}
				break;
			}

			case 'scenario':
			{
				// Everyone needs the same scenario or vehicle ids don't line up
				if (player.room !== null && typeof msg.id === 'string')
				{
					player.room.scenario = msg.id;
					broadcast(player.room, { t: 'scenario', id: msg.id }, player);
				}
				break;
			}

			case 'state':
			{
				if (player.room === null) break;

				const at = readPoint(msg.p);
				if (at !== null) player.position = at;

				msg.id = player.id;
				broadcast(player.room, msg, player);
				break;
			}

			case 'vehicle':
			case 'shot':
			{
				if (player.room !== null)
				{
					msg.id = player.id;
					broadcast(player.room, msg, player);
				}
				break;
			}

			case 'hit':
			{
				if (player.room === null) break;

				const problem = hitIsPlausible(player, msg, Date.now());
				if (problem !== null)
				{
					console.log('rejected a hit from player %d (%s): %s', player.id, player.name, problem);
					break;
				}

				msg.id = player.id;
				broadcast(player.room, msg, player);
				break;
			}

			case 'chat':
			{
				if (player.room === null) break;

				const now = Date.now();
				if (now - player.lastChat < CHAT_COOLDOWN_MS) break;

				// Collapsed to a single line and trimmed: it's drawn as text on
				// the other end, but a wall of newlines is still a nuisance
				const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
				if (text.length === 0) break;

				player.lastChat = now;
				broadcast(player.room, {
					t: 'chat', id: player.id, name: player.name, color: player.color, text: text
				});
				break;
			}

			case 'death':
			{
				// The player who died reports it, because their client is the one
				// that owns their health. The point goes to whoever they name.
				if (player.room === null) break;

				// One death per respawn, so nobody can hand out points in bulk
				const now = Date.now();
				if (now - player.lastDeath < DEATH_COOLDOWN_MS)
				{
					console.log('ignored a repeat death from player %d (%s)', player.id, player.name);
					break;
				}
				player.lastDeath = now;

				tally(db.recordDeath, player.userId);

				for (const other of player.room.players)
				{
					if (other.id === msg.killer && other !== player)
					{
						other.score++;
						tally(db.recordKill, other.userId);
						broadcast(player.room, { t: 'score', id: other.id, score: other.score });
						break;
					}
				}

				broadcast(player.room, {
					t: 'death', id: player.id, killer: msg.killer,
					w: WEAPONS.has(msg.w) ? msg.w : undefined
				}, player);
				break;
			}
		}
	});

	ws.on('close', () =>
	{
		connections.delete(player);
		leaveRoom(player);
	});

	ws.on('error', () =>
	{
		connections.delete(player);
		leaveRoom(player);
	});
});

function drop(player, reason)
{
	console.log('dropping player %d (%s): %s', player.id, player.name, reason);

	if (reason === 'idle')
	{
		// The socket still works, so they get told why before it goes
		send(player, { t: 'error', message: 'Dropped from the party after 5 minutes without activity.' });
		player.ws.close();
	}
	else
	{
		// Nothing is listening on the other end, so don't wait for a handshake
		player.ws.terminate();
	}
}

const matchClock = setInterval(tickMatches, MATCH_TICK_MS);

const sweep = setInterval(() =>
{
	const now = Date.now();

	for (const player of connections)
	{
		// Never answered the last ping, so the far end is gone
		if (player.isAlive === false)
		{
			drop(player, 'unresponsive');
			continue;
		}

		if (now - player.lastActivity > IDLE_TIMEOUT)
		{
			drop(player, 'idle');
			continue;
		}

		player.isAlive = false;
		player.ws.ping();
	}
}, HEARTBEAT_INTERVAL);

wss.on('close', () =>
{
	clearInterval(sweep);
	clearInterval(matchClock);
});

db.connect()
	.catch((error) =>
	{
		// A database that won't come up shouldn't stop people playing together
		console.error('db: %s, carrying on without accounts', error.message);
	})
	.then(() =>
	{
		server.listen(PORT, () =>
		{
			console.log('Sketchbook party relay listening on port %d', PORT);
		});
	});
