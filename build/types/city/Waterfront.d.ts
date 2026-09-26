import * as THREE from 'three';
import { CityPlan } from './CityPlan';
import { CityContext } from './CityContext';
/**
 * The land the city stands on and where it meets the sea: grass under
 * everything, rock revetments round most of the shore, a beach and a
 * boardwalk along the east side facing the island, and a working harbour in
 * the north east with quays, piers, cranes and stacked containers.
 */
export declare class Waterfront {
    /** Where the sand starts and how far out it runs, sloping into the sea. */
    static readonly BEACH: {
        promenadeWest: number;
        sandWest: number;
        sandEast: number;
        sandTop: number;
        sandBottom: number;
        north: number;
        south: number;
    };
    static readonly HARBOR: {
        west: number;
        east: number;
        north: number;
        south: number;
    };
    private context;
    private plan;
    private m;
    private random;
    spawnSpots: {
        position: THREE.Vector3;
        facing: THREE.Vector3;
    }[];
    constructor(context: CityContext, plan: CityPlan);
    build(): void;
    /**
     * Grass over the whole plot, pushed back in the depth buffer so every road
     * and pavement drawn on it wins without being lifted off it, and one big
     * collider under it all.
     */
    private land;
    /** Rock armour sloping into the sea along the west, north and south shores. */
    private revetments;
    /**
     * The boardwalk along the coast road and the sand below it, which runs
     * down under the water so the shore line is wherever the sea says it is.
     */
    private beach;
    /** The quay between the coast road and the water north of the beach, with its piers. */
    private harbor;
    /** Along the north shore past the ring road, under the viaduct, more docks. */
    private northQuay;
    /** Rows of stacked shipping containers in the usual colours. */
    private containers;
    private containerMaterialCache;
    private containerMaterial;
    /** A dockside gantry crane, portal legs straddling the quay and a jib out over the water. */
    private crane;
    /** A timber pier on piles, running out from the shore. */
    private pier;
    /**
     * Two towers holding the bridge up, with cables fanned down to the deck.
     * They stand clear of the roadway, so they're scenery to drive past.
     */
    private bridgeTowers;
}
