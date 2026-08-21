export declare class UIManager {
    static setUserInterfaceVisible(value: boolean): void;
    static setLoadingScreenVisible(value: boolean): void;
    static setFPSVisible(value: boolean): void;
    static setSpeedometerVisible(value: boolean): void;
    /** @param fill 0 at a standstill, 1 at the vehicle's top speed. */
    static setSpeedometerFill(fill: number): void;
}
