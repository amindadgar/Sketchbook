import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Account, AccountProfile } from '../party/Account';
import { Wallet, WalletState } from './Wallet';
import { ProgressState } from './Progress';
import { today } from './Challenges';

interface SaveData
{
	wallet: WalletState;
	progress: ProgressState;
}

interface Kept
{
	data: SaveData;
	revision: number;
}

/** The last copy an account was known to have, and whose account that is. */
interface Base
{
	user: number;
	revision: number;
	data: SaveData;
}

/**
 * Money, what it bought, and experience, kept on the account as well as in
 * the browser, so they follow a signed-in player to any device.
 *
 * The browser remembers the last copy the account was known to hold. When
 * the two meet, on signing in or when another device has saved in between,
 * what happened here since that copy is added to what the account has now:
 * money made and spent on both sides, experience from both, anything bought
 * on either. Without that last copy, the first time on a browser, whichever
 * side has seen more play is taken, with everything bought on both.
 *
 * A browser is one account's at a time. Signing in as somebody else puts the
 * first account's progress aside, kept for when they sign back in, rather
 * than lending it to the new one or throwing it away.
 *
 * Changes are sent a few seconds after they stop, at most every quarter of a
 * minute while they don't, and once more as the tab goes. Each save says
 * which revision it was made from, so a device that saved in between is
 * noticed and its copy put together with this one's before trying again.
 */
export class CloudSave implements IUpdatable
{
	public updateOrder: number = 50;

	private static readonly OWNER_KEY: string = 'sketchbook.progressOwner';
	private static readonly BASE_KEY: string = 'sketchbook.progressBase';
	private static readonly STASH_KEY: string = 'sketchbook.progressStash.';
	/** Seconds of quiet after a change before sending it. */
	private static readonly QUIET: number = 3;
	/** Never more often than this, however much is going on. */
	private static readonly MIN_GAP: number = 15;
	/** And never longer than this, while it keeps changing. */
	private static readonly MAX_WAIT: number = 30;
	private static readonly RETRY: number = 30;
	/** Kept here too, for a browser that won't store anything. */
	private static memoryOwner: number;
	private static memoryBase: Base;

	private world: World;
	/** Whose copy this is, and which revision of theirs it was last in step with. */
	private userId: number;
	private revision: number = 0;
	/** Loaded and put together: from here, changes are sent. */
	private ready: boolean = false;
	private busy: boolean = false;
	private exiting: boolean = false;
	/** The change count at the last acknowledged send or load, -1 while something's owed. */
	private sent: number = -1;
	private lastSeen: number = -1;
	private quietFor: number = 0;
	private sinceSend: number = 0;
	private waitFor: number = 0;
	private loadPending: boolean = false;

	constructor(world: World)
	{
		this.world = world;
		world.registerUpdatable(this);
		Account.onSignIn.push((profile) => this.signedIn(profile));
		Account.onSignOut.push(() => this.signedOut());
		window.addEventListener('pagehide', () => this.sendOnExit());
		document.addEventListener('visibilitychange', () =>
		{
			if (document.hidden) this.sendOnExit();
		});
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		this.waitFor = Math.max(0, this.waitFor - unscaledTimeStep);
		if (!this.ready)
		{
			if (this.loadPending && this.waitFor === 0 && !this.busy) this.load();
			return;
		}

		this.sinceSend += unscaledTimeStep;
		let changes = this.changes();
		if (changes !== this.lastSeen)
		{
			this.lastSeen = changes;
			this.quietFor = 0;
		}
		else this.quietFor += unscaledTimeStep;

		if (changes === this.sent || this.busy || this.exiting || this.waitFor > 0) return;
		// Something owed from a send that didn't land goes as soon as it may
		let owed = this.sent === -1;
		if (!owed && this.sinceSend < CloudSave.MIN_GAP) return;
		if (owed || this.quietFor >= CloudSave.QUIET || this.sinceSend >= CloudSave.MAX_WAIT) this.send();
	}

	// Signing in and out

	private signedIn(profile: AccountProfile): void
	{
		// The same account again, as when Google is put on it: nothing to do
		if (this.userId === profile.id && (this.ready || this.busy)) return;
		this.userId = profile.id;
		this.ready = false;
		this.revision = 0;
		this.load();
	}

	private signedOut(): void
	{
		// What's in the browser stays, and still belongs to whoever it was
		this.userId = undefined;
		this.ready = false;
		this.loadPending = false;
		this.revision = 0;
	}

