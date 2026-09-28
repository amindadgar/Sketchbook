import Swal from 'sweetalert2';

import { PlayerIdentity } from './PlayerIdentity';
import { NetworkClient } from './NetworkClient';
import { Account } from './Account';
import { COLOURS, HATS, isUnlocked, Unlock } from './Unlocks';
import { TouchControls } from '../core/TouchControls';

export interface PartyMenuOptions
{
	identity: PlayerIdentity;
	onPlay: () => void;
	onHost: (url: string) => Promise<void>;
	onJoin: (url: string, code: string) => Promise<void>;
}

/**
 * The dialog shown once the world has loaded. Signs the player in, picks
 * their name and colour, and optionally starts or joins a party before the
 * game begins.
 *
 * Where the game's own relay has Google sign-in set up, signing in with it
 * is how the game starts: playing solo, hosting and joining all wait for it.
 */
export class PartyMenu
{
	/** Whether playing waits for a Google sign-in. Undefined until the relay has said. */
	private static required: boolean;
	/** A stored session being picked back up, which may well make signing in unnecessary. */
	private static resuming: boolean = false;
	private static showing: boolean = false;
	/** A party being hosted or joined, which holds the buttons down until it's settled. */
	private static connecting: boolean = false;
	private static googleClientId: string;
	private static retryTimer: number;
	private static readonly RETRY_MS: number = 5000;

	public static show(options: PartyMenuOptions): void
	{
		let entered = false;
		PartyMenu.required = undefined;
		PartyMenu.connecting = false;

		Swal.fire({
			title: 'Welcome to Sketchbook!',
			html: PartyMenu.buildHtml(options.identity),
			confirmButtonText: 'Play solo',
			buttonsStyling: false,
			allowOutsideClick: false,
			allowEscapeKey: false,
			// The music is CC BY, so its credit goes where players can see it
			footer: '<a href="https://github.com/amindadgar/Sketchbook" target="_blank">GitHub page</a>'
				+ '<span class="music-credit">Music: <a href="https://incompetech.com" target="_blank">'
				+ '"Voltaic" Kevin MacLeod (incompetech.com)</a>, licensed under '
				+ '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank">CC BY 4.0</a></span>',
			onBeforeOpen: () =>
			{
				PartyMenu.showing = true;
				PartyMenu.bindSwatches();
				PartyMenu.bindServerPicker();
				PartyMenu.bindPartyButtons(options, () => { entered = true; });
				PartyMenu.bindAccount(options.identity);
			},
			onClose: () =>
			{
				PartyMenu.showing = false;
				window.clearTimeout(PartyMenu.retryTimer);
			},
			preConfirm: () =>
			{
				// However it was pressed: Enter can still get here with the button greyed out
				if (!PartyMenu.mayPlay())
				{
					// Turning it down puts the button back as it was before the press
					window.setTimeout(() => PartyMenu.updateGate(), 0);
					return false;
				}
				PartyMenu.commitIdentity(options.identity);
				return true;
			}
		}).then((result) =>
		{
			// Party paths close the dialog themselves and have already started the game
			if (result.value === true && !entered) options.onPlay();
		});
	}

