export class UIManager
{
	public static setUserInterfaceVisible(value: boolean): void
	{
		document.getElementById('ui-container').style.display = value ? 'block' : 'none';
	}

	public static setLoadingScreenVisible(value: boolean): void
	{
		document.getElementById('loading-screen').style.display = value ? 'flex' : 'none';
	}

	public static setFPSVisible(value: boolean): void
	{
		document.getElementById('statsBox').style.display = value ? 'block' : 'none';
		document.getElementById('dat-gui-container').style.top = value ? '48px' : '0px';
	}

	/** @param health 0 to 1. Weapon name undefined means empty handed. */
	public static setCombatHud(health: number, weapon: string, ammo: number, magazine: number): void
	{
		document.getElementById('health-fill').style.width = (health * 100).toFixed(1) + '%';

		let readout = document.getElementById('weapon-readout');
		if (weapon === undefined)
		{
			readout.style.visibility = 'hidden';
			return;
		}

		readout.style.visibility = 'visible';
		document.getElementById('weapon-name').textContent = weapon;
		document.getElementById('weapon-ammo').textContent = ammo + ' / ' + magazine;
	}

	/** Names come off the network, so they're written as text, never as HTML. */
	public static setScoreboard(names: string[], colors: string[], scores: number[]): void
	{
		let rows = document.getElementById('scoreboard-rows');
		while (rows.firstChild !== null) rows.removeChild(rows.firstChild);

		for (let i = 0; i < names.length; i++)
		{
			let dot = document.createElement('span');
			dot.className = 'scoreboard-dot';
			dot.style.background = colors[i];

			let name = document.createElement('span');
			name.className = 'scoreboard-name';
			name.appendChild(document.createTextNode(names[i]));

			let score = document.createElement('span');
			score.className = 'scoreboard-score';
			score.appendChild(document.createTextNode(String(scores[i])));

			let row = document.createElement('div');
			row.className = 'scoreboard-row';
			row.appendChild(dot);
			row.appendChild(name);
			row.appendChild(score);

			rows.appendChild(row);
		}
	}

	public static toggleSettings(): void
	{
		let panel = document.getElementById('dat-gui-container');
		panel.style.display = (panel.style.display === 'block') ? 'none' : 'block';
	}

	public static setPartyVisible(value: boolean): void
	{
		document.getElementById('party-hud').style.display = value ? 'block' : 'none';
	}

	/** Names come off the network, so they're written as text nodes, never as HTML. */
	public static setPartyDetails(code: string, names: string[], colors: string[]): void
	{
		document.getElementById('party-code-value').textContent = code;

		let list = document.getElementById('party-players');
		while (list.firstChild !== null) list.removeChild(list.firstChild);

		for (let i = 0; i < names.length; i++)
		{
			let dot = document.createElement('span');
			dot.className = 'party-dot';
			dot.style.background = colors[i];

			let entry = document.createElement('span');
			entry.className = 'party-player';
			entry.appendChild(dot);
			entry.appendChild(document.createTextNode(names[i]));

			list.appendChild(entry);
		}
	}

	public static setSpeedometerVisible(value: boolean): void
	{
		document.getElementById('speedometer').style.display = value ? 'block' : 'none';
	}

	/** @param fill 0 at a standstill, 1 at the vehicle's top speed. */
	public static setSpeedometerFill(fill: number): void
	{
		document.getElementById('speedometer-fill').style.width = (fill * 100).toFixed(1) + '%';
	}
}