import { UIManager } from '../core/UIManager';
import { World } from '../world/World';

/**
 * Party chat: a log that fades out and a line you type into.
 *
 * The game reads the keyboard off the document, so while the box has focus
 * every key has to be kept away from it, or saying hello walks the character
 * into the sea. That's what the typing flag is for.
 */
export class Chat
{
	private static readonly HISTORY: number = 6;
	/** How long a line stays on screen once nobody is typing. */
	private static readonly LINGER: number = 9;

	private world: World;
	private input: HTMLInputElement;
	private log: HTMLElement;
	private open: boolean = false;
	private visible: boolean = false;
	private linger: number = 0;

	constructor(world: World)
	{
		this.world = world;
		this.input = document.getElementById('chat-input') as HTMLInputElement;
		this.log = document.getElementById('chat-log');

		this.input.addEventListener('keydown', (event) => this.onInputKey(event), false);
		this.input.addEventListener('blur', () => this.close(), false);

		document.getElementById('chat-open').addEventListener('touchstart', (event) =>
		{
			event.preventDefault();
			event.stopPropagation();
			this.begin();
		}, { passive: false });
	}

	/** True while the box has focus, which is when the game must ignore the keys. */
	public get typing(): boolean
	{
		return this.open;
	}

	public get available(): boolean
	{
		return this.world.party.active;
	}

	public begin(): void
	{
		if (!this.available || this.open) return;

		this.open = true;
		this.linger = Chat.LINGER;
		document.body.classList.add('chatting');
		this.input.value = '';
		this.input.focus();
	}

	public close(): void
	{
		if (!this.open) return;

		this.open = false;
		document.body.classList.remove('chatting');
		this.input.blur();
	}

	public update(unscaledTimeStep: number): void
	{
		// There's nobody to talk to outside a party
		let wanted = this.available;
		if (wanted !== this.visible)
		{
			this.visible = wanted;
			UIManager.setChatVisible(wanted);
			if (!wanted) this.close();
		}

		if (this.open)
		{
			this.linger = Chat.LINGER;
			return;
		}

		if (this.linger <= 0) return;

		this.linger -= unscaledTimeStep;
		if (this.linger <= 0) this.log.classList.add('faded');
	}

	/** Somebody said something, including this player. */
	public receive(name: string, color: string, text: string): void
	{
		UIManager.addChatLine(name, color, text, Chat.HISTORY);

		this.log.classList.remove('faded');
		this.linger = Chat.LINGER;
	}

	private onInputKey(event: KeyboardEvent): void
	{
		// Never reaches the game: the document listener would read it as movement
		event.stopPropagation();

		if (event.code === 'Escape')
		{
			this.close();
			return;
		}

		if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;

		let text = this.input.value.trim();
		this.input.value = '';

		if (text.length > 0) this.world.party.publishChat(text);

		this.close();
	}
}
