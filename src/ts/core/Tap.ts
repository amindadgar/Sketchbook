/**
 * A tap on something on screen, for a finger and a mouse alike.
 *
 * On a finger it's a touch that lifts close to where it landed: a drag that
 * happens to start on the element, turning the camera or scrolling a list,
 * isn't a tap, and it fires on the lift rather than the landing, which also
 * works with another finger already on the stick, where a browser holds back
 * its click. With a mouse, a press, or a click inside a scrolling panel.
 *
 * Inside something that scrolls, pass it: the landing then leaves the scroll
 * alone, and a lift after the list has moved doesn't count.
 */
export function onTap(element: HTMLElement, action: () => void, scroller?: HTMLElement): void
{
	const SLOP = 12;
	let start: { id: number, x: number, y: number, scroll: number };

	element.addEventListener('touchstart', (event: TouchEvent) =>
	{
		// Only a list that scrolls needs the touch left to the browser
		if (scroller === undefined) event.preventDefault();
		event.stopPropagation();
		let touch = event.changedTouches[0];
		start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, scroll: scroller !== undefined ? scroller.scrollTop : 0 };
	}, { passive: scroller !== undefined });

	element.addEventListener('touchend', (event: TouchEvent) =>
	{
		if (start === undefined) return;
		let touch: Touch;
		for (let i = 0; i < event.changedTouches.length; i++)
		{
			if (event.changedTouches[i].identifier === start.id) touch = event.changedTouches[i];
		}
		if (touch === undefined) return;
		let moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > SLOP
			|| (scroller !== undefined && Math.abs(scroller.scrollTop - start.scroll) > 2);
		start = undefined;
		// Handled here, so the click the browser would make of it doesn't do it twice
		event.preventDefault();
		event.stopPropagation();
		if (!moved) action();
	}, { passive: false });

	element.addEventListener('touchcancel', () => start = undefined);

	if (scroller !== undefined)
	{
		element.addEventListener('click', (event) =>
		{
			event.stopPropagation();
			action();
		});
	}
	else
	{
		element.addEventListener('mousedown', (event) =>
		{
			event.preventDefault();
			event.stopPropagation();
			action();
		});
	}
}
