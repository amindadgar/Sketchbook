/**
 * Signing in with Google: checking that what the browser hands over really
 * came from Google, for this game, for somebody whose email Google has
 * confirmed.
 *
 * The browser gets an ID token, a JWT signed by Google, from Google's own
 * sign-in button. It's checked here against Google's published keys with
 * Node's crypto, the same way the rest of the accounts code avoids a
 * dependency: the signature, that it was issued for this game's client id,
 * by Google, and that it hasn't run out.
 *
 * GOOGLE_CLIENT_ID switches it on; it's the OAuth client's id from the Google
 * Cloud console, the same one the page's button is made with. It isn't a
 * secret. GOOGLE_JWKS_URL is only for testing against keys of one's own.
 */

const crypto = require('crypto');

const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const JWKS_URL = process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
/** A token a little old by our clock, or a little new, is the clocks disagreeing. */
const LEEWAY_S = 60;

let keys = null;
let keysUntil = 0;
let lastForced = 0;
/** One fetch at a time, however many sign-ins arrive while it's out. */
let fetching = null;
const FETCH_TIMEOUT_MS = 5000;
/** Kept no longer than this whatever Google says, and retried this soon after a failure. */
const MAX_KEEP_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;

/** The client id the page's button needs, or empty when Google sign-in is off. */
function clientId()
{
	return CLIENT_ID;
}

/**
 * Google's current signing keys, by id. Kept as long as Google says they may
 * be, and fetched again early when a token names one we haven't got, since
 * the keys turn over, but not more than once a minute for that.
 */
async function signingKeys(force)
{
	const now = Date.now();
	if (keys !== null && now < keysUntil && !force) return keys;
	if (force && keys !== null && now - lastForced < RETRY_MS) return keys;
	if (fetching !== null) return fetching;
	if (force) lastForced = now;

	fetching = (async () =>
	{
		try
		{
			const response = await fetch(JWKS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
			if (!response.ok) throw new Error('Google keys answered ' + response.status);
			const body = await response.json();
			const age = /max-age=(\d+)/.exec(response.headers.get('cache-control') || '');

			const fresh = new Map();
			for (const jwk of Array.isArray(body.keys) ? body.keys : [])
			{
				if (typeof jwk.kid !== 'string' || jwk.kty !== 'RSA') continue;
				try
				{
					fresh.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
				}
				catch (error)
				{
					// One bad key doesn't spoil the rest
				}
			}
			keys = fresh;
			keysUntil = Date.now() + Math.min(MAX_KEEP_MS, age ? Number(age[1]) * 1000 : 60 * 60 * 1000);
		}
		catch (error)
		{
			// Google's slow or down: keep what we had, and don't ask again for a minute
			console.error('google: keys: %s', error.message);
			keysUntil = Date.now() + RETRY_MS;
			if (keys === null) keys = new Map();
		}
		finally
		{
			fetching = null;
		}
		return keys;
	})();
	return fetching;
}

function decode(part)
{
	return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * The person an ID token vouches for, as { sub, email, name }, or null if it
 * doesn't hold up. sub is Google's own, unchanging id for them, which is what
 * an account is tied to; the email can change.
 */
async function verifyIdToken(token)
{
	if (CLIENT_ID === '' || typeof token !== 'string' || token.length > 4096) return null;

	const parts = token.split('.');
	if (parts.length !== 3) return null;

	let header;
	let payload;
	try
	{
		header = JSON.parse(decode(parts[0]).toString());
		payload = JSON.parse(decode(parts[1]).toString());
	}
	catch (error)
	{
		return null;
	}
	if (header === null || payload === null || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

	let set = await signingKeys(false);
	let key = set.get(header.kid);
	if (key === undefined)
	{
		set = await signingKeys(true);
		key = set.get(header.kid);
	}
	if (key === undefined) return null;

	const signed = Buffer.from(parts[0] + '.' + parts[1]);
	if (!crypto.verify('RSA-SHA256', signed, key, decode(parts[2]))) return null;

	const now = Date.now() / 1000;
	if (payload.aud !== CLIENT_ID) return null;
	if (ISSUERS.indexOf(payload.iss) < 0) return null;
	if (typeof payload.exp !== 'number' || payload.exp < now - LEEWAY_S) return null;
	if (typeof payload.iat === 'number' && payload.iat > now + LEEWAY_S) return null;
	if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) return null;
	if (payload.email_verified !== true && payload.email_verified !== 'true') return null;

	let email = typeof payload.email === 'string' ? payload.email.slice(0, 254) : null;
	// Every name Google has for them, best first: the email's own name last,
	// as the one most likely to survive being made into letters and numbers
	let names = [payload.given_name, payload.name, email !== null ? email.split('@')[0] : '']
		.filter((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);

	return { sub: payload.sub, email: email, names: names };
}

function clean(name)
{
	return String(name || '').normalize('NFKD').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
}

/**
 * A name to play under, from the first of theirs that still makes one once
 * it's letters, numbers, dash and underscore: a name in another alphabet
 * falls back to the one in their email, and only failing that to Player.
 */
function playerName(names)
{
	for (const name of Array.isArray(names) ? names : [names])
	{
		let cleaned = clean(name);
		if (cleaned.length >= 3) return cleaned;
	}
	return 'Player';
}

module.exports = { clientId, verifyIdToken, playerName };
