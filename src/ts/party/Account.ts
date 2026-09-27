export interface AccountProfile
{
	id: number;
	username: string;
	kills: number;
	deaths: number;
	played: number;
	/** Google sign-in is on the account. */
	google?: boolean;
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
	/** The party server the session belongs to: where its progress is kept. */
	public static server: string;
	/** Told when somebody signs in, or a stored session is picked back up. */
	public static onSignIn: ((profile: AccountProfile) => void)[] = [];
	public static onSignOut: (() => void)[] = [];
	/** Goes up with every sign-in and sign-out, so a slow answer about an older session can tell it's stale. */
	private static generation: number = 0;

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
		Account.server = undefined;
		Account.generation++;
		for (const listener of Account.onSignOut) listener();

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
		let generation = Account.generation;

		return fetch(Account.httpBase(server) + '/auth/me', {
			headers: { 'Authorization': 'Bearer ' + token }
		})
		.then((response) => Account.unwrap(response))
		.then((body) =>
		{
			// Somebody signed in or out while this was on its way: theirs stands
			if (Account.generation !== generation) return Account.profile;
			Account.token = token;
			Account.profile = body.user;
			Account.server = server;
			for (const listener of Account.onSignIn) listener(body.user);
			return body.user;
		});
	}

	/** What the server offers besides a name and password: the Google client id, if Google sign-in is on. */
	public static config(server: string): Promise<{ google: string }>
	{
		return fetch(Account.httpBase(server) + '/auth/config')
			.then((response) => Account.unwrap(response))
			.then((body) => ({ google: typeof body.google === 'string' && body.google.length > 0 ? body.google : undefined }));
	}

	/**
	 * Signs in with what Google's button handed back. Signed in already, it
	 * puts Google sign-in on that account instead, when link is asked for.
	 */
	public static google(server: string, credential: string, link: boolean = false): Promise<AccountProfile>
	{
		let headers: { [name: string]: string } = { 'Content-Type': 'application/json' };
		if (link && Account.token !== undefined) headers['Authorization'] = 'Bearer ' + Account.token;
		return fetch(Account.httpBase(server) + '/auth/google', {
			method: 'POST',
			headers: headers,
			body: JSON.stringify({ credential: credential, link: link })
		})
		.then((response) => Account.unwrap(response))
		.then((body) =>
		{
			let profile = Account.accept(server, body, true);
			return profile;
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
		.then((body) => Account.accept(server, body));
	}

	/** A token and a user from the server: signed in, kept for next time, and everyone told. */
	private static accept(server: string, body: any, google: boolean = false): AccountProfile
	{
		let same = Account.profile !== undefined && Account.profile.id === body.user.id;
		Account.token = body.token;
		Account.generation++;
		// The tallies come with /auth/me; a fresh sign-in starts from what's known
		Account.profile = same ? Account.profile : { id: body.user.id, username: body.user.username, kills: 0, deaths: 0, played: 0 };
		if (google) Account.profile.google = true;
		Account.server = server;

		try
		{
			window.localStorage.setItem(Account.STORAGE_KEY, body.token);
		}
		catch (error)
		{
			// Signed in for this session only
		}

		for (const listener of Account.onSignIn) listener(Account.profile);
		return Account.profile;
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
