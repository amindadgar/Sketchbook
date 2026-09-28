import { onTap } from './Tap';
import { Pointer } from './Pointer';

/** A line in a panel: a thing to buy, a job to take. */
export interface PanelRow
{
	title: string;
	/** A line under the title: what it is, what it pays. */
	detail?: string;
	/** Along the right: a price, a pay range. */
	aside?: string;
	/** The button, if there is one. */
	button?: string;
	enabled?: boolean;
	/** Picked out: the gun in hand, the job running. */
	highlight?: boolean;
	onClick?: () => void;
}

/**
 * The one panel at a time that the shops, the dealership and the job board
 * open in the middle of the screen: a title, a line of context, and rows with
 * a button each. The mouse is let go while it's open, so the buttons can be
 * clicked; the number keys press them too, and Esc or walking away closes it.
 */
export class Panel
{
	private static root: HTMLElement;
	private static rows: PanelRow[] = [];
	private static onClose: () => void;
	private static keyHandler: (event: KeyboardEvent) => void;

	public static get isOpen(): boolean
	{
		return Panel.root !== undefined && Panel.root.style.display !== 'none';
	}

	public static open(title: string, subtitle: string, rows: PanelRow[], onClose?: () => void): void
	{
		Panel.ensure();
		if (Panel.isOpen && Panel.onClose !== undefined && Panel.onClose !== onClose) Panel.onClose();
		Panel.onClose = onClose;
		(Panel.root.querySelector('.panel-title') as HTMLElement).textContent = title;
		(Panel.root.querySelector('.panel-subtitle') as HTMLElement).textContent = subtitle;
		Panel.fill(rows);
		Panel.root.style.display = '';
		// The buttons want the mouse, which is let go on purpose rather than to pause
		Pointer.release();
	}

	/** New rows and a new line of context, for a panel that's already open. */
	public static refresh(subtitle: string, rows: PanelRow[]): void
	{
		if (!Panel.isOpen) return;
		(Panel.root.querySelector('.panel-subtitle') as HTMLElement).textContent = subtitle;
		Panel.fill(rows);
	}

	public static close(): void
	{
		if (!Panel.isOpen) return;
		Panel.root.style.display = 'none';
		let onClose = Panel.onClose;
		Panel.onClose = undefined;
		if (onClose !== undefined) onClose();
	}

	private static fill(rows: PanelRow[]): void
	{
		Panel.rows = rows;
		let list = Panel.root.querySelector('.panel-rows') as HTMLElement;
		while (list.firstChild) list.removeChild(list.firstChild);

		rows.forEach((row, i) =>
		{
			let line = document.createElement('div');
			line.className = 'panel-row' + (row.highlight ? ' highlight' : '') + (row.enabled === false ? ' disabled' : '');

			let key = document.createElement('span');
			key.className = 'panel-key';
			key.textContent = i < 9 && row.button !== undefined ? String(i + 1) : '';
			line.appendChild(key);

			let text = document.createElement('div');
			text.className = 'panel-text';
			let title = document.createElement('div');
			title.className = 'panel-row-title';
			title.textContent = row.title;
			text.appendChild(title);
			if (row.detail !== undefined)
			{
				let detail = document.createElement('div');
				detail.className = 'panel-row-detail';
				detail.textContent = row.detail;
				text.appendChild(detail);
			}
			line.appendChild(text);

			if (row.aside !== undefined)
			{
				let aside = document.createElement('span');
				aside.className = 'panel-aside';
				aside.textContent = row.aside;
				line.appendChild(aside);
			}

			if (row.button !== undefined)
			{
				let button = document.createElement('button');
				button.className = 'panel-button';
				button.textContent = row.button;
				button.disabled = row.enabled === false;
				onTap(button, () =>
				{
					if (!button.disabled) Panel.press(i);
				}, Panel.root);
				line.appendChild(button);
			}

			list.appendChild(line);
		});
	}

	private static press(index: number): void
	{
		let row = Panel.rows[index];
		if (row === undefined || row.enabled === false || row.onClick === undefined) return;
		row.onClick();
	}

	private static ensure(): void
	{
		if (Panel.root !== undefined) return;
		let root = document.createElement('div');
		root.id = 'game-panel';
		root.style.display = 'none';

		let head = document.createElement('div');
		head.className = 'panel-head';
		let title = document.createElement('div');
		title.className = 'panel-title';
		let close = document.createElement('span');
		close.className = 'panel-close';
		close.textContent = '×';
		onTap(close, () => Panel.close(), root);
		head.appendChild(title);
		head.appendChild(close);
		root.appendChild(head);

		let subtitle = document.createElement('div');
		subtitle.className = 'panel-subtitle';
		root.appendChild(subtitle);

		let rows = document.createElement('div');
		rows.className = 'panel-rows';
		root.appendChild(rows);

		let foot = document.createElement('div');
		foot.className = 'panel-foot';
		foot.textContent = 'Number keys or click to choose, Esc to close';
		root.appendChild(foot);

		// Clicks on the panel stay on the panel, not on the game behind it
		for (const type of ['mousedown', 'mouseup', 'click', 'touchstart'])
		{
			root.addEventListener(type, (event) => event.stopPropagation());
		}

		(document.getElementById('ui-container') || document.body).appendChild(root);
		Panel.root = root;

		Panel.keyHandler = (event: KeyboardEvent) =>
		{
			if (!Panel.isOpen) return;
			// Typing in the chat, or any other box, is typing: a 3 there buys nothing
			let target = event.target as HTMLElement;
			if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
			if (event.code === 'Escape')
			{
				Panel.close();
				// Closing the shop isn't pausing the game
				event.stopPropagation();
				return;
			}
			let digit = /^Digit([1-9])$/.exec(event.code);
			if (digit !== null && !event.repeat)
			{
				Panel.press(Number(digit[1]) - 1);
				event.stopPropagation();
			}
		};
		document.addEventListener('keydown', Panel.keyHandler, true);
	}
}
