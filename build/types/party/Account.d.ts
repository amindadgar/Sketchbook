export interface AccountProfile {
    id: number;
    username: string;
    kills: number;
    deaths: number;
    played: number;
}
/**
 * Talks to the accounts endpoints on the party server.
 *
 * The token is kept in local storage and sent when joining a party, which is
 * how kills end up attached to a name rather than to whoever happened to be
 * holding a colour that evening.
 */
export declare class Account {
    private static readonly STORAGE_KEY;
    static token: string;
    static profile: AccountProfile;
    static get signedIn(): boolean;
    /** The accounts API sits on the party server, over http rather than ws. */
    static httpBase(serverUrl: string): string;
    static loadToken(): string;
    static signOut(): void;
    static register(server: string, username: string, password: string): Promise<AccountProfile>;
    static login(server: string, username: string, password: string): Promise<AccountProfile>;
    /** Picks up an existing session, and refreshes the tallies while it's there. */
    static resume(server: string): Promise<AccountProfile>;
    private static post;
    /** Turns the server's error shape into a rejection carrying its message. */
    private static unwrap;
}