	private load(): void
	{
		let user = this.userId;
		if (user === undefined || Account.token === undefined) return;
		this.busy = true;
		this.loadPending = false;
		fetch(Account.httpBase(Account.server) + '/save', { headers: { 'Authorization': 'Bearer ' + Account.token } })
			.then((response) => CloudSave.read(response))
			.then((body) =>
			{
				this.busy = false;
				if (this.userId !== user) return;
				this.reconcile(body.save);
			})
			.catch((error) =>
			{
				this.busy = false;
				if (this.userId !== user) return;
				if (error.status === 401)
				{
					this.expired();
					return;
				}
				// Offline, or the server's behind: try again in a while
				this.loadPending = error.status !== 503;
				this.waitFor = CloudSave.RETRY;
			});
	}

	// Putting the two together

	/**
	 * The account's copy and this browser's, made one, and sent back if that
	 * isn't what the account already has.
	 */
	private reconcile(remote: Kept): void
	{
		let user = this.userId;
		let owner = CloudSave.owner();
		let name = Account.profile !== undefined ? Account.profile.username : 'your account';

		// This browser's copy for this account: the live one if it's theirs, or
		// theirs put aside when somebody else signed in here
		let local: SaveData;
		let base: Base;
		if (owner === undefined || owner === user)
		{
			local = this.snapshot();
			base = CloudSave.loadBase();
			if (base !== undefined && base.user !== user) base = undefined;
		}
		else
		{
			// Somebody else's: put aside for them, never lent to this account
			CloudSave.stash(owner, this.snapshot(), CloudSave.loadBase());
			let kept = CloudSave.unstash(user);
			if (kept !== undefined)
			{
				local = kept.data;
				base = kept.base !== undefined && kept.base !== null && kept.base.user === user ? kept.base : undefined;
			}
		}
		let fresh = local === undefined || CloudSave.untouched(local);

		let merged: SaveData;
		let loaded = false;
		if (remote === null)
		{
			merged = fresh ? CloudSave.fresh() : CloudSave.copy(local);
		}
		else if (fresh)
		{
			merged = CloudSave.copy(remote.data);
			loaded = true;
		}
		else if (base !== undefined)
		{
			// What happened here since the account's last known copy, on top of what it has now
			merged = CloudSave.threeWay(base.data, local, remote.data);
		}
		else
		{
			// First time here with this account: the copy that's seen more play, with everything bought on both
			loaded = CloudSave.score(remote.data) >= CloudSave.score(local);
			merged = CloudSave.union(loaded ? remote.data : local, loaded ? local : remote.data);
		}

		this.apply(merged);
		this.revision = remote === null ? 0 : remote.revision;
		if (remote !== null) CloudSave.saveBase({ user: user, revision: remote.revision, data: CloudSave.copy(remote.data) });
		this.begin();

		// Compared in the same shape: the server's copy carries a version of its own
		let changed = remote === null || CloudSave.canonical(merged) !== CloudSave.canonical(CloudSave.copy(remote.data));
		if (changed)
		{
			// Owed until the server says it has it, so a send that fails is tried again
			this.sent = -1;
			this.send(merged);
		}

		if (remote === null && fresh) return;
		if (remote === null) this.world.notices.say('Progress saved', 'good', 'kept on ' + name + ' from now on');
		else if (loaded) this.world.notices.say('Progress loaded', 'good', 'from ' + name);
		else if (changed) this.world.notices.say('Progress saved', 'good', 'kept on ' + name);
	}

	/** In step from here: changes are counted from now, and the browser's copy is this account's. */
	private begin(): void
	{
		this.ready = true;
		this.sent = this.changes();
		this.lastSeen = this.sent;
		this.sinceSend = CloudSave.MIN_GAP;
		CloudSave.setOwner(this.userId);
	}

	private apply(data: SaveData): void
	{
		this.world.wallet.adopt(data.wallet);
		this.world.progress.adopt(data.progress);
		if (this.world.combat !== undefined) this.world.combat.restoreOwned();
	}

	/** The session's over: signed out, and what's here stays here until they sign in again. */
	private expired(): void
	{
		this.ready = false;
		this.world.notices.say('Signed out', 'bad', 'reload the page and sign in again to keep saving');
		Account.signOut();
	}

	// Sending

