import { COLOURS, findHat } from './Unlocks';

/**
 * Who the local player is: the name shown above their character and the
 * colour their body and their car get tinted with.
 */
export class PlayerIdentity
{
	/** Kept for anything that just wants a colour, unlocked or not. */
	public static readonly PALETTE: string[] = COLOURS.map((entry) => entry.id);

	private static readonly STORAGE_KEY: string = 'sketchbook.player';

	public name: string;
	public color: string;
	/** Which hat, from the ones the account has earned. */
	public hat: string = 'none';

	constructor(name?: string, color?: string, hat?: string)
	{
		this.name = PlayerIdentity.sanitizeName(name);
		this.color = PlayerIdentity.sanitizeColor(color);
		this.hat = findHat(hat).id;
	}

	/** Restores the last used name and colour, so a reload doesn't reset them. */
	public static load(): PlayerIdentity
	{
		try
		{
			let raw = window.localStorage.getItem(PlayerIdentity.STORAGE_KEY);
			if (raw !== null)
			{
				let data = JSON.parse(raw);
				return new PlayerIdentity(data.name, data.color, data.hat);
			}
		}
		catch (error)
		{
			// Private mode, or storage disabled entirely. Fall through to a default.
		}

		return new PlayerIdentity(undefined, PlayerIdentity.randomColor());
	}

	public static randomColor(): string
	{
		return PlayerIdentity.PALETTE[Math.floor(Math.random() * PlayerIdentity.PALETTE.length)];
	}

	private static sanitizeName(name: string): string
	{
		if (name === undefined || name === null) return 'Player';

		let trimmed = name.replace(/\s+/g, ' ').trim().slice(0, 16);
		return trimmed.length > 0 ? trimmed : 'Player';
	}

	private static sanitizeColor(color: string): string
	{
		return /^#[0-9a-fA-F]{6}$/.test(color) ? color : PlayerIdentity.PALETTE[0];
	}

	public save(): void
	{
		try
		{
			window.localStorage.setItem(PlayerIdentity.STORAGE_KEY, JSON.stringify({
				name: this.name,
				color: this.color,
				hat: this.hat
			}));
		}
		catch (error)
		{
			// Nothing to do, the identity just won't survive a reload
		}
	}

	public set(name: string, color: string, hat?: string): void
	{
		this.name = PlayerIdentity.sanitizeName(name);
		this.color = PlayerIdentity.sanitizeColor(color);
		if (hat !== undefined) this.hat = findHat(hat).id;
	}
}
