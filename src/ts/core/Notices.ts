import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';

interface Notice
{
	element: HTMLElement;
	life: number;
}

/**
 * Two channels of short lived text.
 *
 * Toasts are for things that happened to you and want a moment of attention: a
 * record, an unlock, a challenge finished. The feed is for things that happened
 * to somebody else and want none: who shot whom.
 *
 * Everything either channel is handed goes in as a text node. Names come off
 * the network and some of them will be trying it on.
 */
export class Notices implements IUpdatable
{
	public updateOrder: number = 17;

	private static readonly TOAST_LIFE: number = 3.4;
	private static readonly TOASTS_AT_ONCE: number = 4;
	private static readonly FEED_LIFE: number = 7;
	private static readonly FEED_AT_ONCE: number = 5;

	private world: World;
	private toasts: Notice[] = [];
	private feed: Notice[] = [];

	constructor(world: World)
	{
		this.world = world;
		this.world.registerUpdatable(this);
	}

	/** @param tone 'good' is gold, 'bad' is red, anything else is plain. */
	public say(text: string, tone?: string, detail?: string): void
	{
		let line = document.createElement('div');
		line.className = 'notice' + (tone !== undefined ? ' notice-' + tone : '');
		line.appendChild(document.createTextNode(text));

		if (detail !== undefined)
		{
			let small = document.createElement('span');
			small.className = 'notice-detail';
			small.appendChild(document.createTextNode(detail));
			line.appendChild(small);
		}

		document.getElementById('notices').appendChild(line);
		this.toasts.push({ element: line, life: Notices.TOAST_LIFE });

		while (this.toasts.length > Notices.TOASTS_AT_ONCE) this.retire(this.toasts, 0);
	}

	/** One kill, as the room saw it. */
	public kill(killer: string, killerColor: string, victim: string, victimColor: string, weapon: string): void
	{
		let line = document.createElement('div');
		line.className = 'kill-line';

		line.appendChild(Notices.who(killer, killerColor));

		let verb = document.createElement('span');
		verb.className = 'kill-weapon';
		verb.appendChild(document.createTextNode(weapon === undefined ? 'wrecked' : weapon));
		line.appendChild(verb);

		line.appendChild(Notices.who(victim, victimColor));

		document.getElementById('kill-feed').appendChild(line);
		this.feed.push({ element: line, life: Notices.FEED_LIFE });

		while (this.feed.length > Notices.FEED_AT_ONCE) this.retire(this.feed, 0);
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		this.age(this.toasts, unscaledTimeStep);
		this.age(this.feed, unscaledTimeStep);
	}

	private age(list: Notice[], unscaledTimeStep: number): void
	{
		for (let i = list.length - 1; i >= 0; i--)
		{
			list[i].life -= unscaledTimeStep;
			if (list[i].life <= 0) this.retire(list, i);
		}
	}

	private retire(list: Notice[], index: number): void
	{
		let notice = list[index];
		list.splice(index, 1);

		if (notice.element.parentNode !== null) notice.element.parentNode.removeChild(notice.element);
	}

	private static who(name: string, color: string): HTMLElement
	{
		let span = document.createElement('span');
		span.className = 'kill-who';
		span.style.color = color;
		span.appendChild(document.createTextNode(name));
		return span;
	}
}
