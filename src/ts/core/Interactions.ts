import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';

/** Something the player could do right here: walk up to a counter, pull into a garage. */
export interface Offer
{
	/** What E does, as the prompt says it: "Browse guns", "Repair the car  $240". */
	text: string;
	action: () => void;
	/** The higher wins when two are on offer at once. */
	priority?: number;
}

/**
 * The one thing E does at the moment, and the prompt that says so.
 *
 * Anything with something to offer puts it forward every frame it's on offer,
 * and whatever wins is shown at the bottom of the screen until the next one.
 * E then does it, on foot or at the wheel; on a phone the prompt itself is the
 * button. E is only taken while there's something to take it for, so the
 * aircraft and the free camera keep theirs.
 */
export class Interactions implements IUpdatable
{
	// After everything that offers
	public updateOrder: number = 40;

	private world: World;
	private offers: Offer[] = [];
	private current: Offer;
	private prompt: HTMLElement;
	private promptText: HTMLElement;

	constructor(world: World)
	{
		this.world = world;
		this.prompt = document.getElementById('interaction-prompt');
		this.promptText = document.getElementById('interaction-text');
		if (this.prompt !== null)
		{
			let tap = (event: Event) =>
			{
				event.preventDefault();
				event.stopPropagation();
				this.trigger();
			};
			this.prompt.addEventListener('touchstart', tap, { passive: false });
			this.prompt.addEventListener('mousedown', tap);
		}
		world.registerUpdatable(this);
	}

	/** Put forward for this frame only. */
	public offer(offer: Offer): void
	{
		this.offers.push(offer);
	}

	public get available(): boolean
	{
		return this.current !== undefined;
	}

	/** Does whatever is on offer. False if there wasn't anything. */
	public trigger(): boolean
	{
		if (this.current === undefined) return false;
		let action = this.current.action;
		this.current = undefined;
		action();
		return true;
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		let best: Offer;
		for (const offer of this.offers)
		{
			if (best === undefined || (offer.priority || 0) > (best.priority || 0)) best = offer;
		}
		this.offers = [];
		this.current = best;

		if (this.prompt === null) return;
		if (best === undefined)
		{
			this.prompt.style.display = 'none';
			return;
		}
		this.prompt.style.display = '';
		if (this.promptText.textContent !== best.text) this.promptText.textContent = best.text;
	}
}
