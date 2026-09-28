import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { onTap } from './Tap';
import { Panel } from './Panel';
import { UIManager } from './UIManager';
import { GameInfo } from './GameInfo';
import { DONATION_ASK, DONATION_WALLETS, GITHUB_URL } from './Donations';
import { Account } from '../party/Account';
import { NetworkClient } from '../party/NetworkClient';
import { RaceSystem } from '../race/RaceSystem';
import { InputManager } from './InputManager';
import { Pointer } from './Pointer';

interface PhoneApp
{
	id: string;
	name: string;
	/** The tile behind the glyph. */
	color: string;
	/** The glyph: SVG path data on a 24 unit square, drawn in white. */
	icon: string;
	open: () => void;
}

/** A line in an app. With an action it can be picked; without, it's only read. */
interface PhoneRow
{
	title: string;
	detail?: string;
	aside?: string;
	/** Picked out: the job running, the music on. */
	highlight?: boolean;
	action?: () => void;
	/**
	 * The detail only shows once it's picked, and a tap on it picks it before
	 * a second one acts: a job is worth reading about before it starts.
	 */
	twoStep?: boolean;
	/** The detail can be selected, for an address to copy by hand. */
	selectable?: boolean;
}

/** What's on the screen when it isn't the home screen. */
interface PhoneView
{
	app: PhoneApp;
	/** Drawn again, a second at a time, while it's up: for things that change as you play. */
	live: boolean;
	draw: (into: HTMLElement) => PhoneRow[];
}

/**
 * The phone, the way GTA does it: up brings it out at the bottom right, the
 * arrows walk the apps, Enter opens one and Backspace comes back. The
 * player can keep walking or driving with it out. Everything the corner of
 * the screen used to list, the keys included, lives in here now.
 *
 * On a phone, a button beside the map brings it out, and the apps are tapped.
 */
export class Phone implements IUpdatable
{
	public updateOrder: number = 30;

	private static readonly REFRESH: number = 1;

	private world: World;
	private root: HTMLElement;
	private clock: HTMLElement;
	private title: HTMLElement;
	private home: HTMLElement;
	private view: HTMLElement;
	private content: HTMLElement;
	private hint: HTMLElement;
	private apps: PhoneApp[];
	private selected: number = 0;
	private current: PhoneView;
	private rows: PhoneRow[] = [];
	private rowElements: HTMLElement[] = [];
	private row: number = 0;
	/** The line a tap or click has picked, which a second one acts on. Arrows don't set it. */
	private armed: number = -1;
	/** What the app drew last, so a second's redraw that changes nothing leaves it alone. */
	private drawn: string;
	/** A finger or button down on the phone: a redraw now would take the thing being clicked away. */
	private pressing: boolean = false;
	/** What each address's copy button says, since the rows are drawn afresh. */
	private copied: { [address: string]: string } = {};
	private sinceRefresh: number = 0;
	/** Asked for the board, and whether that answer is still wanted when it comes. */
	private boardRequest: number = 0;

	constructor(world: World)
	{
		this.world = world;
		this.apps = this.makeApps();
		this.build();
		world.registerUpdatable(this);

		// Before the game's own keys: Enter here opens an app, not the chat
		document.addEventListener('keydown', (event) => this.onKey(event), true);

		let toggle = document.getElementById('phone-toggle');
		if (toggle !== null) onTap(toggle, () => this.toggle());

		let release = () => this.pressing = false;
		window.addEventListener('mouseup', release, true);
		window.addEventListener('touchend', release, true);
		window.addEventListener('touchcancel', release, true);
	}

	public get isOpen(): boolean
	{
		return this.root.classList.contains('open');
	}

	public open(): void
	{
		if (this.isOpen || !this.canOpen()) return;
		this.selected = Math.min(this.selected, this.apps.length - 1);
		this.showHome();
		this.updateClock();
		this.root.classList.add('open');
		document.body.classList.add('phone-open');
		if (this.world.support !== undefined) this.world.support.close();
	}

