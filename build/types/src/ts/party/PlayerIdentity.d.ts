/**
 * Who the local player is: the name shown above their character and the
 * colour their body and their car get tinted with.
 */
export declare class PlayerIdentity {
    /** Kept for anything that just wants a colour, unlocked or not. */
    static readonly PALETTE: string[];
    private static readonly STORAGE_KEY;
    name: string;
    color: string;
    /** Which hat, from the ones the account has earned. */
    hat: string;
    constructor(name?: string, color?: string, hat?: string);
    /** Restores the last used name and colour, so a reload doesn't reset them. */
    static load(): PlayerIdentity;
    static randomColor(): string;
    private static sanitizeName;
    private static sanitizeColor;
    save(): void;
    set(name: string, color: string, hat?: string): void;
}
