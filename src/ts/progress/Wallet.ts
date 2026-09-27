import { World } from '../world/World';
import { UIManager } from '../core/UIManager';

/** A vehicle bought at the dealership: which model, and what colour it was ordered in. */
export interface OwnedVehicle
{
	model: string;
	color: number;
}

interface Saved
{
	cash: number;
	guns: string[];
	vehicles: OwnedVehicle[];
	earned: number;
}

/**
 * Money, and what it has bought.
 *
 * Kept in the browser like experience is: the jobs that pay it are played out
 * on this screen, and nothing on the server could check that a fare was really
 * driven. Guns bought stay bought through a death, vehicles bought can be had
 * back from the dealership's lot for nothing.
 */
export class Wallet
{
	private static readonly STORAGE_KEY: string = 'sketchbook.wallet';
	/** Enough for a pistol and a tank of patience. */
	public static readonly STARTING_CASH: number = 500;
	/** A share of what's carried, lost on dying: the hospital's bill. */
	private static readonly DEATH_SHARE: number = 0.1;
	private static readonly DEATH_MAX: number = 1500;

	private world: World;
	private state: Saved;
	private dirty: boolean = false;
	private sinceSave: number = 0;
	private shown: number = -1;

	constructor(world: World)
	{
		this.world = world;
		this.state = this.load();
		this.refresh();

		// Written now rather than on the next second's tick when the tab goes:
		// a fare paid just before closing it is still paid
		let flush = () =>
		{
			if (!this.dirty) return;
			this.dirty = false;
			this.write();
		};
		window.addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', () =>
		{
			if (document.hidden) flush();
		});
	}

	public get cash(): number
	{
		return this.state.cash;
	}

	/** Everything ever paid out, for the stats panel. */
	public get earned(): number
	{
		return this.state.earned;
	}

	public get guns(): string[]
	{
		return this.state.guns;
	}

	public get vehicles(): OwnedVehicle[]
	{
		return this.state.vehicles;
	}

	/** Paid for something. The reason goes under the amount in the notice. */
	public add(amount: number, reason?: string): void
	{
		amount = Math.round(amount);
		if (!(amount > 0)) return;
		this.state.cash += amount;
		this.state.earned += amount;
		this.world.notices.say('+$' + Wallet.format(amount), 'good', reason);
		UIManager.flashCash('+$' + Wallet.format(amount), true);
		this.save();
	}

	public canAfford(amount: number): boolean
	{
		return this.state.cash >= amount;
	}

	/** Takes it if it's there. False, and nothing taken, when it isn't. */
	public spend(amount: number): boolean
	{
		amount = Math.round(amount);
		if (amount < 0 || this.state.cash < amount) return false;
		this.state.cash -= amount;
		UIManager.flashCash('-$' + Wallet.format(amount), false);
		this.save();
		return true;
	}

	/** Takes up to an amount without complaint, for losses rather than purchases. Returns what was taken. */
	public lose(amount: number): number
	{
		let taken = Math.min(this.state.cash, Math.max(0, Math.round(amount)));
		if (taken <= 0) return 0;
		this.state.cash -= taken;
		UIManager.flashCash('-$' + Wallet.format(taken), false);
		this.save();
		return taken;
	}

	/** The hospital's share of what was carried. Returns what it came to. */
	public payHospital(): number
	{
		let bill = Math.min(Wallet.DEATH_MAX, Math.round(this.state.cash * Wallet.DEATH_SHARE));
		return this.lose(bill);
	}

	public ownsGun(id: string): boolean
	{
		return this.state.guns.indexOf(id) >= 0;
	}

	public addGun(id: string): void
	{
		if (this.ownsGun(id)) return;
		this.state.guns.push(id);
		this.save();
	}

	public addVehicle(vehicle: OwnedVehicle): void
	{
		this.state.vehicles.push({ model: vehicle.model, color: vehicle.color });
		this.save();
	}

	public ownsVehicle(model: string): boolean
	{
		return this.state.vehicles.some((v) => v.model === model);
	}

	public update(unscaledTimeStep: number): void
	{
		this.refresh();
		if (!this.dirty) return;
		this.sinceSave += unscaledTimeStep;
		if (this.sinceSave < 1) return;
		this.sinceSave = 0;
		this.dirty = false;
		this.write();
	}

	public static format(amount: number): string
	{
		return Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	}

	private refresh(): void
	{
		if (this.shown === this.state.cash) return;
		this.shown = this.state.cash;
		UIManager.setCash('$' + Wallet.format(this.state.cash));
	}

	private load(): Saved
	{
		let fresh: Saved = { cash: Wallet.STARTING_CASH, guns: [], vehicles: [], earned: 0 };
		try
		{
			let raw = window.localStorage.getItem(Wallet.STORAGE_KEY);
			if (raw === null) return fresh;
			let saved = JSON.parse(raw);
			let cash = Number(saved.cash);
			return {
				cash: isFinite(cash) && cash >= 0 ? Math.round(cash) : fresh.cash,
				guns: Array.isArray(saved.guns) ? saved.guns.filter((g: any) => typeof g === 'string') : [],
				vehicles: Array.isArray(saved.vehicles)
					? saved.vehicles.filter((v: any) => v !== null && typeof v.model === 'string').map((v: any) => ({ model: v.model, color: Number(v.color) || 0 }))
					: [],
				earned: Number(saved.earned) || 0
			};
		}
		catch (error)
		{
			return fresh;
		}
	}

	private save(): void
	{
		this.dirty = true;
		this.refresh();
	}

	private write(): void
	{
		try
		{
			window.localStorage.setItem(Wallet.STORAGE_KEY, JSON.stringify(this.state));
		}
		catch (error)
		{
			// Private browsing: the money is real until the tab closes
		}
	}
}
