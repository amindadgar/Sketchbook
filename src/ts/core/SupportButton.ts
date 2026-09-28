import { onTap } from './Tap';
import { Pointer } from './Pointer';
import { GameInfo } from './GameInfo';
import { InputManager } from './InputManager';

/**
 * Top left, where the GitHub corner used to be: a heart that opens a card
 * with the code and the ways to donate. Esc or a click anywhere else puts it
 * away. With the mouse held by the game it can't be clicked, but the pause
 * menu has the same card.
 */
export class SupportButton
{
	private button: HTMLElement;
	private card: HTMLElement;
	private body: HTMLElement;

	constructor()
	{
		this.button = document.getElementById('support-button');
		this.build();

		onTap(this.button, () => this.toggle());

		document.addEventListener('keydown', (event) =>
		{
			// The chat's own Esc, while it's being typed in, is the chat's
			if (!this.isOpen || event.code !== 'Escape' || InputManager.isTyping(event)) return;
			this.close();
			// Putting the card away is all this Esc does: not a pause, and not
			// closing the phone or a shop as well
			event.stopImmediatePropagation();
		}, true);

		// A press anywhere else puts it away
		let outside = (event: Event) =>
		{
			if (!this.isOpen) return;
			let target = event.target as Node;
			if (this.card.contains(target) || this.button.contains(target)) return;
			this.close();
		};
		document.addEventListener('mousedown', outside, true);
		document.addEventListener('touchstart', outside, true);
	}

	public get isOpen(): boolean
	{
		return this.card.style.display !== 'none';
	}

	public open(): void
	{
		GameInfo.renderSupport(this.body);
		this.card.style.display = '';
		this.button.classList.add('open');
		// Links and copy buttons want the mouse
		Pointer.release();
	}

	public close(): void
	{
		this.card.style.display = 'none';
		this.button.classList.remove('open');
	}

	public toggle(): void
	{
		if (this.isOpen) this.close();
		else this.open();
	}

	private build(): void
	{
		let card = document.createElement('div');
		card.id = 'support-card';
		card.style.display = 'none';
		card.innerHTML = '<div class="support-head"><span class="support-title">Support Sketchbook</span>'
			+ '<span class="support-close">×</span></div><div class="support-body"></div>';
		this.body = card.querySelector('.support-body');
		onTap(card.querySelector('.support-close') as HTMLElement, () => this.close());

		// Clicking the card isn't clicking the game behind it
		for (const type of ['mousedown', 'click', 'touchstart', 'wheel'])
		{
			card.addEventListener(type, (event) => event.stopPropagation());
		}

		document.getElementById('ui-container').appendChild(card);
		this.card = card;
	}
}
