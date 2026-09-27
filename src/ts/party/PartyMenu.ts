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
 * The dialog shown once the world has loaded. Picks the player's name and
 * colour, and optionally starts or joins a party before the game begins.
 */
export class PartyMenu
{
	public static show(options: PartyMenuOptions): void
	{
		let entered = false;

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
				PartyMenu.bindSwatches();
				PartyMenu.bindServerPicker();
				PartyMenu.bindAccount(options.identity);
				PartyMenu.bindPartyButtons(options, () => { entered = true; });
			},
			preConfirm: () =>
			{
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
			+ '<label class="party-label" for="party-name">Your name</label>'
			+ '<input id="party-name" class="party-input" maxlength="16" spellcheck="false"'
			+ ' value="' + PartyMenu.escape(identity.name) + '">'
			+ '<label class="party-label">Your colour</label>'
			+ '<div id="party-colors" class="party-colors">' + swatches + '</div>'
			+ '<label class="party-label">Your hat</label>'
			+ '<div id="party-hats" class="party-hats">' + hats + '</div>'
			+ '<div class="party-divider"><span>account</span></div>'
			+ '<div class="party-server-line">'
			+ '<span class="party-server-label">Account</span>'
			+ '<span id="party-account-current" class="party-server-current">Not signed in</span>'
			+ '<button type="button" id="party-account-toggle" class="party-server-change">Sign in</button>'
			+ '</div>'
			+ '<div id="party-account-note" class="party-account-note"></div>'
			+ '<div id="party-google-link" class="party-google"></div>'
			+ '<div id="party-account-panel" class="party-server-panel">'
			+ '<div id="party-google" class="party-google"></div>'
			+ '<div id="party-google-or" class="party-account-or">or with a name and password</div>'
			+ '<input id="party-account-name" class="party-input" maxlength="16" spellcheck="false" placeholder="Name">'
			+ '<input id="party-account-password" class="party-input" type="password" placeholder="Password">'
			+ '<div class="party-row">'
			+ '<button type="button" id="party-account-login" class="party-button">Sign in</button>'
			+ '<button type="button" id="party-account-register" class="party-button">Create account</button>'
			+ '</div>'
			+ '<div id="party-account-status" class="party-status"></div>'
			+ '</div>'
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
			PartyMenu.commitIdentity(options.identity);

			host.setAttribute('disabled', 'disabled');
			join.setAttribute('disabled', 'disabled');
			status.textContent = 'Connecting…';
			status.className = 'party-status';

			action().then(() =>
			{
				markEntered();
				Swal.close();
				options.onPlay();
			})
			.catch((error) =>
			{
				host.removeAttribute('disabled');
				join.removeAttribute('disabled');
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

	/**
	 * Signing in is optional: the party works without it. What it buys is having
	 * kills counted against a name that persists, which is what a leaderboard
	 * will be built on.
	 */
	private static bindAccount(identity: PlayerIdentity): void
	{
		let line = document.getElementById('party-account-current');
		let toggle = document.getElementById('party-account-toggle');
		let panel = document.getElementById('party-account-panel');
		let status = document.getElementById('party-account-status');
		let name = document.getElementById('party-account-name') as HTMLInputElement;
		let password = document.getElementById('party-account-password') as HTMLInputElement;

		let note = document.getElementById('party-account-note');
		let render = () =>
		{
			if (Account.signedIn)
			{
				let profile = Account.profile;
				line.textContent = profile.username + ' \u2014 ' + profile.kills + ' kills, ' + profile.deaths + ' deaths';
				toggle.textContent = 'Sign out';
				panel.classList.remove('open');
				note.textContent = 'Your money, guns, cars and level are kept on this account.';
			}
			else
			{
				line.textContent = 'Not signed in';
				toggle.textContent = 'Sign in';
				note.textContent = 'Sign in to keep your money, guns, cars and level on any device.';
			}
			PartyMenu.showGoogle(panel.classList.contains('open'), attempt);
		};

		let fail = (error: Error) =>
		{
			status.textContent = error.message;
			status.className = 'party-status party-status-error';
		};

		let succeed = () =>
		{
			status.textContent = '';
			password.value = '';

			// A default name is worth replacing with the one they just signed in as
			let nameField = document.getElementById('party-name') as HTMLInputElement;
			if (nameField.value === 'Player') nameField.value = Account.profile.username;

			render();
		};

		let attempt = (action: () => Promise<any>) =>
		{
			status.textContent = 'Talking to the server\u2026';
			status.className = 'party-status';
			action().then(succeed).catch(fail);
		};

		render();

		// Quietly pick a previous session back up, if the server still honours it
		Account.resume(PartyMenu.serverUrl()).then(render).catch(() => undefined);

		toggle.addEventListener('click', () =>
		{
			if (Account.signedIn)
			{
				Account.signOut();
				render();
				return;
			}

			panel.classList.toggle('open');
			PartyMenu.showGoogle(panel.classList.contains('open'), attempt);
		}, false);

		document.getElementById('party-account-login').addEventListener('click', () =>
		{
			attempt(() => Account.login(PartyMenu.serverUrl(), name.value, password.value));
		}, false);

		document.getElementById('party-account-register').addEventListener('click', () =>
		{
			attempt(() => Account.register(PartyMenu.serverUrl(), name.value, password.value));
		}, false);
	}

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
		attempt(() => Account.google(server, credential, mode.link));
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
					reject(new Error('Google sign-in could not load.'));
				};
				document.head.appendChild(script);
			});
		}
		return PartyMenu.googleScript;
	}

	/**
	 * Google's button, where it belongs: in the sign-in panel for somebody
	 * signed out, and under the account for somebody signed in without it,
	 * to put it on their account. Nothing at all if the server has no Google.
	 */
	private static showGoogle(panelOpen: boolean, attempt: (action: () => Promise<any>) => void): void
	{
		let signIn = document.getElementById('party-google');
		let link = document.getElementById('party-google-link');
		let or = document.getElementById('party-google-or');
		let hide = () =>
		{
			signIn.style.display = 'none';
			link.style.display = 'none';
			or.style.display = 'none';
		};
		let server = PartyMenu.serverUrl();
		// Only on this game's own relay. A Google sign-in is good on any relay
		// with the same client id, so one handed to a relay typed into the box
		// could be passed on and used here: those get names and passwords
		if (Account.httpBase(server) !== Account.httpBase(NetworkClient.defaultUrl()))
		{
			hide();
			return;
		}
		Account.config(server).then((config) =>
		{
			if (config.google === undefined)
			{
				hide();
				return;
			}
			return PartyMenu.loadGoogle().then(() =>
			{
				let api = (window as any).google.accounts.id;
				if (PartyMenu.googleClient !== config.google)
				{
					PartyMenu.googleClient = config.google;
					api.initialize({
						client_id: config.google,
						callback: (response: any) => PartyMenu.googleAnswered(response.credential, server, attempt),
						auto_select: false,
						cancel_on_tap_outside: true
					});
				}
				let linking = Account.signedIn && Account.profile.google !== true;
				// What the button on screen was made to do, and for whom
				PartyMenu.googleMode = linking ? { link: true, user: Account.profile.id } : { link: false, user: undefined };
				let target = Account.signedIn ? (linking ? link : undefined) : (panelOpen ? signIn : undefined);
				signIn.style.display = !Account.signedIn && panelOpen ? '' : 'none';
				or.style.display = signIn.style.display;
				link.style.display = linking ? '' : 'none';
				if (target === undefined || target.childElementCount > 0 && target.dataset.mode === (linking ? 'link' : 'in')) return;
				target.innerHTML = '';
				target.dataset.mode = linking ? 'link' : 'in';
				// In the game's language, not the browser's
				api.renderButton(target, { theme: 'outline', size: 'large', shape: 'pill', text: linking ? 'continue_with' : 'signin_with', width: 260, locale: 'en' });
			});
		}).catch(() => hide());
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
