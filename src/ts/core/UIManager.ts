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