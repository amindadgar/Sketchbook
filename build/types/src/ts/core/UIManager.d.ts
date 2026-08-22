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
    /**
     * What is happening while the player is down. Undefined takes it away.
     * The watched name comes off the network, so it goes in as text.
     */
    static setDeathNotice(seconds: number, watching?: string): void;
    /** Names and messages come off the network, so both are written as text. */
    static addChatLine(name: string, color: string, text: string, keep: number): void;
    static setChatVisible(value: boolean): void;
    /** Time left in the round, above the scoreboard. Undefined hides it. */
    static setMatchClock(text: string): void;
    /** Names come off the network, so they're written as text, never as HTML. */
    static setMatchResult(rows: {
        name: string;
        color: string;
        score: number;
    }[]): void;
    static setRaceVisible(value: boolean): void;
    static setRaceHud(lap: number, laps: number, place: number, field: number, time: string, best: string): void;
    /** The starting lights, and 'GO'. Undefined takes them away. */
    static setRaceCountdown(text: string): void;
    static setRaceResult(place: number, field?: number, total?: string, best?: string): void;
    private static ordinal;
    static toggleSettings(): void;
    static setPartyVisible(value: boolean): void;
    /** Names come off the network, so they're written as text nodes, never as HTML. */
    static setPartyDetails(code: string, names: string[], colors: string[]): void;
    static setSpeedometerVisible(value: boolean): void;
    /** @param fill 0 at a standstill, 1 at the vehicle's top speed. */
    static setSpeedometerFill(fill: number, speed: number): void;
}
