/**
 * Top left, where the GitHub corner used to be: a heart that opens a card
 * with the code and the ways to donate. Esc or a click anywhere else puts it
 * away. With the mouse held by the game it can't be clicked, but the pause
 * menu has the same card.
 */
export declare class SupportButton {
    private button;
    private card;
    private body;
    constructor();
    get isOpen(): boolean;
    open(): void;
    close(): void;
    toggle(): void;
    private build;
}
