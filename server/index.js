/**
 * Sketchbook party relay.
 *
 * Deliberately dumb: it owns room membership and very little else. Every client
 * simulates its own character and the vehicle it drives, and the server just
 * forwards those updates to the rest of the room. That means a modified client
 * can lie about its position, which is fine for playing with friends and not
 * fine for anything competitive.
 *
 * The one thing it does decide is who sits where. Two clients can't agree on a
 * seat between themselves, because each one sees the other a round trip late,
 * so the first claim to arrive here wins and everyone hears about it.
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
// The city's traffic and crowds go out in one message, a few kilobytes of it
const MAX_MESSAGE_BYTES = 16384;
const MAX_NPCS = 64;
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

/**
 * A seat claim outlives a player who stops publishing by this much. A tab in
 * the background stops its game loop but keeps its socket, and without this it
 * would hold a car for everyone else until the five minute idle drop.
 */
const SEAT_STALE_MS = Number(process.env.SEAT_STALE_MS) || 5000;
/** A death only earns the named killer a point if they hit the victim this recently. */
const KILL_CREDIT_MS = 10 * 1000;
/** Positions this far out are garbage, not a very long drive. */
const MAX_COORDINATE = 1e5;
const MAX_SEAT_INDEX = 15;
const MAX_ID_LENGTH = 64;
/** Pellet end points in one shot. The shotgun has eight. */
const MAX_SHOT_POINTS = 8;
/** Vehicles remembered per room for late joiners. More than any scenario has. */
const MAX_CACHED_VEHICLES = 64;
/** Cars taken from the city's traffic, named 'stolen:...' by the client, cached apart from the rest. */
const STOLEN_PREFIX = 'stolen:';
const MAX_CACHED_STOLEN = 8;
// State and vehicle updates at 20 a second each, an automatic's shots and hits,
// and a car or two still being reported as it rolls to a stop come to under a
// hundred messages a second. Anything well past that is a runaway client, and
// dropping its excess keeps it from flooding the room.
const RATE_PER_SECOND = 150;
const RATE_BURST = 300;
/** What this relay understands beyond the original protocol, sent in 'joined'. */
const FEATURES = ['seats', 'vehicles', 'scenarioEcho', 'hurt', 'pickup', 'npcs', 'breakables', 'steal'];

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

/** The first 'count' entries as finite, sane numbers, or null. */
function readNumbers(value, count)
{
	if (!Array.isArray(value) || value.length < count) return null;

	for (let i = 0; i < count; i++)
	{
		if (typeof value[i] !== 'number' || !Number.isFinite(value[i])) return null;
		if (Math.abs(value[i]) > MAX_COORDINATE) return null;
	}

	return value.slice(0, count);
}

function readPoint(value)
{
	return readNumbers(value, 3);
}

function readString(value, maxLength)
{
	return (typeof value === 'string' && value.length > 0 && value.length <= maxLength) ? value : null;
}

function readInt(value, min, max)
{
	return (Number.isInteger(value) && value >= min && value <= max) ? value : null;
}

// Movement, vehicle and shot messages go to everyone else in the room, so they
// are rebuilt from the fields the game reads rather than forwarded as sent. A
// NaN in someone's position would otherwise poison every other client's copy
// of them for good, and arbitrary extra fields ride along for free.

function sanitizeState(msg)
{
	const p = readPoint(msg.p);
	const q = readNumbers(msg.q, 4);
	if (p === null || q === null) return null;

	const out = { t: 'state', p, q };

	const a = readString(msg.a, 48);
	if (a !== null) out.a = a;

	out.v = readString(msg.v, MAX_ID_LENGTH);
	const s = readInt(msg.s, -1, MAX_SEAT_INDEX);
	out.s = (out.v !== null && s !== null) ? s : -1;

	if (typeof msg.h === 'number' && Number.isFinite(msg.h)) out.h = Math.max(0, Math.min(100, msg.h));

	// Absent means an older client that doesn't say, which is different from unarmed
	if (msg.w !== undefined) out.w = WEAPONS.has(msg.w) ? msg.w : null;

	const l = readInt(msg.l, 0, 1e9);
	if (l !== null) out.l = l;

	return out;
}

