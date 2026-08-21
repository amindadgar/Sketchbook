import Swal from 'sweetalert2';

import { PlayerIdentity } from './PlayerIdentity';
import { NetworkClient } from './NetworkClient';
import { Account } from './Account';

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
			footer: '<a href="https://github.com/amindadgar/Sketchbook" target="_blank">GitHub page</a>',
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
		let swatches = PlayerIdentity.PALETTE.map((color) =>
		{
			let selected = color.toLowerCase() === identity.color.toLowerCase() ? ' selected' : '';
			return '<button type="button" class="party-swatch' + selected + '"'
				+ ' data-color="' + color + '" style="background: ' + color + ';"></button>';
		}).join('');

		return '<p class="party-intro">Explore the world and hop into any vehicle.'
			+ ' Scenarios are in the right hand panel.</p>'
			+ '<label class="party-label" for="party-name">Your name</label>'
			+ '<input id="party-name" class="party-input" maxlength="16" spellcheck="false"'
			+ ' value="' + PartyMenu.escape(identity.name) + '">'
			+ '<label class="party-label">Your colour</label>'
			+ '<div id="party-colors" class="party-colors">' + swatches + '</div>'
			+ '<div class="party-divider"><span>account</span></div>'
			+ '<div class="party-server-line">'
			+ '<span class="party-server-label">Account</span>'
			+ '<span id="party-account-current" class="party-server-current">Not signed in</span>'
			+ '<button type="button" id="party-account-toggle" class="party-server-change">Sign in</button>'
			+ '</div>'
			+ '<div id="party-account-panel" class="party-server-panel">'
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

		let render = () =>
		{
			if (Account.signedIn)
			{
				let profile = Account.profile;
				line.textContent = profile.username + ' \u2014 ' + profile.kills + ' kills, ' + profile.deaths + ' deaths';
				toggle.textContent = 'Sign out';
				panel.classList.remove('open');
			}
			else
			{
				line.textContent = 'Not signed in';
				toggle.textContent = 'Sign in';
			}
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

	private static commitIdentity(identity: PlayerIdentity): void
	{
		let nameInput = document.getElementById('party-name') as HTMLInputElement;
		identity.set(nameInput.value, PartyMenu.selectedColor());
		identity.save();
	}

	private static serverUrl(): string
	{
		let value = (document.getElementById('party-server') as HTMLInputElement).value.trim();
		return value.length > 0 ? value : NetworkClient.defaultUrl();
	}

	private static bindSwatches(): void
	{
		let swatches = document.querySelectorAll('.party-swatch');

		for (let i = 0; i < swatches.length; i++)
		{
			swatches[i].addEventListener('click', (event) =>
			{
				for (let j = 0; j < swatches.length; j++)
				{
					swatches[j].classList.remove('selected');
				}

				(event.currentTarget as HTMLElement).classList.add('selected');
			}, false);
		}
	}

	private static selectedColor(): string
	{
		let selected = document.querySelector('.party-swatch.selected') as HTMLElement;
		return selected !== null ? selected.getAttribute('data-color') : undefined;
	}

	/** Names end up in innerHTML, so they can't be trusted verbatim. */
	private static escape(text: string): string
	{
		let div = document.createElement('div');
		div.appendChild(document.createTextNode(text));
		return div.innerHTML.replace(/"/g, '&quot;');
	}
}
