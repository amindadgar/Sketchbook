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
	public static setCombatHud(health: number, weapon: string, ammo: number, reserve: number): void
	{
		let points = Math.round(health * 100);
		document.getElementById('health-number').textContent = String(points);

		// Turns red as it runs down, so a glance at the corner is enough
		let badge = document.getElementById('health-badge');
		badge.classList.toggle('hurt', points <= 60 && points > 25);
		badge.classList.toggle('dying', points <= 25);

		let readout = document.getElementById('weapon-readout');
		if (weapon === undefined)
		{
			readout.style.visibility = 'hidden';
			return;
		}

		readout.style.visibility = 'visible';
		document.getElementById('weapon-name').textContent = weapon;
		document.getElementById('weapon-ammo').textContent = ammo + ' / ' + reserve;
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

	public static setReticleVisible(value: boolean): void
	{
		document.getElementById('reticle').style.display = value ? 'block' : 'none';
	}

	/**
	 * The four ticks that say a shot landed. Restarted rather than merely shown,
	 * so a burst reads as several hits instead of one long one.
	 */
	public static flashHitMarker(): void
	{
		let marker = document.getElementById('hit-marker');

		marker.classList.remove('struck');
		// Reading a layout property forces the removal to take effect, which is
		// what lets the animation start again from the beginning
		void marker.offsetWidth;
		marker.classList.add('struck');
	}

	// ------------------------------------------------------------------ stunts

	/** What the car is doing right now, mid air. Undefined takes it away. */
	public static setStuntLive(what: string, airtime?: string): void
	{
		let panel = document.getElementById('stunt-live');

		if (what === undefined)
		{
			panel.style.display = 'none';
			return;
		}

		document.getElementById('stunt-what').textContent = what;
		document.getElementById('stunt-air').textContent = airtime;
		panel.style.display = 'block';
	}

	// ----------------------------------------------------------------- player

	public static setPlayerPanel(level: number, xp: number, floor: number, ceiling: number): void
	{
		document.getElementById('panel-level').textContent = 'Level ' + level;
		document.getElementById('panel-xp-text').textContent = (xp - floor) + ' / ' + (ceiling - floor) + ' XP';

		let span = Math.max(1, ceiling - floor);
		document.getElementById('panel-xp-fill').style.width =
			(Math.min(1, (xp - floor) / span) * 100).toFixed(1) + '%';
	}

	/** Labels are ours, but the numbers are the player's, so both go in as text. */
	public static setChallenges(rows: { label: string, at: number, goal: number, done: boolean, unit: string }[]): void
	{
		let list = document.getElementById('panel-challenge-rows');
		while (list.firstChild !== null) list.removeChild(list.firstChild);

		for (const entry of rows)
		{
			let label = document.createElement('span');
			label.className = 'challenge-label';
			label.appendChild(document.createTextNode(entry.label));

			let count = document.createElement('span');
			count.className = 'challenge-count';
			count.appendChild(document.createTextNode(entry.done
				? 'done'
				: Math.floor(Math.min(entry.at, entry.goal)) + ' / ' + entry.goal + (entry.unit || '')));

			let fill = document.createElement('div');
			fill.className = 'challenge-fill';
			fill.style.width = (Math.min(1, entry.at / entry.goal) * 100).toFixed(1) + '%';

			let track = document.createElement('div');
			track.className = 'challenge-track';
			track.appendChild(fill);

			let row = document.createElement('div');
			row.className = 'challenge-row' + (entry.done ? ' done' : '');
			row.appendChild(label);
			row.appendChild(count);
			row.appendChild(track);

			list.appendChild(row);
		}
	}

	// ------------------------------------------------------------------- death

	/**
	 * What is happening while the player is down. Undefined takes it away.
	 * The watched name comes off the network, so it goes in as text.
	 */
	public static setDeathNotice(seconds: number, watching?: string): void
	{
		let notice = document.getElementById('death-notice');

		if (seconds === undefined)
		{
			notice.style.display = 'none';
			return;
		}

		document.getElementById('death-timer').textContent =
			'Respawning in ' + Math.max(1, Math.ceil(seconds));

		let watch = document.getElementById('death-watching');
		while (watch.firstChild !== null) watch.removeChild(watch.firstChild);

		if (watching !== undefined)
		{
			watch.appendChild(document.createTextNode('Watching ' + watching));
		}

		notice.style.display = 'block';
	}

	// -------------------------------------------------------------------- chat

	/** Names and messages come off the network, so both are written as text. */
	public static addChatLine(name: string, color: string, text: string, keep: number): void
	{
		let log = document.getElementById('chat-log');

		let who = document.createElement('span');
		who.className = 'chat-name';
		who.style.color = color;
		who.appendChild(document.createTextNode(name));

		let said = document.createElement('span');
		said.appendChild(document.createTextNode(text));

		let line = document.createElement('div');
		line.className = 'chat-line';
		line.appendChild(who);
		line.appendChild(said);

		log.appendChild(line);

		while (log.childElementCount > keep) log.removeChild(log.firstChild);
	}

	public static setChatVisible(value: boolean): void
	{
		document.getElementById('chat').style.display = value ? 'block' : 'none';
	}

	// ------------------------------------------------------------------ rounds

	/** Time left in the round, above the scoreboard. Undefined hides it. */
	public static setMatchClock(text: string): void
	{
		let clock = document.getElementById('match-clock');

		clock.style.display = text === undefined ? 'none' : 'block';
		if (text !== undefined) clock.textContent = text;
	}

	/** Names come off the network, so they're written as text, never as HTML. */
	public static setMatchResult(rows: { name: string, color: string, score: number }[]): void
	{
		let panel = document.getElementById('match-result');

		if (rows === undefined)
		{
			panel.style.display = 'none';
			return;
		}

		let list = document.getElementById('match-result-rows');
		while (list.firstChild !== null) list.removeChild(list.firstChild);

		rows.forEach((entry, index) =>
		{
			let place = document.createElement('span');
			place.className = 'match-result-place';
			place.appendChild(document.createTextNode(String(index + 1)));

			let dot = document.createElement('span');
			dot.className = 'scoreboard-dot';
			dot.style.background = entry.color;

			let name = document.createElement('span');
			name.className = 'match-result-name';
			name.appendChild(document.createTextNode(entry.name));

			let score = document.createElement('span');
			score.className = 'match-result-score';
			score.appendChild(document.createTextNode(String(entry.score)));

			let row = document.createElement('div');
			row.className = 'match-result-row';
			row.appendChild(place);
			row.appendChild(dot);
			row.appendChild(name);
			row.appendChild(score);
			list.appendChild(row);
		});

		panel.style.display = 'block';
	}

	// ------------------------------------------------------------------- racing

	public static setRaceVisible(value: boolean): void
	{
		document.getElementById('race-hud').style.display = value ? 'block' : 'none';
	}

	public static setRaceHud(lap: number, laps: number, place: number, field: number,
		time: string, best: string): void
	{
		document.getElementById('race-lap').textContent = lap + ' / ' + laps;
		document.getElementById('race-place').textContent = place + ' / ' + field;
		document.getElementById('race-time').textContent = time;
		document.getElementById('race-best').textContent = best;
	}

	/** The starting lights, and 'GO'. Undefined takes them away. */
	public static setRaceCountdown(text: string): void
	{
		let element = document.getElementById('race-countdown');

		if (text === undefined)
		{
			element.style.display = 'none';
			return;
		}

		if (element.textContent !== text)
		{
			element.textContent = text;
			// Restarted so each number of the countdown gets its own beat
			element.classList.remove('tick');
			void element.offsetWidth;
			element.classList.add('tick');
		}

		element.style.display = 'block';
	}

	public static setRaceResult(place: number, field?: number, total?: string, best?: string): void
	{
		let panel = document.getElementById('race-result');

		if (place === undefined)
		{
			panel.style.display = 'none';
			return;
		}

		document.getElementById('race-result-place').textContent = UIManager.ordinal(place) + ' of ' + field;
		document.getElementById('race-result-total').textContent = total;
		document.getElementById('race-result-best').textContent = best;
		panel.style.display = 'block';
	}

	private static ordinal(value: number): string
	{
		if (value === 1) return '1st';
		if (value === 2) return '2nd';
		if (value === 3) return '3rd';
		return value + 'th';
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
		document.getElementById('speed-badge').style.visibility = value ? 'visible' : 'hidden';
		document.getElementById('boost').style.visibility = value ? 'visible' : 'hidden';
	}

	/** @param left 0 to 1, and whether it's being spent right now. */
	public static setBoost(left: number, spending: boolean): void
	{
		document.getElementById('boost-fill').style.width = (left * 100).toFixed(1) + '%';
		document.getElementById('boost').classList.toggle('spending', spending);
	}

	/** @param fill 0 at a standstill, 1 at the vehicle's top speed. */
	public static setSpeedometerFill(fill: number, speed: number): void
	{
		document.getElementById('speedometer-fill').style.width = (fill * 100).toFixed(1) + '%';
		// The phone layout shows a figure under the stick instead of a bar
		document.getElementById('speed-number').textContent = String(Math.round(speed));
	}
}