	private send(data?: SaveData): void
	{
		let user = this.userId;
		if (user === undefined || Account.token === undefined || this.busy) return;
		let body = data !== undefined ? data : this.snapshot();
		let at = this.changes();
		let from = this.revision;
		this.busy = true;
		fetch(Account.httpBase(Account.server) + '/save', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Account.token },
			body: JSON.stringify({ data: body, revision: from })
		})
			.then((response) => CloudSave.read(response))
			.then((answer) =>
			{
				this.busy = false;
				if (this.userId !== user) return;
				this.acknowledged(user, answer.revision, body, at);
			})
			.catch((error) =>
			{
				this.busy = false;
				if (this.userId !== user) return;
				this.sinceSend = 0;
				if (error.status === 409 && error.body !== undefined && error.body.save !== undefined)
				{
					// Saved from another device since: put the two together, and that's sent in turn
					this.reconcile(error.body.save);
					return;
				}
				if (error.status === 401)
				{
					this.expired();
					return;
				}
				this.waitFor = CloudSave.RETRY;
			});
	}

	/** The server has it: that's the new last known copy. Anything changed since is still owed. */
	private acknowledged(user: number, revision: number, data: SaveData, at: number): void
	{
		this.revision = revision;
		this.sent = at;
		this.sinceSend = 0;
		CloudSave.saveBase({ user: user, revision: revision, data: CloudSave.copy(data) });
	}

	/**
	 * Whatever hasn't gone yet, as the tab goes. The browser finishes sending
	 * it; if the page is only hidden and hears back, it's taken as sent.
	 */
	private sendOnExit(): void
	{
		if (!this.ready || this.busy || this.exiting || this.changes() === this.sent || Account.token === undefined) return;
		let user = this.userId;
		let at = this.changes();
		let from = this.revision;
		let data = this.snapshot();
		this.exiting = true;
		try
		{
			fetch(Account.httpBase(Account.server) + '/save', {
				method: 'PUT',
				keepalive: true,
				headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Account.token },
				body: JSON.stringify({ data: data, revision: from })
			}).then((response) => CloudSave.read(response)).then((answer) =>
			{
				this.exiting = false;
				// Only if nothing else has moved on in the meantime
				if (this.userId === user && this.revision === from) this.acknowledged(user, answer.revision, data, at);
			}).catch(() =>
			{
				// A conflict or a failure is sorted out by the next regular send
				this.exiting = false;
			});
		}
		catch (error)
		{
			this.exiting = false;
		}
	}

	// Pieces

	private snapshot(): SaveData
	{
		return { wallet: this.world.wallet.snapshot(), progress: this.world.progress.snapshot() };
	}

	private changes(): number
	{
		return this.world.wallet.changes + this.world.progress.changes;
	}

	/** Nothing played yet: what anybody starts with. */
	private static untouched(data: SaveData): boolean
	{
		let wallet = data.wallet;
		return (Number(wallet.earned) || 0) === 0 && Number(wallet.cash) === Wallet.STARTING_CASH
			&& (wallet.guns || []).length === 0 && (wallet.vehicles || []).length === 0 && (Number(data.progress.xp) || 0) === 0;
	}

	/** How much play a copy has seen: money made and experience, neither of which spending undoes. */
	private static score(data: SaveData): number
	{
		return (Number(data.wallet.earned) || 0) + (Number(data.progress.xp) || 0);
	}

	/** One copy, with everything the other bought as well. */
	private static union(first: SaveData, second: SaveData): SaveData
	{
		let merged = CloudSave.copy(first);
		let other = CloudSave.copy(second);
		merged.wallet.guns = Array.from(new Set(merged.wallet.guns.concat(other.wallet.guns)));
		for (const vehicle of other.wallet.vehicles)
		{
			if (!merged.wallet.vehicles.some((v) => v.model === vehicle.model)) merged.wallet.vehicles.push(vehicle);
		}
		return merged;
	}

	/**
	 * The account's copy now, plus what this browser did since the copy both
	 * last agreed on: money in and out, experience, today's counts, anything
	 * bought.
	 */
	private static threeWay(baseData: SaveData, localData: SaveData, remoteData: SaveData): SaveData
	{
		let base = CloudSave.copy(baseData);
		let local = CloudSave.copy(localData);
		let merged = CloudSave.union(remoteData, localData);
		let n = (value: any) => Number(value) || 0;

		merged.wallet.cash = Math.max(0, Math.round(n(merged.wallet.cash) + n(local.wallet.cash) - n(base.wallet.cash)));
		merged.wallet.earned = n(merged.wallet.earned) + Math.max(0, n(local.wallet.earned) - n(base.wallet.earned));
		merged.progress.xp = n(merged.progress.xp) + Math.max(0, n(local.progress.xp) - n(base.progress.xp));

		// Today's counts, added the same way when both are today's; the fastest is the fastest of either
		if (local.progress.day === merged.progress.day)
		{
			let baseCounts = base.progress.day === local.progress.day ? base.progress.counters : {};
			let counters = merged.progress.counters;
			for (const key of Object.keys(local.progress.counters))
			{
				let mine = n(local.progress.counters[key]);
				counters[key] = key === 'topSpeed'
					? Math.max(n(counters[key]), mine)
					: n(counters[key]) + Math.max(0, mine - n(baseCounts[key]));
			}
			merged.progress.done = Array.from(new Set(merged.progress.done.concat(local.progress.done)));
		}
		else if (local.progress.day > merged.progress.day)
		{
			// This browser has moved on to a day the account hasn't seen
			merged.progress.day = local.progress.day;
			merged.progress.counters = Object.assign({}, local.progress.counters);
			merged.progress.done = local.progress.done.slice();
		}
		return merged;
	}

	/**
	 * The same copy, written the same way whatever order its fields arrived
	 * in: the database hands them back in an order of its own, and that isn't
	 * a change worth saving.
	 */
	private static canonical(value: any): string
	{
		if (Array.isArray(value)) return '[' + value.map((item) => CloudSave.canonical(item)).join(',') + ']';
		if (value !== null && typeof value === 'object')
		{
			return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + CloudSave.canonical(value[key])).join(',') + '}';
		}
		return JSON.stringify(value);
	}

	private static fresh(): SaveData
	{
		return {
			wallet: { cash: Wallet.STARTING_CASH, guns: [], vehicles: [], earned: 0 },
			progress: { xp: 0, day: today(), counters: {}, done: [] }
		};
	}

	private static copy(data: SaveData): SaveData
	{
		let base = CloudSave.fresh();
		let copy = JSON.parse(JSON.stringify(data || {}));
		return {
			wallet: Object.assign(base.wallet, copy.wallet || {}),
			progress: Object.assign(base.progress, copy.progress || {})
		};
	}

	// What the browser remembers

	/** Which account this browser's copy is. */
	private static owner(): number
	{
		if (CloudSave.memoryOwner !== undefined) return CloudSave.memoryOwner;
		let value = CloudSave.get(CloudSave.OWNER_KEY);
		return value === null ? undefined : Number(value);
	}

	private static setOwner(id: number): void
	{
		CloudSave.memoryOwner = id;
		CloudSave.set(CloudSave.OWNER_KEY, String(id));
	}

	private static loadBase(): Base
	{
		if (CloudSave.memoryBase !== undefined) return CloudSave.memoryBase;
		try
		{
			let raw = CloudSave.get(CloudSave.BASE_KEY);
			return raw === null ? undefined : JSON.parse(raw);
		}
		catch (error)
		{
			return undefined;
		}
	}

	private static saveBase(base: Base): void
	{
		CloudSave.memoryBase = base;
		CloudSave.set(CloudSave.BASE_KEY, JSON.stringify(base));
	}

	/** Somebody's progress put aside while another account uses this browser. */
	private static stash(user: number, data: SaveData, base: Base): void
	{
		CloudSave.set(CloudSave.STASH_KEY + user, JSON.stringify({ data: data, base: base !== undefined && base.user === user ? base : null }));
	}

	private static unstash(user: number): { data: SaveData, base: Base }
	{
		let raw = CloudSave.get(CloudSave.STASH_KEY + user);
		if (raw === null) return undefined;
		try
		{
			window.localStorage.removeItem(CloudSave.STASH_KEY + user);
		}
		catch (error)
		{
			// Left behind, and used again next time: no harm
		}
		try
		{
			return JSON.parse(raw);
		}
		catch (error)
		{
			return undefined;
		}
	}

	private static get(key: string): string
	{
		try
		{
			return window.localStorage.getItem(key);
		}
		catch (error)
		{
			return null;
		}
	}

	private static set(key: string, value: string): void
	{
		try
		{
			window.localStorage.setItem(key, value);
		}
		catch (error)
		{
			// Private browsing: remembered for this session only
		}
	}

	/** The body of a good answer, or a rejection carrying the status and body of a bad one. */
	private static read(response: Response): Promise<any>
	{
		return response.json().catch(() => ({})).then((body: any) =>
		{
			if (response.ok) return body;
			let error: any = new Error(body.error || ('The server answered ' + response.status + '.'));
			error.status = response.status;
			error.body = body;
			throw error;
		});
	}
}
