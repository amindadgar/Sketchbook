import Swal from 'sweetalert2';

import { PlayerIdentity } from './PlayerIdentity';

/**
 * The dialog shown once the world has loaded, where the player picks the name
 * and colour their character, their car and their name tag will use.
 */
export class PartyMenu
{
	public static show(identity: PlayerIdentity, onPlay: () => void): void
	{
		Swal.fire({
			title: 'Welcome to Sketchbook!',
			html: PartyMenu.buildHtml(identity),
			confirmButtonText: 'Play',
			buttonsStyling: false,
			footer: '<a href="https://github.com/swift502/Sketchbook" target="_blank">GitHub page</a>',
			onBeforeOpen: () =>
			{
				PartyMenu.bindSwatches();
			},
			preConfirm: () =>
			{
				let nameInput = document.getElementById('party-name') as HTMLInputElement;
				identity.set(nameInput.value, PartyMenu.selectedColor());
				identity.save();
				return true;
			},
			onClose: () =>
			{
				onPlay();
			}
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
			+ '<div id="party-colors" class="party-colors">' + swatches + '</div>';
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
