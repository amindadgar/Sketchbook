import * as THREE from 'three';
import { World } from '../world/World';
import { City } from '../city/City';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Blip } from '../core/Minimap';
import { Vehicle } from '../vehicles/Vehicle';
export type ShopKind = 'guns' | 'repair' | 'dealer';
export interface ShopSite {
    kind: ShopKind;
    name: string;
    /** Where to stand, or for the garage, the middle of the bay to stop in. */
    position: THREE.Vector3;
    /** Out of the shop towards the street. */
    facing: THREE.Vector3;
    /** How close counts as there. */
    reach: number;
    blip: Blip;
    marker: THREE.Object3D;
}
/**
 * Where money gets spent: two gun shops on the pavement, a garage to drive into
 * and have the car put right, and a dealership lot.
 *
 * Every client finds the same places, picked from the city plan, which is
 * the same everywhere. Each has a sign on the building, a ring on the ground
 * where to stand, and a mark on the map. Stand in the ring and E opens it.
 */
export declare class ShopSystem implements IUpdatable {
    updateOrder: number;
    /** Where the two gun shops go, as points the nearest street spot is found for. */
    private static readonly GUN_SHOPS;
    /** The garage and the dealership take the open lots nearest these. */
    private static readonly GARAGE_NEAR;
    static readonly DEALER_NEAR: THREE.Vector2;
    private static readonly COLORS;
    sites: ShopSite[];
    /** The dealership lot, for vehicles bought to be put in. */
    dealerLot: {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
    };
    private world;
    private city;
    private open;
    private time;
    private dealer;
    constructor(world: World, city: City);
    /** The dealership's counter is somebody else's to fill. */
    setDealer(open: (site: ShopSite) => void): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    private drivenVehicle;
    private openShop;
    private closeShop;
    private showGuns;
    private gunRow;
    private offerRepair;
    /** Forty for looking, then eight a point of damage. */
    static repairPrice(vehicle: Vehicle): number;
    /**
     * The spot on the pavement nearest a point in front of a building, and the
     * way into the building from it. Jobs use it for shops of their own.
     */
    storefrontSpot(near: THREE.Vector2, zones?: string[]): {
        position: THREE.Vector3;
        inward: THREE.Vector3;
    };
    /** A shop front on the pavement nearest a point, on a block with a building on it. */
    private addStorefront;
    /** A bay painted on an open lot to drive into, with a sign on a post. */
    private addGarage;
    /** A counter at the corner of an open lot, where bought vehicles are left. */
    private addDealer;
    private addSite;
    blockAt(p: THREE.Vector3): {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
        zone: string;
    };
    /** The lot of the open parking block nearest a point, inside its pavement. */
    lotNear(near: THREE.Vector2): {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
    };
    /** A glowing ring on the ground to stand in. */
    static ring(color: string, radius: number): THREE.Object3D;
    /** An outlined rectangle on the ground to drive into. */
    static bay(color: string, width: number, length: number): THREE.Object3D;
    /** A lit sign: the name, and what's sold underneath. Readable at night too. */
    static sign(name: string, line: string, color: string): THREE.Mesh;
}
