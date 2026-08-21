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
	return { id: player.id, name: player.name, color: player.color };
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
	broadcast(room, { t: 'join', ...publicInfo(player) }, player);

	console.log('player %d (%s) joined room %s, %d in room', player.id, player.name, room.code, room.players.size);
}

const server = http.createServer((req, res) =>
{
	// Hosting platforms want something to poll
	if (req.url === '/health')
	{
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
		return;
	}

	res.writeHead(404);
	res.end();
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
		isAlive: true,
		lastActivity: Date.now()
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

				const code = makeRoomCode();
				if (code === null)
				{
					send(player, { t: 'error', message: 'Couldn\'t allocate a room code, try again.' });
					return;
				}

				const room = { code, players: new Set(), scenario: msg.scenario || null };
				rooms.set(code, room);
				joinRoom(player, room);
				break;
			}

			case 'join':
			{
				player.name = sanitizeName(msg.name);
				player.color = sanitizeColor(msg.color);

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
			case 'vehicle':
			{
				if (player.room !== null)
				{
					msg.id = player.id;
					broadcast(player.room, msg, player);
				}
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
});

server.listen(PORT, () =>
{
	console.log('Sketchbook party relay listening on port %d', PORT);
});