function sanitizeVehicle(msg)
{
	const p = readPoint(msg.p);
	const q = readNumbers(msg.q, 4);
	if (p === null || q === null) return null;

	const out = { t: 'vehicle', p, q };

	const v = readString(msg.v, MAX_ID_LENGTH);
	if (v !== null) out.v = v;

	const lv = readPoint(msg.lv);
	if (lv !== null) out.lv = lv;

	const av = readPoint(msg.av);
	if (av !== null) out.av = av;

	if (msg.f) out.f = 1;

	return out;
}

function sanitizeShot(msg)
{
	const p = readPoint(msg.p);
	const d = readPoint(msg.d);
	if (p === null || d === null || !WEAPONS.has(msg.w)) return null;

	const out = { t: 'shot', p, d, w: msg.w };

	if (Array.isArray(msg.e))
	{
		const ends = msg.e.slice(0, MAX_SHOT_POINTS).map(readPoint).filter((point) => point !== null);
		if (ends.length > 0) out.e = ends;
	}

	return out;
}

/** Refills at a steady rate and spends one per message. False means drop it. */
function withinRate(player, now)
{
	player.tokens = Math.min(RATE_BURST, player.tokens + (now - player.tokensAt) / 1000 * RATE_PER_SECOND);
	player.tokensAt = now;

	if (player.tokens < 1) return false;

	player.tokens--;
	return true;
}

// ------------------------------------------------------------------- seats

function seatMessage(player)
{
	return player.seatKey === null
		? { t: 'seat', id: player.id, v: null, s: -1 }
		: { t: 'seat', id: player.id, v: player.seatVehicle, s: player.seatIndex };
}

/** Frees whatever the player holds. Reports whether they held anything. */
function releaseSeat(player, announce)
{
	if (player.seatKey === null) return false;

	const room = player.room;
	if (room !== null && room.seats.get(player.seatKey) === player) room.seats.delete(player.seatKey);

	player.seatKey = null;
	player.seatVehicle = null;
	player.seatIndex = -1;

	if (announce && room !== null) broadcast(room, seatMessage(player));
	return true;
}

/**
 * First come, first served. A player holds one seat at most, so claiming a new
 * one gives up the old one in the same step. Refusals go back to the claimant
 * alone, as the current holder's own claim: that tells them who beat them to it,
 * and needs no message type of its own.
 */
function claimSeat(player, vehicle, index)
{
	const room = player.room;

	if (vehicle === null)
	{
		if (!releaseSeat(player, true)) send(player, seatMessage(player));
		return;
	}

	const key = vehicle + '#' + index;
	const holder = room.seats.get(key);

	if (holder !== undefined && holder !== player)
	{
		send(player, seatMessage(holder));
		return;
	}

	if (player.seatKey === key)
	{
		send(player, seatMessage(player));
		return;
	}

	if (player.seatKey !== null) room.seats.delete(player.seatKey);

	room.seats.set(key, player);
	player.seatKey = key;
	player.seatVehicle = vehicle;
	player.seatIndex = index;

	broadcast(room, seatMessage(player));
}

/** Everyone who has stopped publishing gives their seat back. */
function releaseStaleSeats()
{
	const now = Date.now();

	for (const room of rooms.values())
	{
		for (const player of room.players)
		{
			if (player.seatKey !== null && now - player.lastState > SEAT_STALE_MS)
			{
				console.log('player %d (%s) went quiet, releasing their seat', player.id, player.name);
				releaseSeat(player, true);
			}
		}
	}
}

