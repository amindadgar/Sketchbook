export declare class UIManager {
    static setUserInterfaceVisible(value: boolean): void;
    static setLoadingScreenVisible(value: boolean): void;
    static setFPSVisible(value: boolean): void;
    /** @param health 0 to 1. Weapon name undefined means empty handed. */
    static setCombatHud(health: number, weapon: string, ammo: number, reserve: number): void;
    /** Names come off the network, so they're written as text, never as HTML. */
    static setScoreboard(names: string[], colors: string[], scores: number[]): void;
    static setReticleVisible(value: boolean): void;
    /**
     * The four ticks that say a shot landed. Restarted rather than merely shown,
     * so a burst reads as several hits instead of one long one.
     */
    static flashHitMarker(): void;
    static toggleSettings(): void;
    static setPartyVisible(value: boolean): void;
    /** Names come off the network, so they're written as text nodes, never as HTML. */
    static setPartyDetails(code: string, names: string[], colors: string[]): void;
    static setSpeedometerVisible(value: boolean): void;
    /** @param fill 0 at a standstill, 1 at the vehicle's top speed. */
    static setSpeedometerFill(fill: number, speed: number): void;
}
