import { World } from '../world/World';
import { DeviceProfile } from './DeviceProfile';

/**
 * The four things somebody needs to know in their first ten seconds.
 *
 * Desktop has the whole control list down the left hand side, so this is mostly
 * for a phone, where the keyboard hints are hidden and the buttons are the only
 * clue. Shown once, remembered, and dismissed by touching anything.
 */
export class Onboarding
{
	private static readonly STORAGE_KEY: string = 'sketchbook.introSeen';
	private static readonly LINGER: number = 14;

	private world: World;
	private card: HTMLElement;
	private left: number = 0;
	private showing: boolean = false;

	constructor(world: World)
	{
		this.world = world;
		this.card = document.getElementById('intro');

		let dismiss = () => this.hide();
		this.card.addEventListener('click', dismiss, false);
		this.card.addEventListener('touchstart', dismiss, false);
	}

	/** Called once the menu is out of the way and the game is actually running. */
	public begin(): void
	{
		if (this.seen()) return;

		this.remember();
		this.card.innerHTML = '';

		for (const line of Onboarding.lines())
		{
			let row = document.createElement('div');
			row.className = 'intro-line';

			let key = document.createElement('span');
			key.className = 'intro-key';
			key.appendChild(document.createTextNode(line[0]));

			let what = document.createElement('span');
			what.appendChild(document.createTextNode(line[1]));

			row.appendChild(key);
			row.appendChild(what);
			this.card.appendChild(row);
		}

		this.card.style.display = 'block';
		this.showing = true;
		this.left = Onboarding.LINGER;
	}

	public update(unscaledTimeStep: number): void
	{
		if (!this.showing) return;

		this.left -= unscaledTimeStep;
		if (this.left <= 0) this.hide();
	}

	private hide(): void
	{
		if (!this.showing) return;

		this.showing = false;
		this.card.style.display = 'none';
	}

	private static lines(): string[][]
	{
		if (DeviceProfile.isTouch())
		{
			return [
				['Stick', 'Drive and walk. Drag anywhere to look'],
				['ENTER', 'Get into a car you are standing next to'],
				['BOOST', 'Nitro. Ramps are worth points'],
				['MAP', 'Where you are, when you need it']
			];
		}

		return [
			['W A S D', 'Move, and steer'],
			['F', 'Get into a car you are standing next to'],
			['Shift', 'Nitro. Ramps are worth points'],
			['L', 'Your level, today\'s challenges and the boards']
		];
	}

	private seen(): boolean
	{
		try
		{
			return window.localStorage.getItem(Onboarding.STORAGE_KEY) !== null;
		}
		catch (error)
		{
			// Storage is off, so it shows every time rather than never
			return false;
		}
	}

	private remember(): void
	{
		try
		{
			window.localStorage.setItem(Onboarding.STORAGE_KEY, '1');
		}
		catch (error)
		{
			// Nothing to do
		}
	}
}
