export interface AccountProfile {
    id: number;
    username: string;
    kills: number;
    deaths: number;
    played: number;
    /** Google sign-in is on the account. */
    google?: boolean;
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
    /** The party server the session belongs to: where its progress is kept. */
    static server: string;
    /** Told when somebody signs in, or a stored session is picked back up. */
    static onSignIn: ((profile: AccountProfile) => void)[];
    static onSignOut: (() => void)[];
    /** Goes up with every sign-in and sign-out, so a slow answer about an older session can tell it's stale. */
    private static generation;
    static get signedIn(): boolean;
    /** The accounts API sits on the party server, over http rather than ws. */
    static httpBase(serverUrl: string): string;
    static loadToken(): string;
    static signOut(): void;
    static register(server: string, username: string, password: string): Promise<AccountProfile>;
    static login(server: string, username: string, password: string): Promise<AccountProfile>;
    /** Picks up an existing session, and refreshes the tallies while it's there. */
    static resume(server: string): Promise<AccountProfile>;
    /** What the server offers besides a name and password: the Google client id, if Google sign-in is on. */
    static config(server: string): Promise<{
        google: string;
    }>;
    /**
     * Signs in with what Google's button handed back. Signed in already, it
     * puts Google sign-in on that account instead, when link is asked for.
     */
    static google(server: string, credential: string, link?: boolean): Promise<AccountProfile>;
    /** A new personal best, for the per track boards. Ignored when not signed in. */
    static submitLap(server: string, track: string, milliseconds: number): Promise<void>;
    static leaderboard(server: string, track?: string): Promise<any[]>;
    private static post;
    /** A token and a user from the server: signed in, kept for next time, and everyone told. */
    private static accept;
    /** Turns the server's error shape into a rejection carrying its message. */
    private static unwrap;
}
