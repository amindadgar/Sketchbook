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
    private enginePitch;
    private engineVolume;
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
    clearPlayerTint(): void;
    protected disposeEngineSound(): void;
    readVehicleData(gltf: any): void;
    private connectSeats;
}
