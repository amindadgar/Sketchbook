import { World } from '../world/World';
import { DonationWallet } from './Donations';
/** One line of controls: the keys, and what they do. */
export interface ControlRow {
    keys: string[];
    desc: string;
}
/**
 * What the phone and the pause menu both show: the controls, how the player
 * is getting on, and how to support the game. Built as DOM rather than HTML
 * strings, since the player's name and the challenges end up in it.
 */
export declare class GameInfo {
    /** Whatever works wherever the player is, listed after what works here. */
    static readonly EVERYWHERE: ControlRow[];
    /** A phone has no keys; around the buttons, which change with what the player's doing, are these. */
    static readonly TOUCH_AROUND: ControlRow[];
    static readonly TOUCH_ANYWHERE: ControlRow[];
    /** Words that join keys, written between the key caps rather than as one. */
    private static readonly JOINERS;
    /** The keys for here, then the ones for everywhere; on a phone, the buttons on screen now. */
    static renderControls(into: HTMLElement, world: World): void;
    /** Level and experience, money, and today's three. */
    static renderStats(into: HTMLElement, world: World): void;
    /** The code, and a way to give. Wallets not filled in yet say they're coming. */
    static renderSupport(into: HTMLElement): void;
    /** A wallet's name as it's written in a list: the coin, and the chain if it has one. */
    static walletName(wallet: DonationWallet): string;
    /**
     * An address onto the clipboard. The clipboard wants a secure page and a
     * gesture; failing either, the address is at least selected for copying.
     */
    static copy(text: string, fallback?: HTMLElement): Promise<boolean>;
    /** GitHub's mark, drawn rather than fetched. */
    static githubMark(): SVGElement;
    private static walletCard;
    private static controlRow;
    private static bar;
    private static heading;
    private static element;
    private static clear;
}
