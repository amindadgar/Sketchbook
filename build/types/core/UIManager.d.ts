export declare class UIManager {
    static setUserInterfaceVisible(value: boolean): void;
    static setLoadingScreenVisible(value: boolean): void;
    static setFPSVisible(value: boolean): void;
    static setPartyVisible(value: boolean): void;
    /** Names come off the network, so they're written as text nodes, never as HTML. */
    static setPartyDetails(code: string, names: string[], colors: string[]): void;
    static setSpeedometerVisible(value: boolean): void;
    /** @param fill 0 at a standstill, 1 at the vehicle's top speed. */
    static setSpeedometerFill(fill: number): void;
}
