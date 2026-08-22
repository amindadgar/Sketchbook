import { ISpawnPoint } from '../interfaces/ISpawnPoint';
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
    private rootNode;
    private spawnPoints;
    private invisible;
    private initialCameraAngle;
    constructor(root: THREE.Object3D, world: World);
    /** Lets a scenario be assembled in code rather than read out of the world file. */
    addSpawnPoint(spawnPoint: ISpawnPoint): void;
    createLaunchLink(): void;
    launch(loadingManager: LoadingManager, world: World): void;
}
