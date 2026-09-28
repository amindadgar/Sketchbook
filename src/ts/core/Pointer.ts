/**
 * Letting go of the mouse on purpose, as opposed to the player pressing Esc.
 *
 * The browser keeps the Esc that ends pointer lock to itself, so the only
 * sign the player asked to pause is the lock going. The game lets go of it
 * itself too, for a shop's buttons or a restart, and those mustn't pause.
 */
export class Pointer
{
	/** Set just before the game lets go itself, and read once by whoever hears the lock go. */
	public static releasing: boolean = false;

	public static release(): void
	{
		if (!document.pointerLockElement || !document.exitPointerLock) return;
		Pointer.releasing = true;
		document.exitPointerLock();
	}

	/** Whether the lock just went because the game asked, which is then forgotten. */
	public static takeRelease(): boolean
	{
		let released = Pointer.releasing;
		Pointer.releasing = false;
		return released;
	}
}
