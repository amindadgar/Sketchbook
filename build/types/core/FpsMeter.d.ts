/**
 * Frames per second, as a number in the corner, green when it's smooth,
 * amber when it's playable and red when it isn't.
 *
 * Counted over half a second at a time rather than from each frame's length,
 * so it holds still long enough to read and a single hitch doesn't flash it.
 */
export declare class FpsMeter {
    private static readonly WINDOW;
    private badge;
    private number;
    private frames;
    private since;
    private worst;
    private last;
    /** Start counting afresh on the next frame: the first one, and the first after the tab was hidden. */
    private restart;
    constructor();
    setVisible(visible: boolean): void;
    /** Called once for every frame drawn. */
    frame(): void;
}
