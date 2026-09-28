import { World } from '../world/World';
import { onTap } from './Tap';
import { Panel } from './Panel';
import { Pointer } from './Pointer';
import { UIManager } from './UIManager';
import { GameInfo } from './GameInfo';
import { Phone } from './Phone';
import { Wallet } from '../progress/Wallet';
import { InputManager } from './InputManager';
import { IUpdatable } from '../interfaces/IUpdatable';

interface PauseItem
{
	label: string;
	/** What's shown beside the list while this is picked. */
	pane: (into: HTMLElement) => void;
	/** Enter, or a click: what it does, if it does more than show its pane. */
	action?: () => void;
}

/**
 * Esc. Playing alone, the world stands still and goes quiet until it's
 * resumed; in a party it can't, so it says so and carries on underneath.
 *
 * With the mouse held by the game, the browser keeps Esc for itself and only
 * lets go of the mouse, so that's what opens this: see InputManager.
 */
export class PauseMenu implements IUpdatable
{
	public updateOrder: number = 31;

	private world: World;
	private root: HTMLElement;
	private list: HTMLElement;
	private pane: HTMLElement;
	private state: HTMLElement;
	private who: HTMLElement;
	private items: PauseItem[];
	private index: number = 0;
	/** This pause stopped the world, and it's to be started again after. */
	private froze: boolean = false;

	constructor(world: World)
	{
		this.world = world;
		this.items = this.makeItems();
		this.build();
		document.addEventListener('keydown', (event) => this.onKey(event), true);
		world.registerUpdatable(this);
	}

	/** Only runs in a party, where the world doesn't stop: a scenario loading takes the screen it's on. */
	public update(timeStep: number, unscaledTimeStep: number): void
	{
		if (this.isOpen && !UIManager.isUserInterfaceVisible()) this.close();
	}

	public get isOpen(): boolean
	{
		return this.root.classList.contains('open');
	}

	/** Whether the world is standing still for it. */
	public get freezes(): boolean
	{
		return this.isOpen && this.froze;
	}

	public open(): void
	{
		if (this.isOpen || !UIManager.isUserInterfaceVisible()) return;

		if (this.world.phone !== undefined) this.world.phone.close();
		if (this.world.support !== undefined) this.world.support.close();
		Panel.close();
		this.releaseControls();
		Pointer.release();

		// A settings box clicked a moment ago still has the keys; the menu wants them
		let focused = document.activeElement as HTMLElement;
		if (focused !== null && focused !== document.body && typeof focused.blur === 'function') focused.blur();

		this.froze = this.world.party === undefined || !this.world.party.active;
		if (this.froze) this.world.audioListener.context.suspend().catch(() => undefined);

		this.index = 0;
		this.state.textContent = this.froze ? 'Paused' : 'Paused. The party carries on without you';
		this.who.textContent = this.world.localPlayer.name + '   $' + Wallet.format(this.world.wallet.cash)
			+ '   ' + Phone.timeOfDay(this.world);
		this.draw();
		this.root.classList.add('open');
		document.body.classList.add('paused');
	}

	public close(): void
	{
		if (!this.isOpen) return;
		this.root.classList.remove('open');
		document.body.classList.remove('paused');
		if (this.froze) this.world.audioListener.context.resume().catch(() => undefined);
		this.froze = false;
	}

	public toggle(): void
	{
		if (this.isOpen) this.close();
		else this.open();
	}

	/**
	 * Whatever was held when it opened lets go: the key that let go of it will
	 * go to the menu, so without this the player walks on after resuming.
	 */
	private releaseControls(): void
	{
		let receiver: any = this.world.inputManager !== undefined ? this.world.inputManager.inputReceiver : undefined;
		if (receiver === undefined || receiver === null) return;
		if (typeof receiver.resetControls === 'function') receiver.resetControls();
		let controlled = receiver.controlledObject;
		if (controlled !== undefined && controlled !== null && typeof controlled.resetControls === 'function') controlled.resetControls();
	}

	private makeItems(): PauseItem[]
	{
		let text = (words: string) => (into: HTMLElement) =>
		{
			let line = document.createElement('p');
			line.className = 'info-text';
			line.textContent = words;
			into.appendChild(line);
		};

		return [
			{ label: 'Resume', pane: text('Back to the game.'), action: () => this.close() },
			{ label: 'Map', pane: text('The whole city, and where everyone is.'), action: () =>
				{
					this.close();
					if (this.world.minimap !== undefined) this.world.minimap.setExpanded(true);
				} },
			{ label: 'Stats', pane: (into) => GameInfo.renderStats(into, this.world) },
			{ label: 'Controls', pane: (into) => GameInfo.renderControls(into, this.world) },
			{ label: 'Settings', pane: text('Graphics, sound and the camera. They open on the right as the game carries on.'), action: () =>
				{
					this.close();
					UIManager.showSettings(true);
				} },
			{ label: 'Support the game', pane: (into) => GameInfo.renderSupport(into) },
		];
	}

	private draw(): void
	{
		for (let i = 0; i < this.list.children.length; i++)
		{
			this.list.children[i].classList.toggle('selected', i === this.index);
		}
		while (this.pane.firstChild !== null) this.pane.removeChild(this.pane.firstChild);
		this.items[this.index].pane(this.pane);
		this.pane.scrollTop = 0;
	}

	private pick(index: number): void
	{
		this.index = (index + this.items.length) % this.items.length;
		this.draw();
	}

	private onKey(event: KeyboardEvent): void
	{
		if (!this.isOpen || InputManager.isTyping(event)) return;

		switch (event.code)
		{
			case 'ArrowUp':
			case 'KeyW':
				this.pick(this.index - 1);
				break;
			case 'ArrowDown':
			case 'KeyS':
				this.pick(this.index + 1);
				break;
			case 'Enter':
			case 'NumpadEnter':
			case 'Space':
				if (!event.repeat && this.items[this.index].action !== undefined) this.items[this.index].action();
				break;
			case 'Escape':
			case 'Backspace':
				if (!event.repeat) this.close();
				break;
			default:
				// Nothing else reaches the game while it's paused
				event.stopPropagation();
				return;
		}
		event.preventDefault();
		event.stopPropagation();
	}

	private build(): void
	{
		let root = document.createElement('div');
		root.id = 'pause-menu';
		root.innerHTML = '<div class="pause-frame">'
			+ '<div class="pause-head"><span class="pause-game">Sketchbook</span><span class="pause-who"></span></div>'
			+ '<div class="pause-state"></div>'
			+ '<div class="pause-body"><div class="pause-list"></div><div class="pause-pane"></div></div>'
			+ '<div class="pause-foot">↑↓ Choose   ↵ Select   Esc Resume</div>'
			+ '</div>';

		this.list = root.querySelector('.pause-list');
		this.pane = root.querySelector('.pause-pane');
		this.state = root.querySelector('.pause-state');
		this.who = root.querySelector('.pause-who');

		this.items.forEach((item, i) =>
		{
			let entry = document.createElement('div');
			entry.className = 'pause-item';
			entry.textContent = item.label;
			entry.addEventListener('mouseenter', () => { if (this.index !== i) this.pick(i); });
			onTap(entry, () =>
			{
				if (this.index !== i) this.pick(i);
				if (item.action !== undefined) item.action();
			});
			this.list.appendChild(entry);
		});

		// Clicks on the menu are the menu's, not a shot fired into the world behind it
		for (const type of ['mousedown', 'click', 'touchstart', 'wheel'])
		{
			root.addEventListener(type, (event) => event.stopPropagation());
		}

		document.getElementById('ui-container').appendChild(root);
		this.root = root;
	}
}
