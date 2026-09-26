import * as THREE from 'three';
import * as CANNON from 'cannon';
import { CameraOperator } from '../core/CameraOperator';
import { Graphics } from '../core/Graphics';
import { Stats } from '../../lib/utils/Stats';
import { FpsMeter } from '../core/FpsMeter';
import { SkidMarks } from '../vehicles/SkidMarks';
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
import { Water } from './Water';
import { City } from '../city/City';
import { NpcSystem } from '../npc/NpcSystem';
import { PlayerIdentity } from '../party/PlayerIdentity';
import { PartySession } from '../party/PartySession';
import { Minimap } from '../core/Minimap';
import { TouchControls } from '../core/TouchControls';
import { Effects } from '../core/Effects';
import { RaceSystem } from '../race/RaceSystem';
import { Chat } from '../party/Chat';
import { Leaderboard } from '../party/Leaderboard';
import { Notices } from '../core/Notices';
import { Sfx } from '../core/Sfx';
import { Onboarding } from '../core/Onboarding';
import { Progress } from '../progress/Progress';
import { StuntSystem } from '../stunts/StuntSystem';
import { CombatSystem } from '../combat/CombatSystem';
export declare class World {
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    graphics: Graphics;
    stats: Stats;
    fps: FpsMeter;
    graphicsWorld: THREE.Scene;
    sky: Sky;
    water: Water;
    city: City;
    npcs: NpcSystem;
    private islandPickups;
    private islandRespawns;
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
    /**
     * Counts scenario launches. Everything a launch spawns arrives later, from a
     * download, and anything that arrives after a newer launch has started
     * belongs to a world that no longer exists and is thrown away.
     */
    scenarioGeneration: number;
    /** The scenario last launched, rather than the ones that always spawn alongside it. */
    private activeScenario;
    party: PartySession;
    combat: CombatSystem;
    effects: Effects;
    race: RaceSystem;
    chat: Chat;
    leaderboard: Leaderboard;
    notices: Notices;
    sfx: Sfx;
    skidMarks: SkidMarks;
    intro: Onboarding;
    progress: Progress;
    stunts: StuntSystem;
    private headlightsOn;
    private beam;
    minimap: Minimap;
    touchControls: TouchControls;
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
        /**
         * Where the sea's surface is drawn. A little under the island's ground,
         * which sits at 14.8: the old sea had a hole cut for the island, and
         * the new one runs under everything out to the horizon.
         */
        waterLevel: number;
    };
    private speedometerFill;
    private boundResumeAudio;
    constructor(worldScenePath?: any);
    update(timeStep: number, unscaledTimeStep: number): void;
    updatePhysics(timeStep: number): void;
    /** The island's own footprint, measured from its world file. Some of it is below the sea. */
    private static readonly ISLAND;
    isOutOfBounds(position: CANNON.Vec3): boolean;
    outOfBoundsRespawn(body: CANNON.Body, position?: CANNON.Vec3): void;
    /**
     * Rendering loop.
     * Implements fps limiter and frame-skipping
     * Calls world's "update" function before rendering.
     * @param {World} world
     */
    /**
     * iOS in standalone doesn't reliably fire resize when the device is turned,
     * which leaves the canvas at its portrait size with the page showing through
     * the rest of the screen. Rather than trust any single event to arrive, the
     * render loop notices the window no longer matches and puts it right. Two
     * comparisons a frame, and it can't be missed.
     */
    private syncViewportSize;
    applyViewportSize(): void;
    render(world: World): void;
    /**
     * Lights on after dark. Every car gets a pair of glowing lamps, which cost
     * two sprites and nothing else, and the car the player is in also gets the
     * one real light in the scene: eight spotlights would rebuild every shader
     * in the world and buy very little at the speed a car goes past.
     */
    private updateHeadlights;
    /** Distance, speed and time aloft, the things nothing else was counting. */
    private updateProgress;
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
    /** Bound to L. */
    toggleLeaderboard(): void;
    /** Bound to C. */
    toggleCameraCentering(): void;
    applyMusicVolume(): void;
    resumeAudio(): void;
    /**
     * Stops listening only once the context is genuinely running.
     *
     * This used to unhook on the first attempt whether or not it worked, so a
     * single refused resume, which is what happens when the call doesn't land
     * inside a real gesture, left the game silent for the rest of the session
     * with nothing left listening to try again.
     */
    private releaseAudioUnlock;
    /** Puts the gesture listeners back, for when a context is lost after unlocking. */
    private listenForAudioUnlock;
    /** A silent one sample buffer, which is what actually unlocks iOS. */
    private nudgeAudioContext;
    /**
     * Every lit material has to be told about the shadow cascades before it's
     * first drawn. The cascades are three directional lights, and a material
     * that hasn't been set up for them is lit by all three at once, which is
     * three suns' worth. Guns, hats, props and whole vehicles are made all over
     * the codebase, so rather than trust each of them to remember, the check
     * runs on every object on its way to the screen: one property lookup for
     * anything already done.
     */
    private installMaterialHook;
    private static isLit;
    /**
     * Hooks a material up to the shadow cascades. A material with its own
     * shader tweaks keeps them: they run first, then the cascades'. Its
     * userData.shaderKey tells three's program cache the variants apart, since
     * every wrapped hook looks the same from outside.
     */
    setupMaterial(material: any): void;
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
    /**
     * Scatters weapon pickups and works out where the dead come back.
     *
     * Spawn points are reused as the anchors rather than inventing positions:
     * they're known good ground, spread across the map, and a gun dropped at an
     * arbitrary coordinate could end up inside a wall or under the sea.
     */
    private prepareCombat;
    /**
     * Adds the city's pavements to the places the dead come back and the
     * guns are left, thinned out the same way the island's are.
     */
    private prepareCityCombat;
    private createMergedScenario;
    /** Parks a vehicle on the line from the player to the aircraft, where the apron is clear. */
    private createVehicleSpawnBetween;
    /**
     * 'quiet' is for launches that arrive from the party rather than from this
     * player: no briefing to dismiss and no clock stopped behind it, since the
     * rest of the room is already playing and nobody here asked for it.
     */
    launchScenario(scenarioID: string, loadingManager?: LoadingManager, quiet?: boolean): void;
    /**
     * A party member's spare car that this client doesn't have, because they
     * joined after it launched. Anything else by that name is left alone.
     */
    /** A vehicle another player has that this client doesn't: a spare party car, or one taken from the traffic. */
    spawnPartyVehicle(name: string, message?: any): void;
    /** Whether a scenario starts players in a car, and so gives a party one each. */
    scenarioHasPartyGrid(scenarioID: string): boolean;
    /**
     * Shift+R. In a party it puts just this player back at a spawn point:
     * restarting the scenario there restarts it for everybody, and a key the
     * controls call "Respawn" shouldn't reset the whole room.
     */
    requestRespawn(): void;
    restartScenario(): void;
    clearEntities(): void;
    scrollTheTimeScale(scrollAmount: number): void;
    updateControls(controls: any): void;
    private setupAudio;
    private generateHTML;
    private createParamsGUI;
}
