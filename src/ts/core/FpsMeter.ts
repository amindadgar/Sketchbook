/**
 * Frames per second, as a number in the corner, green when it's smooth,
 * amber when it's playable and red when it isn't.
 *
 * Counted over half a second at a time rather than from each frame's length,
 * so it holds still long enough to read and a single hitch doesn't flash it.
 */
export class FpsMeter
{
	private static readonly WINDOW: number = 0.5;

	private badge: HTMLElement;
	private number: HTMLElement;
	private frames: number = 0;
	private since: number = performance.now();
	private worst: number = 0;
	private last: number = performance.now();
	/** Start counting afresh on the next frame: the first one, and the first after the tab was hidden. */
	private restart: boolean = true;

	constructor()
	{
		this.badge = document.getElementById('fps-badge');
		this.number = document.getElementById('fps-number');
		// A hidden tab draws nothing, and that gap isn't the game running slowly
		document.addEventListener('visibilitychange', () =>
		{
			if (document.hidden) this.restart = true;
		}, false);
	}

	public setVisible(visible: boolean): void
	{
		if (this.badge !== null) this.badge.style.display = visible ? '' : 'none';
	}

	/** Called once for every frame drawn. */
	public frame(): void
	{
		let now = performance.now();
		if (this.restart)
		{
			this.restart = false;
			this.frames = 0;
			this.worst = 0;
			this.since = now;
			this.last = now;
			return;
		}
		this.worst = Math.max(this.worst, now - this.last);
		this.last = now;
		this.frames++;

		let elapsed = (now - this.since) / 1000;
		if (elapsed < FpsMeter.WINDOW || this.badge === null) return;

		let fps = Math.round(this.frames / elapsed);
		this.number.textContent = String(fps);
		this.badge.title = 'Slowest frame in the last half second: ' + Math.round(this.worst) + ' ms';
		this.badge.classList.toggle('good', fps >= 50);
		this.badge.classList.toggle('fair', fps >= 30 && fps < 50);
		this.badge.classList.toggle('poor', fps < 30);

		this.frames = 0;
		this.worst = 0;
		this.since = now;
	}
}
