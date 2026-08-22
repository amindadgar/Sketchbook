import { Account } from './Account';
import { NetworkClient } from './NetworkClient';
import { World } from '../world/World';
import { RaceSystem } from '../race/RaceSystem';
import { UIManager } from '../core/UIManager';

/**
 * The boards the server has been keeping all along and nothing ever showed:
 * kills across every party, and best laps per circuit.
 */
export class Leaderboard
{
	private world: World;
	private panel: HTMLElement;
	private open: boolean = false;

	constructor(world: World)
	{
		this.world = world;
		this.panel = document.getElementById('leaderboard');

		document.getElementById('leaderboard-close').addEventListener('click', () => this.hide(), false);
	}

	public toggle(): void
	{
		if (this.open) this.hide();
		else this.show();
	}

	public hide(): void
	{
		this.open = false;
		this.panel.style.display = 'none';
	}

	public show(): void
	{
		this.open = true;
		this.panel.style.display = 'block';

		this.drawProgress();

		// The circuit being driven, when there is one, otherwise kills overall
		let track = this.world.race.trackId;
		document.getElementById('leaderboard-title').textContent = track === undefined
			? 'Most kills' : 'Best laps';

		this.setRows([['', 'Asking the server…', '']]);

		Account.leaderboard(NetworkClient.loadUrl(), track)
			.then((players) => this.fill(players, track !== undefined))
			.catch((error) => this.setRows([['', error.message, '']]));
	}

	/** The player's own level and today's three, above whichever board is shown. */
	private drawProgress(): void
	{
		let progress = this.world.progress;

		UIManager.setPlayerPanel(progress.level, progress.xp, progress.levelFloor, progress.levelCeiling);
		UIManager.setChallenges(progress.todaysChallenges.map((challenge) => ({
			label: challenge.label,
			at: progress.progressOn(challenge),
			goal: challenge.goal,
			done: progress.isDone(challenge),
			unit: challenge.unit
		})));
	}

	private fill(players: any[], laps: boolean): void
	{
		if (players.length === 0)
		{
			this.setRows([['', 'Nobody has set one yet.', '']]);
			return;
		}

		this.setRows(players.map((entry, index) =>
		[
			String(index + 1),
			String(entry.username),
			Leaderboard.figure(entry, laps)
		]));
	}

	/**
	 * A relay older than the game answers a lap request with the kills board,
	 * which has no times in it. Better a dash than three NaNs.
	 */
	private static figure(entry: any, laps: boolean): string
	{
		let value = laps ? entry.best_ms : entry.kills;
		if (typeof value !== 'number') return '--';

		return laps ? RaceSystem.clock(value / 1000) : String(value);
	}

	/** Everything here came off the network, so all of it is written as text. */
	private setRows(rows: string[][]): void
	{
		let body = document.getElementById('leaderboard-rows');
		while (body.firstChild !== null) body.removeChild(body.firstChild);

		for (const cells of rows)
		{
			let row = document.createElement('div');
			row.className = 'leaderboard-row';

			['place', 'name', 'value'].forEach((role, index) =>
			{
				let cell = document.createElement('span');
				cell.className = 'leaderboard-' + role;
				cell.appendChild(document.createTextNode(cells[index]));
				row.appendChild(cell);
			});

			body.appendChild(row);
		}
	}
}
