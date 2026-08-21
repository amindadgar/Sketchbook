import * as THREE from 'three';
import * as CANNON from 'cannon';
import { CameraOperator } from '../core/CameraOperator';
import { Stats } from '../../lib/utils/Stats';
import { CannonDebugRenderer } from '../../lib/cannon/CannonDebugRenderer';
import { InputManager } from '../core/InputManager';
import { LoadingManager } from '../core/LoadingManager';
import { InfoStack } from '../core/InfoStack';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Character } from '../characters/Character';
import { Path } from './Path';
import { Vehicle } from '../vehicles/Vehicle';
import { Scenario } from './Scenario';
import { Sky } from './Sky';
import { PlayerIdentity } from '../party/PlayerIdentity';
import { PartySession } from '../party/PartySession';
import { Minimap } from '../core/Minimap';
export declare class World {
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    composer: any;
    stats: Stats;
    graphicsWorld: THREE.Scene;
    sky: Sky;
    physicsWorld: CANNON.World;
    parallelPairs: any[];
    physicsFrameRate: number;
    physicsFrameTime: number;
    physicsMaxPrediction: number;
    clock: THREE.Clock;
    renderDelta: number;
    logicDelta: number;
    requestDelta: number;
    sinceLastFrame: number;
    justRendered: boolean;
    params: any;
    inputManager: InputManager;
    cameraOperator: CameraOperator;
    timeScaleTarget: number;
    console: InfoStack;
    cannonDebugRenderer: CannonDebugRenderer;
    scenarios: Scenario[];
    characters: Character[];
    vehicles: Vehicle[];
    paths: Path[];
    scenarioGUIFolder: any;
    updatables: IUpdatable[];
    audioListener: THREE.AudioListener;
    music: THREE.Audio;
    musicElement: HTMLAudioElement;
    localPlayer: PlayerIdentity;
    localCharacter: Character;
    party: PartySession;
    minimap: Minimap;
    lastScenarioID: string;
    /**
     * The playable area, used both to respawn anything that leaves it and to
     * frame the minimap. Measured from this world file.
     */
    worldBounds: {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
        seaLevel: number;
        floor: number;
    };
    private speedometerFill;
    private boundResumeAudio;
    constructor(worldScenePath?: any);
    update(timeStep: number, unscaledTimeStep: number): void;
    updatePhysics(timeStep: number): void;
    isOutOfBounds(position: CANNON.Vec3): boolean;
    outOfBoundsRespawn(body: CANNON.Body, position?: CANNON.Vec3): void;
    /**
     * Rendering loop.
     * Implements fps limiter and frame-skipping
     * Calls world's "update" function before rendering.
     * @param {World} world
     */
    render(world: World): void;
    /**
     * The car the local player is driving, if any. While driving, the character
     * stays the input receiver and forwards input to the vehicle, so the car has
     * to be reached through it rather than read off the receiver directly.
     */
    private getLocallyDrivenCar;
    /**
     * Shows the speed bar only while the local player is at the wheel of a car,
     * and eases the fill so it climbs rather than snapping.
     */
    private updateSpeedometer;
    /**
     * Pushes the current name and colour onto the character the player controls.
     * Called after the menu closes, since the character spawns before that.
     */
    applyLocalIdentity(): void;
    setTimeScale(value: number): void;
    /**
     * Starts the audio context and the music track.
     * Browsers keep audio suspended until the user interacts with the page,
     * so this runs on the first click or key press, whichever comes first.
     */
    /** Bound to M. */
    toggleMusic(): void;
    /** Bound to C. */
    toggleCameraCentering(): void;
    applyMusicVolume(): void;
    resumeAudio(): void;
    add(worldEntity: IWorldEntity): void;
    registerUpdatable(registree: IUpdatable): void;
    remove(worldEntity: IWorldEntity): void;
    unregisterUpdatable(registree: IUpdatable): void;
    loadScene(loadingManager: LoadingManager, gltf: any): void;
    /**
     * Adds a scenario with a car, a helicopter and an aeroplane all within reach.
     *
     * The world file has no such spot. Free roam (default) starts you with cars
     * 4m away but the nearest helicopter 128m and aeroplane 141m off, and Free
     * roam (aviation) is the mirror image, aircraft on the doorstep and the
     * nearest car 149m away.
     *
     * The air vehicles scenario spawns always, so the aircraft are already
     * parked at the airfield. Starting the player there and parking one extra
     * car beside them is all it takes to put all three types within seconds of
     * each other, without inventing positions that might land in scenery.
     */
    private createMergedScenario;
    /** Parks a car on the line from the player to the aircraft, where the apron is clear. */
    private createCarSpawnBetween;
    launchScenario(scenarioID: string, loadingManager?: LoadingManager): void;
    restartScenario(): void;
    clearEntities(): void;
    scrollTheTimeScale(scrollAmount: number): void;
    updateControls(controls: any): void;
    private setupAudio;
    private generateHTML;
    private createParamsGUI;
}