	private static buildHtml(identity: PlayerIdentity): string
	{
		let kills = Account.profile !== undefined ? Account.profile.kills : 0;

		let swatches = COLOURS.map((entry) =>
		{
			let locked = !isUnlocked(entry, kills);
			let selected = !locked && entry.id.toLowerCase() === identity.color.toLowerCase();

			return '<button type="button" class="party-swatch'
				+ (selected ? ' selected' : '') + (locked ? ' locked' : '') + '"'
				+ (locked ? ' disabled' : '')
				+ ' title="' + PartyMenu.escape(PartyMenu.unlockLabel(entry, locked)) + '"'
				+ ' data-color="' + entry.id + '" style="background: ' + entry.id + ';">'
				+ (locked ? '<span class="party-lock">&#128274;</span>' : '') + '</button>';
		}).join('');

		let hats = HATS.map((entry) =>
		{
			let locked = !isUnlocked(entry, kills);
			let selected = !locked && entry.id === identity.hat;

			return '<button type="button" class="party-hat'
				+ (selected ? ' selected' : '') + (locked ? ' locked' : '') + '"'
				+ (locked ? ' disabled' : '')
				+ ' data-hat="' + entry.id + '">'
				+ PartyMenu.escape(PartyMenu.unlockLabel(entry, locked)) + '</button>';
		}).join('');

		return '<p class="party-intro">Explore the world and hop into any vehicle.'
			+ ' Scenarios are in the right hand panel.</p>'
			+ PartyMenu.buildInstallHint()
			// First, since everything else waits on it when it's required
			+ '<div class="party-account">'
			+ '<div class="party-server-line">'
			+ '<span class="party-server-label">Account</span>'
			+ '<span id="party-account-current" class="party-server-current">Checking\u2026</span>'
			+ '<button type="button" id="party-account-toggle" class="party-server-change">Sign in</button>'
			+ '</div>'
			+ '<div id="party-account-note" class="party-account-note"></div>'
			+ '<div id="party-google" class="party-google"></div>'
			+ '<div id="party-google-link" class="party-google"></div>'
			+ '<button type="button" id="party-account-old" class="party-server-change party-account-old">'
			+ 'Made an account with a password before? Sign in to it here first</button>'
			+ '<div id="party-account-panel" class="party-server-panel">'
			+ '<input id="party-account-name" class="party-input" maxlength="16" spellcheck="false" placeholder="Name">'
			+ '<input id="party-account-password" class="party-input" type="password" placeholder="Password">'
			+ '<div class="party-row">'
			+ '<button type="button" id="party-account-login" class="party-button">Sign in</button>'
			+ '<button type="button" id="party-account-register" class="party-button">Create account</button>'
			+ '</div>'
			+ '</div>'
			+ '<div id="party-account-status" class="party-status"></div>'
			+ '<button type="button" id="party-account-move" class="party-button party-account-move"></button>'
			+ '</div>'
			+ '<label class="party-label" for="party-name">Your name</label>'
			+ '<input id="party-name" class="party-input" maxlength="16" spellcheck="false"'
			+ ' value="' + PartyMenu.escape(identity.name) + '">'
			+ '<label class="party-label">Your colour</label>'
			+ '<div id="party-colors" class="party-colors">' + swatches + '</div>'
			+ '<label class="party-label">Your hat</label>'
			+ '<div id="party-hats" class="party-hats">' + hats + '</div>'
			+ '<div class="party-divider"><span>or play with friends</span></div>'
			+ '<div class="party-row">'
			+ '<input id="party-code-input" class="party-input party-code-input" maxlength="4"'
			+ ' spellcheck="false" placeholder="CODE">'
			+ '<button type="button" id="party-join" class="party-button">Join</button>'
			+ '<button type="button" id="party-host" class="party-button party-button-primary">Create party</button>'
			+ '</div>'
			// Folded away, because the default is right almost always. It only
			// needs to be reachable, not in the way.
			+ '<div class="party-server-line">'
			+ '<span class="party-server-label">Party server</span>'
			+ '<span id="party-server-current" class="party-server-current"></span>'
			+ '<button type="button" id="party-server-toggle" class="party-server-change">Change</button>'
			+ '</div>'
			+ '<div id="party-server-panel" class="party-server-panel">'
			+ '<select id="party-server-choice" class="party-input"></select>'
			+ '<input id="party-server" class="party-input party-server-custom" spellcheck="false">'
			+ '</div>'
			+ '<div id="party-status" class="party-status"></div>';
	}

