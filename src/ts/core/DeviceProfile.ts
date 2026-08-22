/**
 * What this device can afford.
 *
 * A phone runs the same scene as a desktop, at three times the pixel density
 * and a fraction of the power budget, so a few settings are asked for here
 * rather than hard coded. Everything is read from the media query rather than
 * from a user agent string, so a touch laptop with a mouse counts as a desktop.
 */
export class DeviceProfile
{
	private static touch: boolean;

	public static isTouch(): boolean
	{
		if (DeviceProfile.touch === undefined)
		{
			// Asks what the primary pointer is like, rather than whether a touch
			// screen exists at all, so a touch laptop keeps its mouse controls
			DeviceProfile.touch = window.matchMedia !== undefined
				&& window.matchMedia('(pointer: coarse)').matches;
		}

		return DeviceProfile.touch;
	}

	/**
	 * A modern phone reports a device pixel ratio of 3, which asks the GPU for
	 * nine times the fragments of a plain 1x buffer. Past about 1.5 the extra
	 * detail is beyond what the screen shows anyway. Desktop is left alone.
	 */
	public static pixelRatio(): number
	{
		let ratio = window.devicePixelRatio || 1;
		return DeviceProfile.isTouch() ? Math.min(ratio, 1.5) : ratio;
	}

	/** Three cascades at 2048 is a lot of depth rasterising for a handset. */
	public static shadowMapSize(): number
	{
		return DeviceProfile.isTouch() ? 1024 : 2048;
	}
}
