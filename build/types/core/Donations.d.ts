/** Where the code lives, for the support card, the phone and the pause menu. */
export declare const GITHUB_URL: string;
export interface DonationWallet {
    /** What to send, as people know it: Bitcoin, USDT. */
    coin: string;
    /** Which chain it goes over, when the coin lives on more than one: TRC-20, ERC-20. */
    network?: string;
    address: string;
}
/**
 * Crypto addresses donations can go to, in the order they're shown. One
 * without an address yet is shown as coming soon rather than left out, so
 * the card still says there will be a way to give. Add a line per wallet.
 */
export declare const DONATION_WALLETS: DonationWallet[];
/** What the support card, the phone and the pause menu ask. */
export declare const DONATION_ASK: string;
