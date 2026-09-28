import { World } from '../world/World';
import { Wallet } from '../progress/Wallet';
import { DeviceProfile } from './DeviceProfile';
import { DONATION_ASK, DONATION_WALLETS, DonationWallet, GITHUB_URL } from './Donations';

/** One line of controls: the keys, and what they do. */
export interface ControlRow
{
	keys: string[];
	desc: string;
}

/**
 * What the phone and the pause menu both show: the controls, how the player
 * is getting on, and how to support the game. Built as DOM rather than HTML
 * strings, since the player's name and the challenges end up in it.
 */
export class GameInfo
{
	/** Whatever works wherever the player is, listed after what works here. */
	public static readonly EVERYWHERE: ControlRow[] = [
		{ keys: ['↑'], desc: 'Phone' },
		{ keys: ['Esc'], desc: 'Pause' },
		{ keys: ['J'], desc: 'Jobs' },
		{ keys: ['E'], desc: 'Shops, and what a job asks' },
		{ keys: ['N'], desc: 'Big map' },
		{ keys: ['L'], desc: 'Leaderboard' },
		{ keys: ['M'], desc: 'Mute music' },
		{ keys: ['C'], desc: 'Centre camera' },
		{ keys: ['Enter'], desc: 'Party chat' },
	];

	/** A phone has no keys; around the buttons, which change with what the player's doing, are these. */
	public static readonly TOUCH_AROUND: ControlRow[] = [
		{ keys: ['Stick'], desc: 'Move and steer. All the way to sprint' },
		{ keys: ['Drag'], desc: 'Look around' },
	];
	public static readonly TOUCH_ANYWHERE: ControlRow[] = [
		{ keys: ['Gun name'], desc: 'Fists, then each gun carried' },
		{ keys: ['$'], desc: 'Jobs' },
		{ keys: ['MAP'], desc: 'The whole map' },
		{ keys: ['☎'], desc: 'This phone' },
	];

	/** Words that join keys, written between the key caps rather than as one. */
	private static readonly JOINERS: string[] = ['+', 'and', 'or', '&'];

	/** The keys for here, then the ones for everywhere; on a phone, the buttons on screen now. */
	public static renderControls(into: HTMLElement, world: World): void
	{
		GameInfo.clear(into);

		if (DeviceProfile.isTouch() && world.touchControls !== undefined)
		{
			into.appendChild(GameInfo.heading('Here'));
			GameInfo.TOUCH_AROUND.concat(world.touchControls.describe()).forEach((row) => into.appendChild(GameInfo.controlRow(row)));
			into.appendChild(GameInfo.heading('Anywhere'));
			GameInfo.TOUCH_ANYWHERE.forEach((row) => into.appendChild(GameInfo.controlRow(row)));
			return;
		}

		let here = world.controls;
		if (here.length > 0)
		{
			into.appendChild(GameInfo.heading('Here'));
			here.forEach((row) => into.appendChild(GameInfo.controlRow(row)));
		}
		into.appendChild(GameInfo.heading('Anywhere'));
		GameInfo.EVERYWHERE.forEach((row) => into.appendChild(GameInfo.controlRow(row)));
	}

	/** Level and experience, money, and today's three. */
	public static renderStats(into: HTMLElement, world: World): void
	{
		GameInfo.clear(into);
		let progress = world.progress;

		let level = GameInfo.element('div', 'info-level');
		level.appendChild(GameInfo.element('span', 'info-level-number', 'Level ' + progress.level));
		let span = Math.max(1, progress.levelCeiling - progress.levelFloor);
		level.appendChild(GameInfo.element('span', 'info-level-xp', (progress.xp - progress.levelFloor) + ' / ' + span + ' XP'));
		into.appendChild(level);
		into.appendChild(GameInfo.bar((progress.xp - progress.levelFloor) / span));

		let money = GameInfo.element('div', 'info-money');
		money.appendChild(GameInfo.element('span', 'info-money-cash', '$' + Wallet.format(world.wallet.cash)));
		money.appendChild(GameInfo.element('span', 'info-money-earned', '$' + Wallet.format(world.wallet.earned) + ' earned in all'));
		into.appendChild(money);

		into.appendChild(GameInfo.heading('Today\'s challenges'));
		for (const challenge of progress.todaysChallenges)
		{
			let done = progress.isDone(challenge);
			let at = progress.progressOn(challenge);
			let row = GameInfo.element('div', 'info-challenge' + (done ? ' done' : ''));
			let line = GameInfo.element('div', 'info-challenge-line');
			line.appendChild(GameInfo.element('span', 'info-challenge-label', challenge.label));
			line.appendChild(GameInfo.element('span', 'info-challenge-count', done
				? 'done'
				: Math.floor(Math.min(at, challenge.goal)) + ' / ' + challenge.goal + (challenge.unit || '')));
			row.appendChild(line);
			row.appendChild(GameInfo.bar(done ? 1 : at / challenge.goal));
			into.appendChild(row);
		}
	}