	/**
	 * Phones run this far better once installed, so say so, but only where it
	 * can actually be acted on: a touch device that isn't already standalone.
	 */
	private static buildInstallHint(): string
	{
		if (!TouchControls.isTouchDevice()) return '';
		if (PartyMenu.isInstalled()) return '';

		let steps = PartyMenu.isIOS()
			? 'tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>'
			: 'open the browser menu, then <strong>Install app</strong>';

		return '<p class="party-install">\uD83D\uDCF2 Playing on a phone? For a fullscreen,'
			+ ' proper game feel, ' + steps + '.</p>';
	}

	private static isInstalled(): boolean
	{
		// iOS Safari never grew display-mode, and reports its own flag instead
		if ((window.navigator as any).standalone === true) return true;
		return window.matchMedia !== undefined
			&& window.matchMedia('(display-mode: standalone)').matches;
	}

	private static isIOS(): boolean
	{
		// iPadOS lies and claims to be a Mac, so the touch point count settles it
		let platform = window.navigator.platform || '';
		if (/iPhone|iPad|iPod/.test(platform)) return true;
		return platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
	}

	private static bindPartyButtons(options: PartyMenuOptions, markEntered: () => void): void
	{
		let host = document.getElementById('party-host');
		let join = document.getElementById('party-join');
		let status = document.getElementById('party-status');

		let begin = (action: () => Promise<void>) =>
		{
			if (!PartyMenu.mayPlay() || PartyMenu.connecting) return;
			PartyMenu.commitIdentity(options.identity);

			PartyMenu.connecting = true;
			PartyMenu.updateGate();
			status.textContent = 'Connecting…';
			status.className = 'party-status';

			action().then(() =>
			{
				PartyMenu.connecting = false;
				markEntered();
				Swal.close();
				options.onPlay();
			})
			.catch((error) =>
			{
				PartyMenu.connecting = false;
				PartyMenu.updateGate();
				status.textContent = error.message;
				status.className = 'party-status party-status-error';
			});
		};

		host.addEventListener('click', () =>
		{
			begin(() => options.onHost(PartyMenu.serverUrl()));
		}, false);

		join.addEventListener('click', () =>
		{
			let code = (document.getElementById('party-code-input') as HTMLInputElement).value.trim();

			if (code.length === 0)
			{
				status.textContent = 'Enter the code your friend gave you.';
				status.className = 'party-status party-status-error';
				return;
			}

			begin(() => options.onJoin(PartyMenu.serverUrl(), code));
		}, false);
	}

	/**
	 * The server row: what it's set to now, and a way to change it. Presets are
	 * labelled with the address they resolve to, so picking one is a choice
	 * between places rather than a URL to be typed correctly.
	 */
	private static bindServerPicker(): void
	{
		let input = document.getElementById('party-server') as HTMLInputElement;
		let choice = document.getElementById('party-server-choice') as HTMLSelectElement;
		let current = document.getElementById('party-server-current');
		let panel = document.getElementById('party-server-panel');
		let toggle = document.getElementById('party-server-toggle');

		let fallback = NetworkClient.defaultUrl();
		let local = NetworkClient.LOCAL_URL;
		let stored = NetworkClient.loadUrl();

		let presets: { value: string, label: string, url: string }[] = [
			{ value: 'default', label: 'Default', url: fallback }
		];

		if (local !== fallback) presets.push({ value: 'local', label: 'This machine', url: local });
		presets.push({ value: 'custom', label: 'Other', url: '' });

		presets.forEach((preset) =>
		{
			let option = document.createElement('option');
			option.value = preset.value;
			option.textContent = preset.url.length > 0 ? preset.label + ' \u2014 ' + preset.url : preset.label + '\u2026';
			choice.appendChild(option);
		});

		let show = (url: string) =>
		{
			input.value = url;
			current.textContent = url;
			current.title = url;
		};

		let matching = presets.filter((preset) => preset.url === stored)[0];
		choice.value = matching !== undefined ? matching.value : 'custom';
		input.style.display = choice.value === 'custom' ? 'block' : 'none';
		show(stored);

		choice.addEventListener('change', () =>
		{
			let picked = presets.filter((preset) => preset.value === choice.value)[0];
			let custom = choice.value === 'custom';

			input.style.display = custom ? 'block' : 'none';

			if (custom) input.focus();
			else show(picked.url);
		}, false);

		input.addEventListener('input', () =>
		{
			current.textContent = input.value;
			current.title = input.value;
		}, false);

		toggle.addEventListener('click', () =>
		{
			let open = panel.classList.toggle('open');
			toggle.textContent = open ? 'Done' : 'Change';
		}, false);
	}

