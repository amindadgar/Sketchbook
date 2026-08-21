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