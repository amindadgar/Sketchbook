export interface AccountProfile
{
	id: number;
	username: string;
	kills: number;
	deaths: number;
	played: number;
}

/**
 * Talks to the accounts endpoints on the party server.
 *
 * The token is kept in local storage and sent when joining a party, which is
 * how kills end up attached to a name rather than to whoever happened to be
 * holding a colour that evening.
 */
export class Account
{
	private static readonly STORAGE_KEY: string = 'sketchbook.token';

	public static token: string;
	public static profile: AccountProfile;

	public static get signedIn(): boolean
	{
		return Account.profile !== undefined;
	}

	/** The accounts API sits on the party server, over http rather than ws. */
	public static httpBase(serverUrl: string): string
	{
		let url = (serverUrl || '').trim();

		if (url.indexOf('wss://') === 0) return 'https://' + url.slice(6);
		if (url.indexOf('ws://') === 0) return 'http://' + url.slice(5);

		return url;
	}

	public static loadToken(): string
	{
		try
		{
			return window.localStorage.getItem(Account.STORAGE_KEY) || undefined;
		}
		catch (error)
		{
			return undefined;
		}
	}

	public static signOut(): void
	{
		Account.token = undefined;
		Account.profile = undefined;

		try
		{
			window.localStorage.removeItem(Account.STORAGE_KEY);
		}
		catch (error)
		{
			// Nothing to do, the token just outlives the session
		}
	}

	public static register(server: string, username: string, password: string): Promise<AccountProfile>
	{
		return Account.post(server, '/auth/register', username, password);
	}

	public static login(server: string, username: string, password: string): Promise<AccountProfile>
	{
		return Account.post(server, '/auth/login', username, password);
	}

	/** Picks up an existing session, and refreshes the tallies while it's there. */
	public static resume(server: string): Promise<AccountProfile>
	{
		let token = Account.loadToken();
		if (token === undefined) return Promise.reject(new Error('No stored session.'));

		return fetch(Account.httpBase(server) + '/auth/me', {
			headers: { 'Authorization': 'Bearer ' + token }
		})
		.then((response) => Account.unwrap(response))
		.then((body) =>
		{
			Account.token = token;
			Account.profile = body.user;
			return body.user;
		});
	}

	/** A new personal best, for the per track boards. Ignored when not signed in. */
	public static submitLap(server: string, track: string, milliseconds: number): Promise<void>
	{
		if (Account.token === undefined) return Promise.reject(new Error('Not signed in.'));

		return fetch(Account.httpBase(server) + '/race/lap', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Account.token },
			body: JSON.stringify({ track: track, ms: milliseconds })
		})
		.then((response) => Account.unwrap(response))
		.then(() => undefined);
	}

	public static leaderboard(server: string, track?: string): Promise<any[]>
	{
		let query = track === undefined ? '' : '?track=' + encodeURIComponent(track);

		return fetch(Account.httpBase(server) + '/leaderboard' + query)
			.then((response) => Account.unwrap(response))
			.then((body) => body.players || []);
	}

	private static post(server: string, path: string, username: string, password: string): Promise<AccountProfile>
	{
		return fetch(Account.httpBase(server) + path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: username, password: password })
		})
		.then((response) => Account.unwrap(response))
		.then((body) =>
		{
			Account.token = body.token;
			Account.profile = { id: body.user.id, username: body.user.username, kills: 0, deaths: 0, played: 0 };

			try
			{
				window.localStorage.setItem(Account.STORAGE_KEY, body.token);
			}
			catch (error)
			{
				// Signed in for this session only
			}

			return Account.profile;
		});
	}

	/** Turns the server's error shape into a rejection carrying its message. */
	private static unwrap(response: Response): Promise<any>
	{
		return response.json()
			.catch(() => ({}))
			.then((body: any) =>
			{
				if (response.ok) return body;

				throw new Error(body.error || ('The server answered ' + response.status + '.'));
			});
	}
}
