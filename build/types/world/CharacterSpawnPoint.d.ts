import { ISpawnPoint } from '../interfaces/ISpawnPoint';
import * as THREE from 'three';
import { World } from './World';
import { LoadingManager } from '../core/LoadingManager';
export declare class CharacterSpawnPoint implements ISpawnPoint {
    private object;
    constructor(object: THREE.Object3D);
    spawn(loadingManager: LoadingManager, world: World): void;
    /**
     * A scenario has one spawn point and a party would stand inside each other
     * on it, so each player is stepped a little way off it, in a direction of
     * their own. Only onto ground at about the same height with nothing in the
     * way, since a spawn point is placed where it is for a reason.
     */
    private spreadOut;
}
