import * as THREE from 'three';
import { ISpawnPoint } from '../interfaces/ISpawnPoint';
import { VehicleSpawnPoint } from './VehicleSpawnPoint';
import { World } from '../world/World';
import { LoadingManager } from '../core/LoadingManager';
export declare class Scenario {
    id: string;
    name: string;
    spawnAlways: boolean;
    default: boolean;
    world: World;
    descriptionTitle: string;
    descriptionContent: string;
    /**
     * The path node the computer drivers are pointed at, when there are any.
     * That ring of nodes is the track, so its presence is what makes a scenario
     * a race rather than anything written down about its name.
     */
    racePath: string;
    /** How many laps a race is, when it isn't the usual. */
    laps: number;
    private rootNode;
    private spawnPoints;
    private invisible;
    private initialCameraAngle;
    /** Spare party cars made this launch, by name, so one isn't made twice. */
    private partyExtras;
    /** Rows of spare cars behind the start, how far apart, and how far to either side. */
    private static readonly EXTRA_ROWS;
    private static readonly EXTRA_SPACING;
    private static readonly EXTRA_SIDE;
    /** How near another spawn point a spare car may be parked. */
    private static readonly EXTRA_CLEARANCE;
    constructor(root: THREE.Object3D, world: World);
    /** Lets a scenario be assembled in code rather than read out of the world file. */
    addSpawnPoint(spawnPoint: ISpawnPoint): void;
    createLaunchLink(): void;
    launch(loadingManager: LoadingManager, world: World): void;
    /** The car a single player starts in, if this scenario starts them in one. */
    playerVehicleSpawn(): VehicleSpawnPoint;
    /**
     * Races and stunts were built for one player: one car in the player's spot
     * and, in a race, a grid of computer drivers ahead of it. In a party every
     * member gets a car of their own instead of all of them being put in that
     * one.
     *
     * The grid is the player's spot and then the computer drivers' cars,
     * nearest first. Each member takes the place their id ranks at, lowest
     * first, and the computer only drives the cars nobody has. Past the end of
     * the grid, or where there's no grid at all, spare cars are parked in rows
     * behind the start, wherever there's ground for one. Every client works
     * this out the same way from the same roster and the same map, so the cars
     * and their names line up across the party. Someone who joins later is
     * given the next place, and the computer driver in it gets out.
     */
    private planPartyGrid;
    /** The player's spot, then the computer drivers' cars nearest to it first. */
    private gridOrder;
    /**
     * The n-th usable spot for a spare car, counting from one: rows behind the
     * start, the middle of each row first. Only ground at about the start's own
     * height, with a clear line to it from the start and no other vehicle's
     * spawn close by, will do. Judged against the map alone and never anything
     * that moves, so every client arrives at the same spots whenever it asks.
     */
    private extraSpawn;
    /**
     * Makes one of this launch's spare party cars that another member has and
     * this client doesn't, named as 'spawn+n'. They joined after this client
     * launched, so it didn't count them. False when the name isn't one of ours.
     */
    spawnPartyExtra(name: string, world: World): boolean;
    /** A player on foot next to the start, for when there's no car left for them. */
    private spawnBeside;
    /** Height of the fixed ground under a point, ignoring anything that moves. */
    private static groundBelow;
    /** Whether fixed scenery stands between two points, a metre off the ground. */
    private static staticHitBetween;
}