	/** The code, and a way to give. Wallets not filled in yet say they're coming. */
	public static renderSupport(into: HTMLElement): void
	{
		GameInfo.clear(into);

		into.appendChild(GameInfo.element('p', 'info-text', DONATION_ASK));

		let link = document.createElement('a');
		link.className = 'info-github';
		link.href = GITHUB_URL;
		link.target = '_blank';
		link.rel = 'noopener';
		link.appendChild(GameInfo.githubMark());
		link.appendChild(GameInfo.element('span', '', 'The code on GitHub'));
		into.appendChild(link);

		into.appendChild(GameInfo.heading('Donate in crypto'));
		for (const wallet of DONATION_WALLETS)
		{
			into.appendChild(GameInfo.walletCard(wallet));
		}
	}

	/** A wallet's name as it's written in a list: the coin, and the chain if it has one. */
	public static walletName(wallet: DonationWallet): string
	{
		return wallet.network !== undefined && wallet.network.length > 0 ? wallet.coin + ' · ' + wallet.network : wallet.coin;
	}

	/**
	 * An address onto the clipboard. The clipboard wants a secure page and a
	 * gesture; failing either, the address is at least selected for copying.
	 */
	public static copy(text: string, fallback?: HTMLElement): Promise<boolean>
	{
		let select = () =>
		{
			if (fallback === undefined) return false;
			let range = document.createRange();
			range.selectNodeContents(fallback);
			let selection = window.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
			return false;
		};

		if (navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== 'function') return Promise.resolve(select());
		return navigator.clipboard.writeText(text).then(() => true).catch(() => select());
	}

	/** GitHub's mark, drawn rather than fetched. */
	public static githubMark(): SVGElement
	{
		let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('class', 'info-github-mark');
		let path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('fill', 'currentColor');
		path.setAttribute('d', 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z');
		svg.appendChild(path);
		return svg;
	}

	private static walletCard(wallet: DonationWallet): HTMLElement
	{
		let card = GameInfo.element('div', 'info-wallet');
		card.appendChild(GameInfo.element('div', 'info-wallet-coin', GameInfo.walletName(wallet)));

		if (wallet.address.length === 0)
		{
			card.appendChild(GameInfo.element('div', 'info-wallet-soon', 'Wallet address coming soon'));
			return card;
		}

		let line = GameInfo.element('div', 'info-wallet-line');
		let address = GameInfo.element('div', 'info-wallet-address', wallet.address);
		let button = GameInfo.element('button', 'info-copy', 'Copy') as HTMLButtonElement;
		button.type = 'button';
		button.addEventListener('click', () =>
		{
			GameInfo.copy(wallet.address, address).then((copied) =>
			{
				button.textContent = copied ? 'Copied' : 'Selected';
				window.setTimeout(() => button.textContent = 'Copy', 1600);
			});
		}, false);
		line.appendChild(address);
		line.appendChild(button);
		card.appendChild(line);
		return card;
	}

	private static controlRow(row: ControlRow): HTMLElement
	{
		let line = GameInfo.element('div', 'info-control');
		let keys = GameInfo.element('span', 'info-keys');
		row.keys.forEach((key) =>
		{
			if (GameInfo.JOINERS.indexOf(key) >= 0) keys.appendChild(GameInfo.element('span', 'info-joiner', key));
			else keys.appendChild(GameInfo.element('span', 'info-key', key));
		});
		line.appendChild(keys);
		line.appendChild(GameInfo.element('span', 'info-control-desc', row.desc));
		return line;
	}

	private static bar(fraction: number): HTMLElement
	{
		let track = GameInfo.element('div', 'info-bar');
		let fill = GameInfo.element('div', 'info-bar-fill');
		fill.style.width = (Math.max(0, Math.min(1, fraction)) * 100).toFixed(1) + '%';
		track.appendChild(fill);
		return track;
	}

	private static heading(text: string): HTMLElement
	{
		return GameInfo.element('div', 'info-heading', text);
	}

	private static element(tag: string, className: string, text?: string): HTMLElement
	{
		let element = document.createElement(tag);
		if (className.length > 0) element.className = className;
		if (text !== undefined) element.textContent = text;
		return element;
	}

	private static clear(element: HTMLElement): void
	{
		while (element.firstChild !== null) element.removeChild(element.firstChild);
	}
}
