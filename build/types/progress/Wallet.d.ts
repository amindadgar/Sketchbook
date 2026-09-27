import { World } from '../world/World';
/** A vehicle bought at the dealership: which model, and what colour it was ordered in. */
export interface OwnedVehicle {
    model: string;
    color: number;
}
/**
 * Money, and what it has bought.
 *
 * Kept in the browser like experience is: the jobs that pay it are played out
 * on this screen, and nothing on the server could check that a fare was really
 * driven. Guns bought stay bought through a death, vehicles bought can be had
 * back from the dealership's lot for nothing.
 */
export declare class Wallet {
    private static readonly STORAGE_KEY;
    /** Enough for a pistol and a tank of patience. */
    static readonly STARTING_CASH: number;
    /** A share of what's carried, lost on dying: the hospital's bill. */
    private static readonly DEATH_SHARE;
    private static readonly DEATH_MAX;
    private world;
    private state;
    private dirty;
    private sinceSave;
    private shown;
    constructor(world: World);
    get cash(): number;
    /** Everything ever paid out, for the stats panel. */
    get earned(): number;
    get guns(): string[];
    get vehicles(): OwnedVehicle[];
    /** Paid for something. The reason goes under the amount in the notice. */
    add(amount: number, reason?: string): void;
    canAfford(amount: number): boolean;
    /** Takes it if it's there. False, and nothing taken, when it isn't. */
    spend(amount: number): boolean;
    /** Takes up to an amount without complaint, for losses rather than purchases. Returns what was taken. */
    lose(amount: number): number;
    /** The hospital's share of what was carried. Returns what it came to. */
    payHospital(): number;
    ownsGun(id: string): boolean;
    addGun(id: string): void;
    addVehicle(vehicle: OwnedVehicle): void;
    ownsVehicle(model: string): boolean;
    update(unscaledTimeStep: number): void;
    static format(amount: number): string;
    private refresh;
    private load;
    private save;
    private write;
}
