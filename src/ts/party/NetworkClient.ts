export interface PlayerInfo
{
	id: number;
	name: string;
	color: string;
	score?: number;
}

/**
 * Thin wrapper over the relay's WebSocket protocol. It knows the message
 * shapes and nothing about the game, so the world can stay unaware of sockets.
 */
export class NetworkClient
{
	/** The relay that ships alongside the hosted game. */
	public static readonly DEPLOYED_URL: string = 'wss://relay-production-d528.up.railway.app';
	private static readonly LOCAL_URL: string = 'ws://localhost:9000';
	private static readonly STORAGE_KEY: string = 'sketchbook.serverUrl';

	public id: number;
	public code: string;
	public connected: boolean = false;

	public onJoined: (code: string, id: number, players: PlayerInfo[], scenario: string) => void;
	public onPlayerJoin: (info: PlayerInfo) => void;
	public onPlayerLeave: (id: number) => void;
	public onPlayerState: (message: any) => void;
	public onVehicleState: (message: any) => void;
	public onIdentity: (info: PlayerInfo) => void;
	public onScenario: (id: string) => void;
	public onShot: (message: any) => void;
	public onHit: (message: any) => void;
	public onScore: (id: number, score: number) => void;
	public onError: (message: string) => void;
	public onDisconnect: () => void;

	private socket: WebSocket;

	public static loadUrl(): string
	{
		try
		{
			return window.localStorage.getItem(NetworkClient.STORAGE_KEY) || NetworkClient.defaultUrl();
		}
		catch (error)
		{
			return NetworkClient.defaultUrl();
		}
	}

	/**
	 * Guesses the relay from where the page itself came from, so the field is
	 * already right however the game is being run and nobody has to be told an
	 * address. Typing over it still wins, and what's typed is remembered.
	 */
	public static defaultUrl(): string
	{
		let host = window.location.hostname;

		// Served from the same machine, so the relay is expected beside it
		if (host === '' || host === 'localhost' || host === '127.0.0.1') return NetworkClient.LOCAL_URL;

		// A private address means somebody is hosting on their own network,
		// where the relay runs on the same box as the game
		if (NetworkClient.isPrivateAddress(host)) return 'ws://' + host + ':9000';

		// Anything else is the hosted deployment, whose relay is its own service
		// on its own domain, behind TLS on the standard port
		return NetworkClient.DEPLOYED_URL;
	}

	private static isPrivateAddress(host: string): boolean
	{
		return /^10\./.test(host)
			|| /^192\.168\./.test(host)
			|| /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)
			|| host.indexOf('.') === -1
			|| /\.local$/.test(host);
	}

	public static saveUrl(url: string): void
	{
		try
		{
			window.localStorage.setItem(NetworkClient.STORAGE_KEY, url);
		}
		catch (error)
		{
			// Not worth surfacing, the URL just won't be remembered
		}
	}

	/** Resolves once the socket is open, rejects with a readable reason. */
	public connect(url: string): Promise<void>
	{
		return new Promise<void>((resolve, reject) =>
		{
			try
			{
				this.socket = new WebSocket(url);
			}
			catch (error)
			{
				reject(new Error('\'' + url + '\' isn\'t a valid server address.'));
				return;
			}

			let settled = false;

			// A wrong host can leave the socket hanging rather than erroring
			let timeout = window.setTimeout(() =>
			{
				if (settled) return;

				settled = true;
				this.disconnect();
				reject(new Error('The party server at ' + url + ' didn\'t answer.'));
			}, 8000);

			this.socket.onopen = () =>
			{
				settled = true;
				window.clearTimeout(timeout);
				this.connected = true;
				resolve();
			};

			this.socket.onerror = () =>
			{
				if (!settled)
				{
					settled = true;
					window.clearTimeout(timeout);
					reject(new Error('Couldn\'t reach the party server at ' + url + '.'));
				}
			};

			this.socket.onclose = () =>
			{
				let wasConnected = this.connected;
				this.connected = false;

				if (!settled)
				{
					settled = true;
					window.clearTimeout(timeout);
					reject(new Error('Couldn\'t reach the party server at ' + url + '.'));
				}
				else if (wasConnected && this.onDisconnect !== undefined)
				{
					this.onDisconnect();
				}
			};

			this.socket.onmessage = (event) =>
			{
				this.handleMessage(event.data);
			};
		});
	}

	public createRoom(name: string, color: string, scenario: string): void
	{
		this.send({ t: 'create', name: name, color: color, scenario: scenario });
	}

	public joinRoom(code: string, name: string, color: string): void
	{
		this.send({ t: 'join', code: code, name: name, color: color });
	}

	public send(message: any): void
	{
		if (this.socket !== undefined && this.socket.readyState === WebSocket.OPEN)
		{
			this.socket.send(JSON.stringify(message));
		}
	}

	public disconnect(): void
	{
		this.connected = false;

		if (this.socket !== undefined)
		{
			this.socket.onclose = null;
			this.socket.close();
			this.socket = undefined;
		}
	}

	private handleMessage(raw: any): void
	{
		let message: any;

		try
		{
			message = JSON.parse(raw);
		}
		catch (error)
		{
			return;
		}

		switch (message.t)
		{
			case 'joined':
				this.id = message.id;
				this.code = message.code;
				if (this.onJoined !== undefined) this.onJoined(message.code, message.id, message.players, message.scenario);
				break;

			case 'join':
				if (this.onPlayerJoin !== undefined) this.onPlayerJoin(message);
				break;

			case 'leave':
				if (this.onPlayerLeave !== undefined) this.onPlayerLeave(message.id);
				break;

			case 'state':
				if (this.onPlayerState !== undefined) this.onPlayerState(message);
				break;

			case 'vehicle':
				if (this.onVehicleState !== undefined) this.onVehicleState(message);
				break;

			case 'identity':
				if (this.onIdentity !== undefined) this.onIdentity(message);
				break;

			case 'scenario':
				if (this.onScenario !== undefined) this.onScenario(message.id);
				break;

			case 'shot':
				if (this.onShot !== undefined) this.onShot(message);
				break;

			case 'hit':
				if (this.onHit !== undefined) this.onHit(message);
				break;

			case 'score':
				if (this.onScore !== undefined) this.onScore(message.id, message.score);
				break;

			case 'error':
				if (this.onError !== undefined) this.onError(message.message);
				break;
		}
	}
}