	public close(): void
	{
		if (!this.isOpen) return;
		this.root.classList.remove('open');
		document.body.classList.remove('phone-open');
		this.current = undefined;
		this.boardRequest++;
	}

	public toggle(): void
	{
		if (this.isOpen) this.close();
		else this.open();
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		if (!this.isOpen) return;

		// A shop or the job board takes the middle of the screen and the keys,
		// a player who's just died has other things on their mind, and a
		// scenario loading hides the screen the phone is on
		let character = this.world.localCharacter;
		if (Panel.isOpen || !this.canShow() || (character !== undefined && character.health <= 0))
		{
			this.close();
			return;
		}

		this.sinceRefresh += unscaledTimeStep;
		if (this.sinceRefresh < Phone.REFRESH) return;
		this.sinceRefresh = 0;
		this.updateClock();
		if (this.current !== undefined && this.current.live && !this.pressing) this.drawView();
	}

	/** The game on screen, not a loading screen or a dialog over it. */
	private canShow(): boolean
	{
		return UIManager.isUserInterfaceVisible() && document.querySelector('.swal2-container') === null;
	}

	// ------------------------------------------------------------------ input

	private canOpen(): boolean
	{
		if (!this.canShow() || Panel.isOpen) return false;
		if (this.world.pauseMenu !== undefined && this.world.pauseMenu.isOpen) return false;
		if (this.world.chat !== undefined && this.world.chat.typing) return false;
		let character = this.world.localCharacter;
		return character === undefined || character.health > 0;
	}