function apart(a, b)
{
	const dx = a[0] - b[0];
	const dy = a[1] - b[1];
	const dz = a[2] - b[2];
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * The city's pedestrians and traffic, from whichever client simulates them:
 * each an array of plain numbers, rebuilt so nothing else rides along.
 */
function sanitizeNpcs(msg)
{
	const rows = (value, width) =>
	{
		if (!Array.isArray(value)) return [];
		const out = [];
		for (const row of value.slice(0, MAX_NPCS))
		{
			const numbers = readNumbers(row, width);
			if (numbers !== null) out.push(numbers);
		}
		return out;
	};

	// Cars may carry an eighth number, how wrecked they are: 0, 1 upright, 2 on their roof
	const cars = [];
	if (Array.isArray(msg.c))
	{
		for (const row of msg.c.slice(0, MAX_NPCS))
		{
			const numbers = readNumbers(row, 7);
			if (numbers === null) continue;
			if (Number.isInteger(row[7]) && row[7] >= 0 && row[7] <= 2) numbers.push(row[7]);
			cars.push(numbers);
		}
	}

	const clock = typeof msg.k === 'number' && Number.isFinite(msg.k) ? msg.k : 0;
	return { t: 'npcs', k: clock, c: cars, p: rows(msg.p, 8) };
}

/** Whoever has the lowest id in a room is the one that simulates the city. */
function npcHost(room)
{
	let host = null;
	for (const player of room.players)
	{
		if (host === null || player.id < host.id) host = player;
	}
	return host;
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
	// Their own client says they're down, and it owns that number
	if (target.health !== undefined && target.health <= 0) return 'target is already down';

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
		// Taken when the round ended, so a kill during the intermission can't
		// rewrite a result everyone has already seen
		results: room.phase === 'over' ? room.results : undefined
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
				room.results = standings(room);
				room.endsAt = now + INTERMISSION_MS;
				console.log('room %s: round over', room.code);
			}
			else
			{
				for (const player of room.players) player.score = 0;

				room.phase = 'running';
				room.results = undefined;
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

	// 'leave' says the same to anyone listening, but an explicit release keeps
	// the seat table in one code path on the clients
	releaseSeat(player, room.players.size > 1);
	room.lastHit.delete(player.id);

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
	const seats = Array.from(room.players).filter((other) => other.seatKey !== null).map(seatMessage);
	room.players.add(player);
	player.room = room;
	player.lastState = Date.now();

	send(player, {
		t: 'joined',
		code: room.code,
		id: player.id,
		scenario: room.scenario,
		scenarioSeq: room.scenarioSeq,
		players: others,
		// Who sits where, and where the vehicles were last seen, so a late
		// arrival doesn't climb into an occupied seat or a car that has moved
		seats: seats,
		vehicles: Array.from(room.vehicles.values()),
		features: FEATURES
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
		lastChat: 0,
		/** When the last movement update arrived. A seat is let go after SEAT_STALE_MS without one. */
		lastState: Date.now(),
		/** 'vehicle#seat' held in room.seats, or null. */
		seatKey: null,
		seatVehicle: null,
		seatIndex: -1,
		/** 2 for clients that know their own scenario changes come back to them. */
		protocol: 1,
		tokens: RATE_BURST,
		tokensAt: Date.now()
	};
	connections.add(player);

	ws.on('pong', () =>
	{
		player.isAlive = true;
	});

	ws.on('message', (raw) =>
	{
		player.lastActivity = Date.now();

		if (!withinRate(player, player.lastActivity)) return;

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
				player.protocol = msg.protocol === 2 ? 2 : 1;
				adoptToken(player, msg.token);

				const code = makeRoomCode();
				if (code === null)
				{
					send(player, { t: 'error', message: 'Couldn\'t allocate a room code, try again.' });
					return;
				}

				const now = Date.now();
				const room = {
					code, players: new Set(), scenario: readString(msg.scenario, MAX_ID_LENGTH),
					phase: 'running', round: 1, endsAt: now + MATCH_LENGTH_MS, lastSync: now,
					results: undefined,
					scenarioSeq: 0,
					/** 'vehicle#seat' to the player holding it */
					seats: new Map(),
					/** Vehicle id to its last reported pose, for late joiners */
					vehicles: new Map(),
					/** Victim id to the last hit on them this relay let through, for crediting kills */
					lastHit: new Map()
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
				player.protocol = msg.protocol === 2 ? 2 : 1;
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
				const id = readString(msg.id, MAX_ID_LENGTH);
				if (player.room === null || id === null) break;

				const room = player.room;
				room.scenario = id;
				room.scenarioSeq++;

				// Every vehicle is respawned, so nobody is sitting anywhere and no
				// remembered pose belongs to anything that exists any more
				room.seats.clear();
				room.vehicles.clear();
				for (const other of room.players)
				{
					other.seatKey = null;
					other.seatVehicle = null;
					other.seatIndex = -1;
				}

				// Back to the sender as well, when it understands that. Two players
				// changing scenario at the same moment otherwise each end up in the
				// other's; this way everyone applies the changes in the order they
				// arrived here, and the last one wins everywhere.
				const change = { t: 'scenario', id: id, seq: room.scenarioSeq, by: player.id };
				for (const other of room.players)
				{
					if (other !== player || other.protocol >= 2) send(other, change);
				}
				break;
			}

			case 'state':
			{
				if (player.room === null) break;

				const state = sanitizeState(msg);
				if (state === null) break;

				player.position = state.p;
				player.lastState = Date.now();
				if (state.h !== undefined) player.health = state.h;

				state.id = player.id;
				broadcast(player.room, state, player);
				break;
			}

			case 'vehicle':
			{
				if (player.room === null) break;

				const vehicle = sanitizeVehicle(msg);
				if (vehicle === null) break;

				const room = player.room;
				if (vehicle.v !== undefined && vehicle.v.startsWith(STOLEN_PREFIX))
				{
					// Cars taken from the traffic come and go all game, so they get
					// a few places of their own, the least recently moved given up
					room.vehicles.delete(vehicle.v);
					const stolen = [...room.vehicles.keys()].filter((key) => key.startsWith(STOLEN_PREFIX));
					if (stolen.length >= MAX_CACHED_STOLEN) room.vehicles.delete(stolen[0]);
					room.vehicles.set(vehicle.v, {
						v: vehicle.v, p: vehicle.p, q: vehicle.q, lv: vehicle.lv, av: vehicle.av
					});
				}
				else if (vehicle.v !== undefined && (room.vehicles.has(vehicle.v) || room.vehicles.size < MAX_CACHED_VEHICLES + MAX_CACHED_STOLEN))
				{
					room.vehicles.set(vehicle.v, {
						v: vehicle.v, p: vehicle.p, q: vehicle.q, lv: vehicle.lv, av: vehicle.av
					});
				}

				vehicle.id = player.id;
				broadcast(room, vehicle, player);
				break;
			}

			case 'shot':
			{
				if (player.room === null) break;

				const shot = sanitizeShot(msg);
				if (shot === null) break;

				shot.id = player.id;
				broadcast(player.room, shot, player);
				break;
			}

			case 'hit':
			{
				if (player.room === null) break;

				const now = Date.now();
				const problem = hitIsPlausible(player, msg, now);
				if (problem !== null)
				{
					console.log('rejected a hit from player %d (%s): %s', player.id, player.name, problem);
					break;
				}

				const target = findInRoom(player.room, msg.target);
				player.room.lastHit.set(target.id, { by: player.id, at: now });

				// Only the player named has anything to do with it
				const hit = {
					t: 'hit', id: player.id, target: target.id, damage: msg.damage, w: msg.w,
					p: readPoint(msg.p) || undefined
				};
				const life = readInt(msg.l, 0, 1e9);
				if (life !== null) hit.l = life;

				send(target, hit);
				break;
			}

			case 'claim':
			{
				if (player.room === null) break;

				const vehicle = msg.v === null ? null : readString(msg.v, MAX_ID_LENGTH);
				const index = readInt(msg.s, 0, MAX_SEAT_INDEX);
				if (msg.v !== null && (vehicle === null || index === null)) break;

				claimSeat(player, vehicle, index);
				break;
			}

			case 'hurt':
			{
				// The victim telling the shooter a hit counted, which is what
				// lights their hit marker. Only the shooter needs to know.
				if (player.room === null) break;

				const shooter = findInRoom(player.room, msg.to);
				if (shooter === null || shooter === player) break;
				if (typeof msg.damage !== 'number' || !Number.isFinite(msg.damage)) break;

				send(shooter, {
					t: 'hurt', id: player.id,
					damage: Math.max(0, Math.min(500, msg.damage)),
					dead: msg.dead === true
				});
				break;
			}

			case 'pickup':
			{
				if (player.room === null) break;

				const index = readInt(msg.i, 0, 255);
				if (index === null) break;

				broadcast(player.room, { t: 'pickup', id: player.id, i: index }, player);
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

			case 'npcs':
			{
				// Only from the client whose job it is, to everyone else
				if (player.room === null || npcHost(player.room) !== player) break;
				broadcast(player.room, sanitizeNpcs(msg), player);
				break;
			}

			case 'npcHit':
			{
				// A shot at a pedestrian, passed to the client simulating them
				if (player.room === null) break;
				const host = npcHost(player.room);
				const id = readInt(msg.n, 0, 1e9);
				const damage = typeof msg.d === 'number' && Number.isFinite(msg.d) ? Math.max(0, Math.min(200, msg.d)) : null;
				if (host === null || host === player || id === null || damage === null) break;
				send(host, { t: 'npcHit', n: id, d: damage, p: readPoint(msg.p) || undefined, id: player.id });
				break;
			}

			case 'npcSteal':
			{
				// Somebody pulled a driver out of the traffic; the simulating
				// client takes that car off the road
				if (player.room === null) break;
				const host = npcHost(player.room);
				const id = readInt(msg.n, 0, 1e9);
				if (host === null || host === player || id === null) break;
				send(host, { t: 'npcSteal', n: id, p: readPoint(msg.p) || undefined, id: player.id });
				break;
			}

			case 'break':
			{
				// A lamp or sign knocked over, which the city on every screen has
				// under the same number
				if (player.room === null) break;
				const id = readInt(msg.b, 0, 1e6);
				if (id === null) break;
				broadcast(player.room, { t: 'break', b: id, v: readPoint(msg.v) || undefined, id: player.id }, player);
				break;
			}

			case 'death':
			{
				// The player who died reports it, because their client is the one
				// that owns their health. The point goes to whoever they name,
				// provided this relay actually let a hit from them through.
				if (player.room === null) break;

				const room = player.room;

				// The dead let go of the wheel, whatever else happens here
				releaseSeat(player, true);

				// One death per respawn, so nobody can hand out points in bulk
				const now = Date.now();
				if (now - player.lastDeath < DEATH_COOLDOWN_MS)
				{
					console.log('ignored a repeat death from player %d (%s)', player.id, player.name);
					break;
				}
				player.lastDeath = now;

				const lastHit = room.lastHit.get(player.id);
				room.lastHit.delete(player.id);

				let killer = null;
				if (lastHit !== undefined && lastHit.by === msg.killer && now - lastHit.at <= KILL_CREDIT_MS)
				{
					killer = findInRoom(room, msg.killer);
					if (killer === player) killer = null;
				}

				// Nothing counts between rounds: the results are already up
				if (room.phase === 'running')
				{
					tally(db.recordDeath, player.userId);

					if (killer !== null)
					{
						killer.score++;
						tally(db.recordKill, killer.userId);
						broadcast(room, { t: 'score', id: killer.id, score: killer.score });
					}
				}

				broadcast(room, {
					t: 'death', id: player.id,
					killer: killer !== null ? killer.id : undefined,
					w: killer !== null && WEAPONS.has(msg.w) ? msg.w : undefined
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
const seatSweep = setInterval(releaseStaleSeats, 1000);

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
	clearInterval(seatSweep);
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
