/** A line in a panel: a thing to buy, a job to take. */
export interface PanelRow {
    title: string;
    /** A line under the title: what it is, what it pays. */
    detail?: string;
    /** Along the right: a price, a pay range. */
    aside?: string;
    /** The button, if there is one. */
    button?: string;
    enabled?: boolean;
    /** Picked out: the gun in hand, the job running. */
    highlight?: boolean;
    onClick?: () => void;
}
/**
 * The one panel at a time that the shops, the dealership and the job board
 * open in the middle of the screen: a title, a line of context, and rows with
 * a button each. The mouse is let go while it's open, so the buttons can be
 * clicked; the number keys press them too, and Esc or walking away closes it.
 */
export declare class Panel {
    private static root;
    private static rows;
    private static onClose;
    private static keyHandler;
    static get isOpen(): boolean;
    static open(title: string, subtitle: string, rows: PanelRow[], onClose?: () => void): void;
    /** New rows and a new line of context, for a panel that's already open. */
    static refresh(subtitle: string, rows: PanelRow[]): void;
    static close(): void;
    private static fill;
    private static press;
    private static ensure;
}
