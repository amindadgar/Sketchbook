import * as THREE from 'three';
import { CityPlan, RoadNode, RoadSegment } from './CityPlan';
import { CityContext } from './CityContext';
/** A run of road between junctions, drawn as one continuous strip. */
export interface RoadChain {
    id: number;
    points: THREE.Vector3[];
    segments: RoadSegment[];
    startNode: RoadNode;
    endNode: RoadNode;
    halfWidth: number;
    kind: RoadSegment['kind'];
}
/** A signal head at a junction, facing traffic that arrives along `travel`. */
export interface SignalHead {
    node: number;
    /** The axis the traffic it faces is moving along. */
    axis: 'x' | 'z';
    travel: THREE.Vector3;
    lamps: THREE.Vector3[];
}
/**
 * Lays every road in the plan: strips with painted lanes, squares with zebra
 * crossings where they meet, and for the raised ones a deck on pillars with
 * barriers down the sides. Street lights line them and the junctions get
 * signals.
 */
export declare class RoadBuilder {
    private static readonly DECK;
    private static readonly BARRIER_HEIGHT;
    private static readonly BARRIER_WIDTH;
    private static readonly SEA_FLOOR;
    chains: RoadChain[];
    signals: SignalHead[];
    /** Every street light's foot, so nothing else is planted on top of one. */
    lampSpots: THREE.Vector3[];
    private context;
    private plan;
    constructor(context: CityContext, plan: CityPlan);
    build(): void;
    private passThrough;
    private makeChains;
    private trim;
    private static side;
    private buildChain;
    /**
     * Under a raised road: the deck's edges and underside, concrete barriers
     * along the top, and a collider that's the deck itself, turned to its
     * slope. Anything only a little off the ground is an embankment instead,
     * solid down to it.
     */
    private buildDeck;
    /** A column under a raised road, down to the ground or the sea bed. */
    private pillar;
    private streetLamp;
    /** A double-headed lamp down the middle of the highway. */
    private medianLamp;
    private buildJunction;
    /** One mast per road coming in, on the near right corner, arm out over its lanes. */
    private buildSignals;
}
