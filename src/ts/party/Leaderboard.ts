import { Account } from './Account';
import { NetworkClient } from './NetworkClient';
import { World } from '../world/World';
import { RaceSystem } from '../race/RaceSystem';

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

		// The circuit being driven, when there is one, otherwise kills overall
		let track = this.world.race.trackId;
		document.getElementById('leaderboard-title').textContent = track === undefined
			? 'Most kills' : 'Best laps';

		this.setRows([['', 'Asking the server…', '']]);

		Account.leaderboard(NetworkClient.loadUrl(), track)
			.then((players) => this.fill(players, track !== undefined))
			.catch((error) => this.setRows([['', error.message, '']]));
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
			laps ? RaceSystem.clock(entry.best_ms / 1000) : String(entry.kills)
		]));
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
