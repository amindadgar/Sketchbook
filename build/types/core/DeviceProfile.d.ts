/**
 * What this device can afford.
 *
 * A phone runs the same scene as a desktop, at three times the pixel density
 * and a fraction of the power budget, so a few settings are asked for here
 * rather than hard coded. Everything is read from the media query rather than
 * from a user agent string, so a touch laptop with a mouse counts as a desktop.
 */
export declare class DeviceProfile {
    private static touch;
    static isTouch(): boolean;
    /**
     * A modern phone reports a device pixel ratio of 3, which asks the GPU for
     * nine times the fragments of a plain 1x buffer. Past about 1.5 the extra
     * detail is beyond what the screen shows anyway. Desktop is left alone.
     */
    static pixelRatio(): number;
    /** Three cascades at 2048 is a lot of depth rasterising for a handset. */
    static shadowMapSize(): number;
}
