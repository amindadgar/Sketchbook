import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { LoadingManager } from '../core/LoadingManager';
import { CityPlan } from './CityPlan';
import { CityMaterials } from './CityMaterials';
import { CityContext } from './CityContext';
import { StreetFurniture } from './StreetFurniture';
import { RoadBuilder } from './RoadBuilder';
import { BlockBuilder } from './BlockBuilder';
import { Waterfront } from './Waterfront';
import { Breakables } from './Breakables';
export type SignalLight = 'green' | 'yellow' | 'red';
/**
 * The city on the mainland: built once when the world loads, identically on
 * every client, and then mostly left alone. What it does each frame is run
 * the traffic lights and turn the lights on when it gets dark.
 */
export declare class City implements IUpdatable {
    updateOrder: number;
    /** One cycle of the lights: green one way, amber, all red, then the other way. */
    static readonly GREEN: number;
    static readonly AMBER: number;
    static readonly ALL_RED: number;
    plan: CityPlan;
    materials: CityMaterials;
    context: CityContext;
    roads: RoadBuilder;
    blocks: BlockBuilder;
    waterfront: Waterfront;
    furniture: StreetFurniture;
    /** Lamps, signals and pavement clutter a car knocks over. */
    breakables: Breakables;
    /** Places on a pavement to start from, spread over the whole city. */
    spawnSpots: {
        position: THREE.Vector3;
        facing: THREE.Vector3;
    }[];
    private world;
    private lenses;
    private lensStates;
    private lensMatrices;
    private clock;
    private night;
    private cullTimer;
    private static readonly LENS_COLORS;
    constructor(world: World, loadingManager: LoadingManager);
    update(timeStep: number, unscaledTimeStep: number): void;
    /** Keeps the lights in step with whatever clock the party agrees on. */
    setClock(seconds: number): void;
    /**
     * What the lights show to traffic moving along an axis at a junction.
     * Junctions are offset from each other by where they are, so the city
     * doesn't change all at once, and the offset follows the grid so there's
     * a green wave down the avenues at a steady speed.
     */
    signalFor(node: number, axis: 'x' | 'z'): SignalLight;
    private buildLenses;
    /** A knocked down signal's lights go with it. */
    private setLensesHidden;
    private updateLenses;
    private addScenarios;
    private spawn;
    /**
     * Downtown, on the pavement of the street through the middle of it, with
     * a car parked at the kerb beside you.
     */
    private addFreeRoam;
    /**
     * Once round the ring road and down the coast, against a grid of
     * computer drivers, starting just south of the bridge.
     */
    private addRace;
    /** Nearest pavement spot to a point, for putting someone back somewhere sensible. */
    nearestSpawn(to: THREE.Vector3): THREE.Vector3;
    /** Whether a point is over the city's land, rather than the sea or the island. */
    static onLand(x: number, z: number): boolean;
}
