export interface PlayerInfo {
    id: number;
    name: string;
    color: string;
    hat?: string;
    score?: number;
}
/**
 * Thin wrapper over the relay's WebSocket protocol. It knows the message
 * shapes and nothing about the game, so the world can stay unaware of sockets.
 */
export declare class NetworkClient {
    /** The relay that ships alongside the hosted game. */
    static readonly DEPLOYED_URL: string;
    static readonly LOCAL_URL: string;
    private static readonly STORAGE_KEY;
    id: number;
    code: string;
    connected: boolean;
    onJoined: (code: string, id: number, players: PlayerInfo[], scenario: string) => void;
    onPlayerJoin: (info: PlayerInfo) => void;
    onPlayerLeave: (id: number) => void;
    onPlayerState: (message: any) => void;
    onVehicleState: (message: any) => void;
    onIdentity: (info: PlayerInfo) => void;
    onScenario: (id: string) => void;
    onShot: (message: any) => void;
    onHit: (message: any) => void;
    onScore: (id: number, score: number) => void;
    onMatch: (message: any) => void;
    onChat: (message: any) => void;
    onDeath: (message: any) => void;
    onError: (message: string) => void;
    onDisconnect: () => void;
    private socket;
    static loadUrl(): string;
    /**
     * Guesses the relay from where the page itself came from, so the field is
     * already right however the game is being run and nobody has to be told an
     * address. Typing over it still wins, and what's typed is remembered.
     */
    static defaultUrl(): string;
    /** Whatever config.js declared, if anything. */
    private static configuredUrl;
    private static isPrivateAddress;
    static saveUrl(url: string): void;
    /** Resolves once the socket is open, rejects with a readable reason. */
    connect(url: string): Promise<void>;
    createRoom(name: string, color: string, hat: string, scenario: string, token: string): void;
    joinRoom(code: string, name: string, color: string, hat: string, token: string): void;
    send(message: any): void;
    disconnect(): void;
    private handleMessage;
}