	/** Where accounts live: always the game's own relay, whichever server a party is on. */
	private static accountServer(): string
	{
		return NetworkClient.defaultUrl();
	}

	/** Signed in the way this server needs, or it needs nothing. */
	private static mayPlay(): boolean
	{
		if (PartyMenu.required === undefined || PartyMenu.resuming) return false;
		if (!PartyMenu.required) return true;
		return Account.signedIn && Account.profile.google === true;
	}

	/** Play, host and join, usable or greyed out to match. */
	private static updateGate(): void
	{
		let open = PartyMenu.mayPlay() && !PartyMenu.connecting;
		let confirm = Swal.getConfirmButton() as HTMLButtonElement;
		if (confirm !== null && confirm !== undefined) confirm.disabled = !open;

		for (const id of ['party-host', 'party-join'])
		{
			let button = document.getElementById(id);
			if (button === null) continue;
			if (open) button.removeAttribute('disabled');
			else button.setAttribute('disabled', 'disabled');
		}
	}

	/** Served from this machine, where the game is being worked on and a relay may not be running. */
	private static isLocalPage(): boolean
	{
		let host = window.location.hostname;
		return host === '' || host === 'localhost' || host === '127.0.0.1';
	}

	/**
	 * Asks the relay whether it has Google sign-in, which makes it required.
	 * A relay that can't be reached is asked again until it answers: playing
	 * without the sign-in it may want isn't an option. Except on this machine,
	 * where nobody should need a relay running to try a change.
	 */
	private static checkRequired(render: () => void, status: HTMLElement, answered: () => void): void
	{
		let settle = (google: string) =>
		{
			PartyMenu.googleClientId = google;
			PartyMenu.required = google !== undefined;
			if (status.dataset.unreachable === '1')
			{
				status.textContent = '';
				status.className = 'party-status';
				delete status.dataset.unreachable;
			}
			answered();
			render();
		};

		Account.config(PartyMenu.accountServer()).then((config) => settle(config.google))
		.catch((error) =>
		{
			// The relay itself said no, rather than not answering: one older than
			// this, or without accounts. Nothing to sign in to, so nothing to wait for.
			// A gateway's error page for a relay that's down isn't the relay talking
			let spoke = error.body !== undefined && typeof error.body.error === 'string';
			if (spoke || PartyMenu.isLocalPage())
			{
				settle(undefined);
				return;
			}
			status.textContent = 'Can’t reach the sign-in server. Trying again…';
			status.className = 'party-status party-status-error';
			status.dataset.unreachable = '1';
			PartyMenu.retryTimer = window.setTimeout(() =>
			{
				if (PartyMenu.showing) PartyMenu.checkRequired(render, status, answered);
			}, PartyMenu.RETRY_MS);
		});
	}

