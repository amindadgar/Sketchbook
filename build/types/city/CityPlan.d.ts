import * as THREE from 'three';
import { mulberry32 } from '../core/FunctionLibrary';
/**
 * Where everything in the city goes, worked out once and the same on every
 * client, since a party has to be standing in the same streets.
 *
 * The world is built at the boxman's scale: a person is one unit tall, which
 * makes a real metre about 0.58 of a unit. Everything here is in those units.
 *
 * The city sits on the mainland to the west of the island, joined to it by a
 * bridge. Avenues run north to south, streets east to west, and a coastal
 * highway rings the lot, lifted onto a viaduct past the harbour.
 */
export { mulberry32 };
export type Zone = 'downtown' | 'midtown' | 'residential' | 'park' | 'harbor' | 'parking' | 'plaza';
export interface Block {
    index: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    zone: Zone;
    seed: number;
}
/** A straight stretch of road between two nodes, drawn with markings. */
export interface RoadSegment {
    id: number;
    kind: 'avenue' | 'street' | 'boulevard' | 'highway' | 'bridge';
    /** Centreline ends, with height. */
    a: THREE.Vector3;
    b: THREE.Vector3;
    lanes: number;
    laneWidth: number;
    /** Painted median between the two directions; zero is a double yellow line. */
    median: number;
    /** Parking strip each side, beyond the outer lane. */
    parking: number;
    /** Graph node ids at each end. */
    from: number;
    to: number;
    /** Concrete barriers down the edges, for anything raised. */
    barriers: boolean;
    elevated: boolean;
}
export interface RoadNode {
    id: number;
    position: THREE.Vector3;
    /** Crossing of two or more roads, which gets a paved square and lights. */
    junction: boolean;
    segments: number[];
    signals: boolean;
    /** Half extents of the paved square, along x and z. */
    halfX: number;
    halfZ: number;
}
export declare function roadWidth(segment: {
    lanes: number;
    laneWidth: number;
    median: number;
    parking: number;
}): number;
export declare class CityPlan {
    static readonly METRE: number;
    static readonly GROUND: number;
    static readonly CURB: number;
    static readonly SIDEWALK: number;
    static readonly FLOOR: number;
    /** Land edges. The sea is everywhere else. */
    static readonly LAND: {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
    };
    /** Avenues, west of the coast road, and streets, north to south. */
    static readonly OCEAN_X: number;
    static readonly AVENUES: number[];
    static readonly STREETS: number[];
    /** The highway ring's legs. The east side of the loop is the coast road. */
    static readonly RING_WEST: number;
    static readonly RING_NORTH: number;
    static readonly RING_SOUTH: number;
    static readonly RING_RADIUS: number;
    /** The north leg climbs onto a viaduct past the harbour. */
    static readonly VIADUCT: {
        rampStart: number;
        top: number;
        topEnd: number;
        rampEnd: number;
        height: number;
    };
    /** The bridge to the island leaves the coast road on this street. */
    static readonly BRIDGE_Z: number;
    static readonly BRIDGE_END_X: number;
    /** Where the island's walls are, on the side the bridge comes in. */
    static readonly ISLAND_EDGE: number;
    static readonly ISLAND_RIM: number;
    static readonly DOWNTOWN: THREE.Vector2;
    /**
     * Where a game starts: downtown, on the north pavement of the street through
     * the middle, a step in from its kerb (the street is eight units across).
     */
    static readonly START: THREE.Vector3;
    /** The park takes two blocks by two, and the roads between them. */
    static readonly PARK: {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
    };
    static readonly AVENUE: {
        lanes: number;
        laneWidth: number;
        median: number;
        parking: number;
    };
    static readonly OCEAN: {
        lanes: number;
        laneWidth: number;
        median: number;
        parking: number;
    };
    static readonly STREET: {
        lanes: number;
        laneWidth: number;
        median: number;
        parking: number;
    };
    static readonly HIGHWAY: {
        lanes: number;
        laneWidth: number;
        median: number;
        parking: number;
    };
    static readonly BRIDGE: {
        lanes: number;
        laneWidth: number;
        median: number;
        parking: number;
    };
    blocks: Block[];
    nodes: RoadNode[];
    segments: RoadSegment[];
    /** The loop a race follows: ring highway and coast road, clockwise from the bridge. */
    loop: THREE.Vector3[];
    constructor();
    private nodeAt;
    private addSegment;
    private inPark;
    private layRoads;
    /** Quarter circle of highway, centre (cx, cz), from the given angle, in eight pieces. */
    private addCorner;
    /** Height of the viaduct deck above the ground at a point on the north leg. */
    viaductHeight(x: number): number;
    /** The bridge climbs in a straight line from the coast road to the island's rim. */
    bridgeHeight(x: number): number;
    private layBlocks;
    /** Half the width of whatever road runs along a grid line. */
    private halfWidthAt;
    private zoneFor;
    /** A clockwise circuit of the ring and the coast road, for the race. */
    private layLoop;
    private viaductOrZero;
}