	private onKey(event: KeyboardEvent): void
	{
		// A name or a message being typed; a settings checkbox with focus isn't typing
		if (InputManager.isTyping(event)) return;

		// A dialog over the game has the keys, and the phone can't be seen anyway
		if (this.isOpen && !this.canShow())
		{
			this.close();
			return;
		}

		if (!this.isOpen)
		{
			if (event.code === 'ArrowUp' && !event.repeat && this.canOpen())
			{
				this.open();
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}

		let handled = true;
		switch (event.code)
		{
			case 'ArrowUp': this.move(0, -1); break;
			case 'ArrowDown': this.move(0, 1); break;
			case 'ArrowLeft': this.move(-1, 0); break;
			case 'ArrowRight': this.move(1, 0); break;
			case 'Enter':
			case 'NumpadEnter':
				if (!event.repeat) this.activate();
				break;
			case 'Backspace': this.back(); break;
			case 'Escape': this.close(); break;
			default: handled = false;
		}

		if (handled)
		{
			event.preventDefault();
			event.stopPropagation();
		}
	}

	/** Round the grid on the home screen, wrapping as GTA's does; up and down a list in an app. */
	private move(dx: number, dy: number): void
	{
		if (this.current === undefined)
		{
			let columns = 3;
			let count = this.apps.length;
			let column = this.selected % columns;
			let line = Math.floor(this.selected / columns);
			let lines = Math.ceil(count / columns);
			column = (column + dx + columns) % columns;
			line = (line + dy + lines) % lines;
			this.selected = Math.min(count - 1, line * columns + column);
			this.drawHome();
			return;
		}

		if (dy === 0) return;
		let picks = this.pickable();
		if (picks.length === 0)
		{
			// Nothing to pick, so up and down read further
			this.content.scrollTop += dy * 48;
			return;
		}
		let at = picks.indexOf(this.row);
		at = at < 0 ? 0 : (at + dy + picks.length) % picks.length;
		this.select(picks[at]);
	}

	private activate(): void
	{
		if (this.current === undefined)
		{
			this.apps[this.selected].open();
			return;
		}
		let row = this.rows[this.row];
		if (row !== undefined && row.action !== undefined) row.action();
	}

	/** Out of an app to the home screen, and from there away. */
	private back(): void
	{
		if (this.current !== undefined) this.showHome();
		else this.close();
	}

	// ---------------------------------------------------------------- screens

	private showHome(): void
	{
		this.current = undefined;
		this.boardRequest++;
		this.root.classList.remove('in-app');
		this.drawHome();
		this.hint.textContent = '↵ Open   ⌫ Put away';
	}

	private drawHome(): void
	{
		this.title.textContent = this.apps[this.selected].name;
		for (let i = 0; i < this.home.children.length; i++)
		{
			this.home.children[i].classList.toggle('selected', i === this.selected);
		}
	}

	private showApp(app: PhoneApp, live: boolean, draw: (into: HTMLElement) => PhoneRow[]): void
	{
		this.current = { app: app, live: live, draw: draw };
		this.row = -1;
		this.armed = -1;
		this.drawn = undefined;
		this.root.classList.add('in-app');
		this.title.textContent = app.name;
		this.content.scrollTop = 0;
		this.drawView();
		let picks = this.pickable();
		if (picks.length > 0) this.select(picks[0]);
		this.hint.textContent = picks.length > 0 ? '↵ Choose   ⌫ Back' : '↑↓ Read   ⌫ Back';
	}

	/**
	 * Draws the app again, keeping the line picked where it was. Built aside
	 * first, and only put on screen if it's changed: most seconds nothing has,
	 * and swapping the lines out under a click would lose the click.
	 */
	private drawView(): void
	{
		let view = this.current;
		if (view === undefined) return;

		let scratch = document.createElement('div');
		let rows = view.draw(scratch);
		let elements = rows.map((row, i) => this.rowElement(row, i));
		elements.forEach((element) => scratch.appendChild(element));
		if (scratch.innerHTML === this.drawn) return;
		this.drawn = scratch.innerHTML;

		let keep = this.row;
		let scroll = this.content.scrollTop;
		while (this.content.firstChild !== null) this.content.removeChild(this.content.firstChild);
		while (scratch.firstChild !== null) this.content.appendChild(scratch.firstChild);
		this.rows = rows;
		this.rowElements = elements;

		this.content.scrollTop = scroll;
		if (keep >= 0 && keep < this.rows.length && this.rows[keep].action !== undefined) this.select(keep, false);
		else this.row = -1;
	}

	private select(index: number, reveal: boolean = true): void
	{
		this.row = index;
		this.rowElements.forEach((element, i) => element.classList.toggle('selected', i === index));
		let element = this.rowElements[index];
		if (!reveal || element === undefined) return;

		// Kept in view without scrolling the page the phone sits in
		let top = element.offsetTop - this.content.offsetTop;
		let bottom = top + element.offsetHeight;
		if (top < this.content.scrollTop) this.content.scrollTop = top;
		else if (bottom > this.content.scrollTop + this.content.clientHeight) this.content.scrollTop = bottom - this.content.clientHeight;
	}

	private pickable(): number[]
	{
		let picks: number[] = [];
		this.rows.forEach((row, i) => { if (row.action !== undefined) picks.push(i); });
		return picks;
	}

	private rowElement(row: PhoneRow, index: number): HTMLElement
	{
		let line = document.createElement('div');
		line.className = 'phone-row' + (row.action !== undefined ? ' pickable' : '')
			+ (row.highlight ? ' highlight' : '') + (row.twoStep ? ' two-step' : '') + (row.selectable ? ' selectable' : '');

		// The name and what it says on the right, then the detail full width under both
		let top = document.createElement('div');
		top.className = 'phone-row-top';
		let title = document.createElement('div');
		title.className = 'phone-row-title';
		title.textContent = row.title;
		top.appendChild(title);
		if (row.aside !== undefined)
		{
			let aside = document.createElement('span');
			aside.className = 'phone-row-aside';
			aside.textContent = row.aside;
			top.appendChild(aside);
		}
		line.appendChild(top);

		if (row.detail !== undefined)
		{
			let detail = document.createElement('div');
			detail.className = 'phone-row-detail';
			detail.textContent = row.detail;
			line.appendChild(detail);
		}

		if (row.action !== undefined)
		{
			onTap(line, () =>
			{
				// The arrows may have picked it already, but a finger hasn't read it yet
				let first = row.twoStep === true && this.armed !== index;
				this.armed = index;
				this.select(index, true);
				if (!first) row.action();
			}, this.content);
		}
		return line;
	}

	private updateClock(): void
	{
		this.clock.textContent = Phone.timeOfDay(this.world);
	}

	/** The game's own time of day, with the sun up at six and down at six. */
	public static timeOfDay(world: World): string
	{
		if (world.sky === undefined) return '';
		let minutes = Math.floor(world.sky.clockHours * 60) % (24 * 60);
		let hours = Math.floor(minutes / 60);
		let pad = (n: number) => (n < 10 ? '0' : '') + n;
		return pad(hours) + ':' + pad(minutes % 60);
	}

	// ------------------------------------------------------------------- apps

	private makeApps(): PhoneApp[]
	{
		let apps: PhoneApp[] = [
			{ id: 'jobs', name: 'Jobs', color: '#f29d38',
				icon: 'M9 4h6a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3V6a2 2 0 0 1 2-2zm0 3h6V6H9v1z',
				open: () => undefined },
			{ id: 'map', name: 'Map', color: '#34b86a',
				icon: 'M12 2a7 7 0 0 1 7 7c0 5.2-7 13-7 13S5 14.2 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
				open: () => undefined },
			{ id: 'stats', name: 'Stats', color: '#2f8cf0',
				icon: 'M4 20V10h4v10H4zm6 0V4h4v16h-4zm6 0v-7h4v7h-4z',
				open: () => undefined },
			{ id: 'board', name: 'Leaderboard', color: '#e8b923',
				icon: 'M7 3h10v3h4v2a5 5 0 0 1-4.6 5A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.6 13 5 5 0 0 1 3 8V6h4V3zm10 5v2.8A3 3 0 0 0 19 8h-2zM5 8a3 3 0 0 0 2 2.8V8H5z',
				open: () => undefined },
			{ id: 'party', name: 'Party', color: '#a35ce0',
				icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1 20c0-3.9 3.6-7 8-7s8 3.1 8 7H1zm17 0c0-1.9-.6-3.6-1.7-5 3.2.2 5.7 2.3 5.7 5h-4z',
				open: () => undefined },
			{ id: 'controls', name: 'Controls', color: '#7d8590',
				icon: 'M7 7h10a5 5 0 0 1 0 10c-1.6 0-2.6-.8-3.4-2h-3.2C9.6 16.2 8.6 17 7 17A5 5 0 0 1 7 7zm-.5 3v1.5H5v1h1.5V14h1v-1.5H9v-1H7.5V10h-1zm9 .5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
				open: () => undefined },
			{ id: 'music', name: 'Music', color: '#f0426b',
				icon: 'M20 3v12.5a3.5 3.5 0 1 1-2-3.2V7.2l-8 1.6v8.7A3.5 3.5 0 1 1 8 14.3V5.4L20 3z',
				open: () => undefined },
			{ id: 'settings', name: 'Settings', color: '#4b5058',
				icon: 'M13.7 2l.5 2.6a8 8 0 0 1 1.9 1.1l2.5-.9 1.7 3-2 1.7a8 8 0 0 1 0 2.2l2 1.7-1.7 3-2.5-.9a8 8 0 0 1-1.9 1.1l-.5 2.6h-3.4l-.5-2.6a8 8 0 0 1-1.9-1.1l-2.5.9-1.7-3 2-1.7a8 8 0 0 1 0-2.2l-2-1.7 1.7-3 2.5.9a8 8 0 0 1 1.9-1.1l.5-2.6h3.4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
				open: () => undefined },
			{ id: 'support', name: 'Support', color: '#e5484d',
				icon: 'M12 21s-7.5-4.6-9.6-9C.8 8.4 3 4 7 4c2.2 0 3.6 1.2 5 3 1.4-1.8 2.8-3 5-3 4 0 6.2 4.4 4.6 8-2.1 4.4-9.6 9-9.6 9z',
				open: () => undefined },
		];

		let app = (id: string) => apps.filter((a) => a.id === id)[0];
		app('jobs').open = () => this.showApp(app('jobs'), true, () => this.jobRows());
		app('map').open = () =>
		{
			this.close();
			if (this.world.minimap !== undefined) this.world.minimap.setExpanded(true);
		};
		app('stats').open = () => this.showApp(app('stats'), true, (into) =>
		{
			let block = document.createElement('div');
			block.className = 'phone-info';
			GameInfo.renderStats(block, this.world);
			into.appendChild(block);
			return [];
		});
		app('board').open = () => this.showBoard(app('board'));
		app('party').open = () => this.showApp(app('party'), true, () => this.partyRows());
		app('controls').open = () => this.showApp(app('controls'), true, (into) =>
		{
			let block = document.createElement('div');
			block.className = 'phone-info';
			GameInfo.renderControls(block, this.world);
			into.appendChild(block);
			return [];
		});
		// Live, since M or the settings can switch it off while it's up
		app('music').open = () => this.showApp(app('music'), true, () => this.musicRows());
		app('settings').open = () =>
		{
			this.close();
			// The settings are clicked, so the mouse is let go, on purpose rather than as a pause
			Pointer.release();
			UIManager.showSettings(true);
		};
		app('support').open = () => this.showApp(app('support'), false, (into) => this.supportRows(into));
		return apps;
	}

	private jobRows(): PhoneRow[]
	{
		let jobs = this.world.jobs;
		if (jobs === undefined) return [{ title: 'No work going' }];
		return jobs.jobs.map((job) =>
		{
			let running = jobs.active === job;
			return {
				title: job.title,
				detail: running ? 'Working. Pick it again to quit' : job.description,
				aside: running ? 'ON' : job.pays,
				highlight: running,
				twoStep: true,
				action: () =>
				{
					this.close();
					if (running) jobs.quit();
					else jobs.start(job);
				}
			};
		});
	}

	/** The boards, from where accounts live: kills, or best laps on the circuit being driven. */
	private showBoard(app: PhoneApp): void
	{
		let track = this.world.race.trackId;
		let laps = track !== undefined;
		let rows: PhoneRow[] = [{ title: laps ? 'Best laps' : 'Most kills', detail: 'Asking the server…' }];
		this.showApp(app, false, () => rows);

		let request = ++this.boardRequest;
		let server = Account.server !== undefined ? Account.server : NetworkClient.defaultUrl();
		Account.leaderboard(server, track)
			.then((players) =>
			{
				rows = [{ title: laps ? 'Best laps' : 'Most kills' }];
				if (players.length === 0) rows.push({ title: 'Nobody has set one yet' });
				players.slice(0, 20).forEach((entry, i) =>
				{
					let value = laps ? entry.best_ms : entry.kills;
					rows.push({
						title: (i + 1) + '.  ' + String(entry.username),
						aside: typeof value !== 'number' ? '--' : (laps ? RaceSystem.clock(value / 1000) : String(value))
					});
				});
			})
			.catch((error) => rows = [{ title: laps ? 'Best laps' : 'Most kills', detail: error.message }])
			.then(() =>
			{
				if (request === this.boardRequest && this.current !== undefined && this.current.app === app) this.drawView();
			});
	}

	private partyRows(): PhoneRow[]
	{
		let party = this.world.party;
		if (party === undefined || !party.active)
		{
			return [
				{ title: 'Playing solo', detail: 'Parties start from the menu when the game opens: create one there, or join a friend\'s with their code.' }
			];
		}

		let rows: PhoneRow[] = [
			{ title: 'Party ' + party.client.code, detail: 'Friends join with this code' },
			{ title: 'Send a message', detail: 'Enter, any time', action: () =>
				{
					this.close();
					this.world.chat.begin();
				} }
		];
		party.roster().forEach((player, i) => rows.push({
			title: player.name + (i === 0 ? '  (you)' : ''),
			aside: String(player.score)
		}));
		return rows;
	}

	private musicRows(): PhoneRow[]
	{
		let on = !this.world.params.Mute_Music;
		return [
			{ title: 'Voltaic', detail: 'Kevin MacLeod, incompetech.com. CC BY 4.0' },
			{ title: 'Music', aside: on ? 'On' : 'Off', highlight: on, action: () =>
				{
					this.world.toggleMusic();
					this.drawView();
				} }
		];
	}

	private supportRows(into: HTMLElement): PhoneRow[]
	{
		let intro = document.createElement('div');
		intro.className = 'phone-info phone-note';
		intro.textContent = DONATION_ASK;
		into.appendChild(intro);

		let rows: PhoneRow[] = [
			{ title: 'The code on GitHub', detail: GITHUB_URL.replace('https://', ''), action: () => { window.open(GITHUB_URL, '_blank', 'noopener'); } }
		];
		for (const wallet of DONATION_WALLETS)
		{
			if (wallet.address.length === 0)
			{
				rows.push({ title: 'Donate: ' + GameInfo.walletName(wallet), detail: 'Wallet address coming soon' });
				continue;
			}
			let index = rows.length;
			rows.push({
				title: 'Donate: ' + GameInfo.walletName(wallet),
				detail: wallet.address,
				aside: this.copied[wallet.address] || 'Copy',
				selectable: true,
				action: () =>
				{
					GameInfo.copy(wallet.address).then((copied) =>
					{
						this.copied[wallet.address] = copied ? 'Copied' : 'Selected';
						this.drawView();
						// Where the clipboard said no, the address is picked out to copy by hand
						let detail = this.rowElements[index] !== undefined ? this.rowElements[index].querySelector('.phone-row-detail') : null;
						if (!copied && detail !== null)
						{
							let range = document.createRange();
							range.selectNodeContents(detail);
							window.getSelection().removeAllRanges();
							window.getSelection().addRange(range);
						}
					});
				}
			});
		}
		return rows;
	}

	// -------------------------------------------------------------- building

	private build(): void
	{
		let root = document.createElement('div');
		root.id = 'phone';
		root.innerHTML = '<div class="phone-body">'
			+ '<div class="phone-screen">'
			+ '<div class="phone-status"><span class="phone-clock"></span><span class="phone-island"></span>'
			+ '<span class="phone-signal"><i></i><i></i><i></i><i></i><b class="phone-battery"></b></span></div>'
			+ '<div class="phone-head"><span class="phone-back">‹</span><span class="phone-title"></span></div>'
			+ '<div class="phone-home"></div>'
			+ '<div class="phone-view"></div>'
			+ '<div class="phone-hint"></div>'
			+ '</div></div>';

		this.clock = root.querySelector('.phone-clock');
		this.title = root.querySelector('.phone-title');
		this.home = root.querySelector('.phone-home');
		this.view = root.querySelector('.phone-view');
		this.content = this.view;
		this.hint = root.querySelector('.phone-hint');

		this.apps.forEach((app, i) =>
		{
			let tile = document.createElement('div');
			tile.className = 'phone-app';
			tile.innerHTML = '<div class="phone-icon" style="background:' + app.color + '">'
				+ '<svg viewBox="0 0 24 24"><path fill="#fff" d="' + app.icon + '"></path></svg></div>'
				+ '<div class="phone-label">' + app.name + '</div>';
			onTap(tile, () =>
			{
				this.selected = i;
				this.drawHome();
				app.open();
			}, this.home);
			this.home.appendChild(tile);
		});

		onTap(root.querySelector('.phone-back') as HTMLElement, () => this.back());

		// The phone's own clicks and scrolling aren't the game's: no pointer
		// grab, no trigger pulled, no slowing time with the wheel over a list.
		// Releases still go through, or a button let go over it stays held
		for (const type of ['mousedown', 'click', 'touchstart', 'wheel'])
		{
			root.addEventListener(type, (event) => event.stopPropagation());
		}
		root.addEventListener('mousedown', () => this.pressing = true, true);
		root.addEventListener('touchstart', () => this.pressing = true, true);

		document.getElementById('ui-container').appendChild(root);
		this.root = root;
	}
}
