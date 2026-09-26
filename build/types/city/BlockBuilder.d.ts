import * as THREE from 'three';
import { CityPlan } from './CityPlan';
import { CityContext } from './CityContext';
interface Rect {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}
/**
 * Fills the city blocks: a raised pavement round each one, and whatever its
 * zone puts inside. Downtown gets towers on podiums, midtown a street wall of
 * shops with flats and offices over them, the outskirts apartment blocks round
 * courtyards or streets of houses, the harbour warehouses, and a few blocks
 * are left as a park, a plaza or a car park.
 *
 * Everything comes off a seeded generator per block, so every client builds
 * the same buildings in the same places.
 */
export declare class BlockBuilder {
    private context;
    private plan;
    private m;
    private random;
    /** Where the street lights went, so trees don't grow through them. */
    private lampSpots;
    /** Where people can stand on the pavements, for the pedestrians. */
    walkways: Rect[];
    spawnSpots: {
        position: THREE.Vector3;
        facing: THREE.Vector3;
    }[];
    private static readonly STUCCO;
    private static readonly CONCRETE;
    private static readonly METAL;
    constructor(context: CityContext, plan: CityPlan, lampSpots: THREE.Vector3[]);
    build(): void;
    private inset;
    private between;
    private pick;
    private get top();
    /** Whether the highway's rounded corner runs through a block, which then isn't built on. */
    private cutByRing;
    /** The scrap of grass inside a highway bend: a few trees, nothing else. */
    private leftover;
    private nearRing;
    /** The raised slab a block stands on: paving on top, a kerb round the edge. */
    private pavement;
    /** Street trees, hydrants and bins along a block's pavements. */
    private streetside;
    private tree;
    private palm;
    /** Things a car goes through rather than stopping against, and how heavy each is. */
    private static readonly BREAKABLE_PROPS;
    private prop;
    /**
     * A box of a building standing on the pavement. Walls get windows by
     * style, the top a gravel roof inside a parapet, and optionally a cornice,
     * rooftop plant and a gabled roof.
     */
    private building;
    /** A pitched roof along the longer side, tiles on the slopes and wall in the ends. */
    private gable;
    private tintFrom;
    /** Height scale: everything gets taller toward the middle of downtown. */
    private centrality;
    private downtown;
    private midtown;
    private residential;
    /** Four blocks of flats round a green courtyard. */
    private apartments;
    /** A street of detached houses with front gardens. */
    private houses;
    /** Sheds for the docks: big, plain, and mostly shut. */
    private harbor;
    private plaza;
    private parkingLot;
    /** Grass, paths round and across, a pond, and plenty of trees. */
    private park;
}
export {};
