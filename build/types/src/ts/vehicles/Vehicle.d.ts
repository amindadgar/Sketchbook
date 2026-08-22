import { Character } from '../characters/Character';
import * as THREE from 'three';
import * as CANNON from 'cannon';
import { World } from '../world/World';
import { KeyBinding } from '../core/KeyBinding';
import { VehicleSeat } from './VehicleSeat';
import { Wheel } from './Wheel';
import { EntityType } from '../enums/EntityType';
import { IWorldEntity } from '../interfaces/IWorldEntity';
export declare abstract class Vehicle extends THREE.Object3D implements IWorldEntity {
    updateOrder: number;
    abstract entityType: EntityType;
    controllingCharacter: Character;
    actions: {
        [action: string]: KeyBinding;
    };
    rayCastVehicle: CANNON.RaycastVehicle;
    seats: VehicleSeat[];
    wheels: Wheel[];
    drive: string;
    camera: any;
    world: World;
    help: THREE.AxesHelper;
    collision: CANNON.Body;
    materials: THREE.Material[];
    spawnPoint: THREE.Object3D;
    engineSound: THREE.PositionalAudio;
    private modelContainer;
    private firstPerson;
    protected engineSoundPath: string;
    protected engineSoundRefDistance: number;
    private originalColors;
    private static readonly UNPAINTED;
    private enginePitch;
    private engineVolume;
    /**
     * Condition, 100 down to 0. Nothing about the handling depends on it: it
     * decides how hard the wreck smokes, which is the whole point of it. A
     * number the player can't see quietly throttling their engine would just
     * feel like the car had gone wrong.
     */
    integrity: number;
    /** Slower than this along the contact normal and it's a nudge, not a crash. */
    private static readonly IMPACT_FLOOR;
    /** Health lost per metre a second over the floor. */
    private static readonly IMPACT_DAMAGE;
    /** Condition lost per metre a second over the floor. */
    private static readonly IMPACT_WEAR;
    private static readonly SMOKE_BELOW;
    private impactCooldown;
    private smokeTimer;
    private boundOnCollide;
    constructor(gltf: any, handlingSetup?: any);
    noDirectionPressed(): boolean;
    update(timeStep: number): void;
    forceCharacterOut(): void;
    onInputChange(): void;
    resetControls(): void;
    allowSleep(value: boolean): void;
    handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void;
    setFirstPersonView(value: boolean): void;
    toggleFirstPersonView(): void;
    triggerAction(actionName: string, value: boolean): void;
    handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void;
    handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void;
    handleMouseWheel(event: WheelEvent, value: number): void;
    inputReceiverInit(): void;
    inputReceiverUpdate(timeStep: number): void;
    setPosition(x: number, y: number, z: number): void;
    setSteeringValue(val: number): void;
    applyEngineForce(force: number): void;
    /**
     * Cannon reports a collision once, on the frame the two bodies first touch,
     * to both of them. A crash is still several of those as the car tumbles, so
     * there's a short cooldown to stop one accident being billed five times.
     */
    private onCollide;
    /** A battered vehicle smokes, harder the worse it is, and only while running. */
    private updateSmoke;
    /**
     * How hard the tyres hold on sideways. Dropping it on the driven pair is
     * what turns the handbrake from a full stop into a slide.
     */
    setFrictionSlip(value: number, driveFilter?: string): void;
    setBrake(brakeForce: number, driveFilter?: string): void;
    addToWorld(world: World): void;
    removeFromWorld(world: World): void;
    /**
     * Creates a looping engine sound that travels with the vehicle.
     * The sound is a child of the vehicle's Object3D, so the 'updateMatrixWorld'
     * call in 'update' already moves the panner along with it.
     */
    protected setupEngineSound(world: World): void;
    /**
     * Feeds the engine sound. Pitch is a multiple of the sample's own pitch, both
     * values are lerped so gear shifts and throttle taps glide instead of clicking.
     */
    protected updateEngineSound(pitch: number, volume: number): void;
    /**
     * Paints the vehicle in the driver's colour. Wheels are left alone,
     * a bright red tyre reads as a bug rather than a livery.
     */
    setPlayerTint(color: string): void;
    /**
     * Bodywork gets the driver's colour; glass, lights, trim and tyres don't.
     * Matched on the material name, since that's all an imported model carries,
     * and a red windscreen reads as a bug rather than a paint job.
     */
    private static isUnpainted;
    clearPlayerTint(): void;
    protected disposeEngineSound(): void;
    readVehicleData(gltf: any): void;
    private connectSeats;
}
