/**
 * Accounts: register, sign in, and the tallies behind a future leaderboard.
 *
 * Passwords are hashed with scrypt and tokens are signed with an HMAC, both
 * from Node's own crypto. That's deliberate: a dependency for either would be
 * one more thing to keep patched in a service whose whole job is forwarding
 * small JSON messages.
 */

const crypto = require('crypto');
const db = require('./db');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 4096;

// Without a configured secret every restart invalidates outstanding tokens.
// Fine for a hobby deployment, but it should be said out loud.
const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.AUTH_SECRET)
{
	console.log('auth: no AUTH_SECRET set, sign-ins will not survive a restart');
}

function hashPassword(password)
{
	const salt = crypto.randomBytes(16);
	const derived = crypto.scryptSync(password, salt, 64);
	return 'scrypt$' + salt.toString('hex') + '$' + derived.toString('hex');
}

function verifyPassword(password, stored)
{
	const parts = String(stored).split('$');
	if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

	const salt = Buffer.from(parts[1], 'hex');
	const expected = Buffer.from(parts[2], 'hex');
	const derived = crypto.scryptSync(password, salt, expected.length);

	// Constant time, so a wrong password can't be narrowed down by timing
	return crypto.timingSafeEqual(derived, expected);
}

function base64url(buffer)
{
	return Buffer.from(buffer).toString('base64')
		.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload)
{
	const body = base64url(JSON.stringify(payload));
	const mac = base64url(crypto.createHmac('sha256', SECRET).update(body).digest());
	return body + '.' + mac;
}

function verify(token)
{
	if (typeof token !== 'string') return null;

	const parts = token.split('.');
	if (parts.length !== 2) return null;

	const expected = base64url(crypto.createHmac('sha256', SECRET).update(parts[0]).digest());
	const a = Buffer.from(parts[1]);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

	try
	{
		const payload = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
		if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
		return payload;
	}
	catch (error)
	{
		return null;
	}
}

function tokenFor(user)
{
	return sign({ uid: user.id, name: user.username, exp: Date.now() + TOKEN_TTL_MS });
}

/** Who a request claims to be, or null. */
function identify(request)
{
	const header = request.headers['authorization'] || '';
	const match = /^Bearer (.+)$/.exec(header);
	return match ? verify(match[1]) : null;
}

function validate(username, password)
{
	if (typeof username !== 'string' || !/^[A-Za-z0-9_-]{3,16}$/.test(username.trim()))
	{
		return 'Names are 3 to 16 characters, letters, numbers, dash and underscore.';
	}

	if (typeof password !== 'string' || password.length < 8)
	{
		return 'Passwords need at least 8 characters.';
	}

	return null;
}

function send(response, status, body)
{
	const text = JSON.stringify(body);
	response.writeHead(status, {
		'Content-Type': 'application/json',
		// The game is served from a different origin to this service. Tokens
		// travel in a header rather than a cookie, so there's no credentialed
		// request to protect and any origin may ask.
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Content-Length': Buffer.byteLength(text)
	});
	response.end(text);
}

function readBody(request)
{
	return new Promise((resolve, reject) =>
	{
		let size = 0;
		let chunks = '';

		request.on('data', (chunk) =>
		{
			size += chunk.length;
			if (size > MAX_BODY_BYTES) { request.destroy(); reject(new Error('too large')); return; }
			chunks += chunk;
		});
		request.on('end', () =>
		{
			try { resolve(JSON.parse(chunks || '{}')); }
			catch (error) { reject(new Error('bad json')); }
		});
		request.on('error', reject);
	});
}

/** Returns true when the request was an accounts one and has been answered. */
async function handle(request, response, url)
{
	if (request.method === 'OPTIONS')
	{
		send(response, 204, {});
		return true;
	}

	if (!url.startsWith('/auth/') && url !== '/leaderboard') return false;

	if (!db.available())
	{
		send(response, 503, { error: 'Accounts are not configured on this server.' });
		return true;
	}

	try
	{
		if (url === '/auth/register' && request.method === 'POST')
		{
			const body = await readBody(request);
			const problem = validate(body.username, body.password);
			if (problem) { send(response, 400, { error: problem }); return true; }

			const user = await db.createUser(body.username, hashPassword(body.password));
			if (user === null) { send(response, 409, { error: 'That name is taken.' }); return true; }

			send(response, 201, { token: tokenFor(user), user: { id: user.id, username: user.username } });
			return true;
		}

		if (url === '/auth/login' && request.method === 'POST')
		{
			const body = await readBody(request);
			const user = typeof body.username === 'string' ? await db.findUser(body.username) : null;

			// One message for both cases, so it can't be used to discover names
			if (user === null || !verifyPassword(String(body.password || ''), user.password))
			{
				send(response, 401, { error: 'Wrong name or password.' });
				return true;
			}

			send(response, 200, { token: tokenFor(user), user: { id: user.id, username: user.username } });
			return true;
		}

		if (url === '/auth/me' && request.method === 'GET')
		{
			const claims = identify(request);
			if (claims === null) { send(response, 401, { error: 'Not signed in.' }); return true; }

			const profile = await db.getProfile(claims.uid);
			if (profile === null) { send(response, 401, { error: 'Not signed in.' }); return true; }

			send(response, 200, { user: profile });
			return true;
		}

		if (url === '/leaderboard' && request.method === 'GET')
		{
			send(response, 200, { players: await db.leaderboard(20) });
			return true;
		}
	}
	catch (error)
	{
		console.error('auth:', error.message);
		send(response, 400, { error: 'That request could not be processed.' });
		return true;
	}

	send(response, 404, { error: 'No such endpoint.' });
	return true;
}

module.exports = { handle, verify, identify, send };
