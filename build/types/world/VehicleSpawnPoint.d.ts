import * as THREE from 'three';
import { ISpawnPoint } from '../interfaces/ISpawnPoint';
import { World } from '../world/World';
import { LoadingManager } from '../core/LoadingManager';
export declare class VehicleSpawnPoint implements ISpawnPoint {
    type: string;
    driver: string;
    firstAINode: string;
    /** For a vehicle added in the middle of a game, where there's no loading screen to go through. */
    private static loader;
    private object;
    constructor(object: THREE.Object3D);
    /** What the vehicle is known by across a party: the spawn point's name. */
    get name(): string;
    getWorldPosition(target: THREE.Vector3): THREE.Vector3;
    getWorldQuaternion(target: THREE.Quaternion): THREE.Quaternion;
    /**
     * 'driver' overrides the one the world file gives, for this launch only:
     * null for an empty car, which is how a party takes over the seats the
     * computer drivers would otherwise have. Without a loading manager the
     * model is fetched quietly, for a car turning up mid game.
     */
    spawn(loadingManager: LoadingManager, world: World, driver?: string): void;
    private getNewVehicleByType;
}
