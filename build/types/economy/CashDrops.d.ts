import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * Money lying on the ground: a mugged pedestrian's wallet, a cash bag out of
 * a security van, what a player dropped when they died. Walk over it, or
 * drive over it, and it's yours.
 *
 * A drop made on this screen is this screen's. A dead player's is the
 * party's: the relay numbers it and tells everyone where it is, and whoever
 * asks for it first gets it, the relay deciding, so two players can't both
 * pick up the same money.
 */
export declare class CashDrops implements IUpdatable {
    updateOrder: number;
    private static geometry;
    private static material;
    private static glowMaterial;
    private world;
    private drops;
    private time;
    private generation;
    constructor(world: World);
    /** Money on the ground here, for this player alone. What comes back can take it away again. */
    drop(position: THREE.Vector3, amount: number, reason: string, life?: number, onTaken?: () => void): object;
    /** Gone, if it's still there: a job's loot once the job is over. */
    take(handle: object): void;
    /** A drop the relay has told everyone about. */
    networkDrop(id: number, position: THREE.Vector3, amount: number): void;
    /** The relay says somebody got it. The money's theirs if they're us. */
    networkTaken(id: number, byMe: boolean): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    /** Everything on the ground, gone: for a relaunch. */
    clear(): void;
    private add;
    private remove;
    /** A stack of notes with a band round it and a green glow, bigger for more. */
    private static model;
}