	/**
	 * The account: signed in or not, and how to be. With Google required
	 * that's its button and nothing else, apart from a way for somebody who
	 * made an account with a password before to sign in to it once and put
	 * Google on it. Without Google it's names and passwords, and optional.
	 */
	private static bindAccount(identity: PlayerIdentity): void
	{
		let current = document.getElementById('party-account-current');
		let toggle = document.getElementById('party-account-toggle');
		let panel = document.getElementById('party-account-panel');
		let older = document.getElementById('party-account-old');
		let register = document.getElementById('party-account-register');
		let status = document.getElementById('party-account-status');
		let note = document.getElementById('party-account-note');
		let name = document.getElementById('party-account-name') as HTMLInputElement;
		let password = document.getElementById('party-account-password') as HTMLInputElement;

		let render = () =>
		{
			let required = PartyMenu.required;

			if (move.style.display !== 'none' && (!Account.signedIn || Account.profile.id !== offeredTo))
			{
				move.style.display = 'none';
				status.textContent = '';
				status.className = 'party-status';
			}

			if (required === undefined || PartyMenu.resuming)
			{
				current.textContent = 'Checking…';
				toggle.style.display = 'none';
				older.style.display = 'none';
				note.textContent = '';
				panel.classList.remove('open');
			}
			else if (Account.signedIn)
			{
				let profile = Account.profile;
				current.textContent = profile.username + ' — ' + profile.kills + ' kills, ' + profile.deaths + ' deaths';
				toggle.style.display = '';
				toggle.textContent = 'Sign out';
				older.style.display = 'none';
				panel.classList.remove('open');
				note.textContent = required && profile.google !== true
					? 'One more step: add Google to this account to play. Everything on it stays.'
					: 'Your money, guns, cars and level are kept on this account.';
			}
			else
			{
				current.textContent = 'Not signed in';
				toggle.style.display = required ? 'none' : '';
				toggle.textContent = 'Sign in';
				older.style.display = required ? '' : 'none';
				register.style.display = required ? 'none' : '';
				note.textContent = required
					? 'Sign in with Google to play. Your money, guns, cars and level are kept on your account, on any device.'
					: 'Sign in to keep your money, guns, cars and level on any device.';
			}

			PartyMenu.showGoogle(attempt, fail);
			PartyMenu.updateGate();
		};

		let move = document.getElementById('party-account-move');
		move.style.display = 'none';
		// Who the offer on screen was made to, so signing out or in takes it away
		let offeredTo: number;

		let fail = (error: Error) =>
		{
			status.textContent = error.message;
			status.className = 'party-status party-status-error';
		};

		let succeed = () =>
		{
			status.textContent = '';
			status.className = 'party-status';
			password.value = '';

			// A default name is worth replacing with the one they just signed in as
			let nameField = document.getElementById('party-name') as HTMLInputElement;
			if (nameField.value === 'Player') nameField.value = Account.profile.username;

			render();
		};

		let attempt = (action: () => Promise<any>) =>
		{
			status.textContent = 'Talking to the server…';
			status.className = 'party-status';
			move.style.display = 'none';
			action().then((result) =>
			{
				// Nothing came back: an offer is on screen, waiting on them
				if (result === undefined && move.style.display !== 'none') return;
				succeed();
			}).catch((error) =>
			{
				fail(error);
				render();
			});
		};

		// Google already has a player of its own for this person: offered to
		// move it here, saying plainly what happens to that one
		PartyMenu.offerMove = (holder: string, confirm: () => void) =>
		{
			offeredTo = Account.profile.id;
			move.textContent = 'Move Google to ' + Account.profile.username;
			move.style.display = '';
			move.onclick = () =>
			{
				move.style.display = 'none';
				confirm();
			};
			status.textContent = 'That Google account already has a player of its own, ' + holder
				+ '. Moving Google here leaves ' + holder + ' with no way in.';
			status.className = 'party-status party-status-error';
		};

		// Asked for again, with the name already in: the session was too old to put Google on
		PartyMenu.passwordAgain = (username: string) =>
		{
			name.value = username;
			password.value = '';
			panel.classList.add('open');
			password.focus();
		};

		// Quietly pick a previous session back up, if the server still honours it
		let resume = () =>
		{
			if (Account.signedIn || PartyMenu.resuming || Account.loadToken() === undefined) return;
			PartyMenu.resuming = true;
			Account.resume(PartyMenu.accountServer())
				.catch(() => undefined)
				.then(() =>
				{
					PartyMenu.resuming = false;
					render();
				});
		};
		resume();
		render();
		// Once more when the relay answers, in case it hadn't the first time
		PartyMenu.checkRequired(render, status, resume);

		toggle.addEventListener('click', () =>
		{
			if (Account.signedIn)
			{
				Account.signOut();
				render();
				return;
			}

			panel.classList.toggle('open');
		}, false);

		older.addEventListener('click', () =>
		{
			if (panel.classList.toggle('open')) name.focus();
		}, false);

		document.getElementById('party-account-login').addEventListener('click', () =>
		{
			attempt(() => Account.login(PartyMenu.accountServer(), name.value, password.value));
		}, false);

		register.addEventListener('click', () =>
		{
			attempt(() => Account.register(PartyMenu.accountServer(), name.value, password.value));
		}, false);
	}

