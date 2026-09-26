import * as THREE from 'three';
import { City } from '../city/City';
import { RoadNode } from '../city/CityPlan';
/** A path something can follow: points, and how far along each is. */
export declare class Route {
    id: number;
    points: THREE.Vector3[];
    lengths: number[];
    length: number;
    constructor(id: number, points: THREE.Vector3[]);
    /** Position and heading at a distance along the route. */
    sample(distance: number, position: THREE.Vector3, direction?: THREE.Vector3): THREE.Vector3;
}
/** One lane of one road, one way, with where it can lead. */
export declare class Lane extends Route {
    next: Lane[];
    /** Junction at the far end, if any, and the axis traffic arrives along. */
    endNode: RoadNode;
    axis: 'x' | 'z';
    speed: number;
    /** A curve across a junction rather than a stretch of road. */
    turn: boolean;
    /** Whether the lane after this one is across a junction with lights. */
    signalled: boolean;
    /** Joins a bigger road without lights, so it stops and looks first. */
    giveWay: boolean;
}
/** A loop of pavement round a block, and crossings off its corners. */
export declare class Walk extends Route {
    /** Crossings starting at each corner of the loop, by corner index. */
    crossings: {
        [corner: number]: Crossing[];
    };
    /** Distance along the loop of each corner. */
    corners: number[];
}
export declare class Crossing extends Route {
    to: Walk;
    toCorner: number;
    /** Where on the walk it arrives, when that isn't a corner: a driver's dash for the pavement. */
    toDistance: number;
    /** The junction it crosses at, and which way the traffic it crosses moves. */
    node: RoadNode;
    trafficAxis: 'x' | 'z';
}
/**
 * Where the city's people and cars can go, worked out from the roads and
 * blocks: a loop of pavement round every block with crossings between them at
 * the junctions, and every lane of every road with the turns that join them.
 */
export declare class Navigation {
    /** In from the kerb that people walk, clear of the trees and lamps and short of the buildings. */
    private static readonly WALK_INSET;
    lanes: Lane[];
    walks: Walk[];
    private city;
    private routeId;
    constructor(city: City);
    private buildLanes;
    private static startDirection;
    private static endDirection;
    /** A line moved sideways by an offset to the right of its direction, mitred at the bends. */
    static offsetLine(points: THREE.Vector3[], offset: number, lift: number): THREE.Vector3[];
    /** Across a junction: a curve leaving along one direction and arriving along another. */
    private static curve;
    private buildWalks;
    private junctionBetween;
}
