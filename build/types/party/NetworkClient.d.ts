export interface PlayerInfo {
    id: number;
    name: string;
    color: string;
    score?: number;
}
/**
 * Thin wrapper over the relay's WebSocket protocol. It knows the message
 * shapes and nothing about the game, so the world can stay unaware of sockets.
 */
export declare class NetworkClient {
    static readonly DEFAULT_URL: string;
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
    onError: (message: string) => void;
    onDisconnect: () => void;
    private socket;
    static loadUrl(): string;
    static saveUrl(url: string): void;
    /** Resolves once the socket is open, rejects with a readable reason. */
    connect(url: string): Promise<void>;
    createRoom(name: string, color: string, scenario: string): void;
    joinRoom(code: string, name: string, color: string): void;
    send(message: any): void;
    disconnect(): void;
    private handleMessage;
}