	private static passwordAgain: (username: string) => void;
	private static offerMove: (holder: string, confirm: () => void) => void;
	private static googleScript: Promise<void>;
	private static googleClient: string;
	private static googleMode: { link: boolean, user: number } = { link: false, user: undefined };

	/**
	 * Google's answer, used for what its button was shown for: adding Google
	 * to the account that was signed in then, or signing in. If the page has
	 * changed hands since, it's refused rather than guessed at.
	 */
	private static googleAnswered(credential: string, server: string, attempt: (action: () => Promise<any>) => void): void
	{
		let mode = PartyMenu.googleMode;
		let current = Account.signedIn ? Account.profile.id : undefined;
		if (mode.link ? current !== mode.user : current !== undefined)
		{
			attempt(() => Promise.reject(new Error('Signed in or out in the meantime: try the Google button again.')));
			return;
		}
		PartyMenu.sendGoogle(credential, server, attempt, mode, false);
	}

	/** Sends Google's answer, and deals with the two ways putting it on an account can be turned down. */
	private static sendGoogle(credential: string, server: string, attempt: (action: () => Promise<any>) => void,
		mode: { link: boolean, user: number }, move: boolean): void
	{
		attempt(() => Account.google(server, credential, mode.link, move).catch((error) =>
		{
			let body = error.body !== undefined ? error.body : {};

			// Too long since the password went in to trust this browser with
			// the account: once more, and then Google again
			if (mode.link && body.signInAgain === true && Account.signedIn)
			{
				let username = Account.profile.username;
				Account.signOut();
				if (PartyMenu.passwordAgain !== undefined) PartyMenu.passwordAgain(username);
				throw new Error('Sign in with your password once more, then add Google.');
			}

			// Pressed Google before signing in with the password, most likely,
			// and got a new player for it: that can be undone, if they say so
			let stillThem = Account.signedIn && Account.profile.id === mode.user;
			if (mode.link && !move && stillThem && body.canMove === true && typeof body.holder === 'string' && PartyMenu.offerMove !== undefined)
			{
				PartyMenu.offerMove(body.holder, () =>
				{
					let current = Account.signedIn ? Account.profile.id : undefined;
					if (current !== mode.user) return;
					PartyMenu.sendGoogle(credential, server, attempt, mode, true);
				});
				// Left as the offer says it, rather than written over
				return undefined;
			}
			throw error;
		}));
	}

	/** Google's sign-in script, fetched the first time a server offers Google. */
	private static loadGoogle(): Promise<void>
	{
		if (PartyMenu.googleScript === undefined)
		{
			PartyMenu.googleScript = new Promise((resolve, reject) =>
			{
				let script = document.createElement('script');
				script.src = 'https://accounts.google.com/gsi/client';
				script.async = true;
				script.onload = () => resolve();
				script.onerror = () =>
				{
					PartyMenu.googleScript = undefined;
					reject(new Error('Google sign-in could not load. Check the connection and reload the page.'));
				};
				document.head.appendChild(script);
			});
		}
		return PartyMenu.googleScript;
	}

