/** Where the code lives, for the support card, the phone and the pause menu. */
export const GITHUB_URL: string = 'https://github.com/amindadgar/Sketchbook';

export interface DonationWallet
{
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
export const DONATION_WALLETS: DonationWallet[] = [
	// One address takes ETH and tokens on Ethereum and the chains that work like it
	{ coin: 'ETH and tokens', network: 'any EVM chain', address: '0x0aDBcdE5D51DE9497db2761cfe84666fCCe881cB' },
];

/** What the support card, the phone and the pause menu ask. */
export const DONATION_ASK: string = 'Sketchbook is free and open source. If you\'re enjoying it, please donate:'
	+ ' it supports the development and keeps the game running for everyone.';
