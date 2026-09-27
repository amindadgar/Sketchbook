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
export declare function onTap(element: HTMLElement, action: () => void, scroller?: HTMLElement): void;