	/**
	 * Google's button, where it belongs: under the account for somebody signed
	 * out, to sign in, and for somebody signed in without it, to put it on
	 * their account. Nothing at all while the relay is still being asked, or
	 * if it has no Google.
	 */
	private static showGoogle(attempt: (action: () => Promise<any>) => void, fail: (error: Error) => void): void
	{
		let signIn = document.getElementById('party-google');
		let link = document.getElementById('party-google-link');
		// Worked out again once the script is in: things may have moved on by then
		let wanted = () =>
		{
			let ready = PartyMenu.googleClientId !== undefined && PartyMenu.required !== undefined && !PartyMenu.resuming;
			let linking = Account.signedIn && Account.profile.google !== true;
			return { signIn: ready && !Account.signedIn, link: ready && linking };
		};

		let want = wanted();
		signIn.style.display = want.signIn ? '' : 'none';
		link.style.display = want.link ? '' : 'none';
		if (!want.signIn && !want.link) return;

		let server = PartyMenu.accountServer();
		let client = PartyMenu.googleClientId;
		PartyMenu.loadGoogle().then(() =>
		{
			let now = wanted();
			if (!now.signIn && !now.link) return;

			let api = (window as any).google.accounts.id;
			if (PartyMenu.googleClient !== client)
			{
				PartyMenu.googleClient = client;
				api.initialize({
					client_id: client,
					callback: (response: any) => PartyMenu.googleAnswered(response.credential, server, attempt),
					auto_select: false,
					cancel_on_tap_outside: true
				});
			}
			// What the button on screen was made to do, and for whom
			PartyMenu.googleMode = now.link ? { link: true, user: Account.profile.id } : { link: false, user: undefined };
			let target = now.link ? link : signIn;
			let mode = now.link ? 'link' : 'in';
			if (target.childElementCount > 0 && target.dataset.mode === mode) return;
			target.innerHTML = '';
			target.dataset.mode = mode;
			// In the game's language, not the browser's
			api.renderButton(target, { theme: 'outline', size: 'large', shape: 'pill', text: now.link ? 'continue_with' : 'signin_with', width: 260, locale: 'en' });
		})
		.catch((error) => fail(error));
	}

	private static commitIdentity(identity: PlayerIdentity): void
	{
		let nameInput = document.getElementById('party-name') as HTMLInputElement;
		identity.set(nameInput.value, PartyMenu.selectedColor(), PartyMenu.selectedHat());
		identity.save();
	}

	private static serverUrl(): string
	{
		let value = (document.getElementById('party-server') as HTMLInputElement).value.trim();
		return value.length > 0 ? value : NetworkClient.defaultUrl();
	}

	private static bindSwatches(): void
	{
		PartyMenu.bindPicker('.party-swatch');
		PartyMenu.bindPicker('.party-hat');
	}

	/** One of a row is chosen at a time, and a locked one is never chosen. */
	private static bindPicker(selector: string): void
	{
		let options = document.querySelectorAll(selector);

		for (let i = 0; i < options.length; i++)
		{
			options[i].addEventListener('click', (event) =>
			{
				let picked = event.currentTarget as HTMLElement;
				if (picked.classList.contains('locked')) return;

				for (let j = 0; j < options.length; j++) options[j].classList.remove('selected');

				picked.classList.add('selected');
			}, false);
		}
	}

	private static unlockLabel(entry: Unlock, locked: boolean): string
	{
		return locked ? entry.label + ' \u00b7 ' + entry.kills + ' kills' : entry.label;
	}

	private static selectedColor(): string
	{
		let selected = document.querySelector('.party-swatch.selected') as HTMLElement;
		return selected !== null ? selected.getAttribute('data-color') : undefined;
	}

	private static selectedHat(): string
	{
		let selected = document.querySelector('.party-hat.selected') as HTMLElement;
		return selected !== null ? selected.getAttribute('data-hat') : 'none';
	}

	/** Names end up in innerHTML, so they can't be trusted verbatim. */
	private static escape(text: string): string
	{
		let div = document.createElement('div');
		div.appendChild(document.createTextNode(text));
		return div.innerHTML.replace(/"/g, '&quot;');
	}
}
