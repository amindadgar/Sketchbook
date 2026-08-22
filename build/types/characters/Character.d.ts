import * as THREE from 'three';
import * as CANNON from 'cannon';
import { KeyBinding } from '../core/KeyBinding';
import { VectorSpringSimulator } from '../physics/spring_simulation/VectorSpringSimulator';
import { RelativeSpringSimulator } from '../physics/spring_simulation/RelativeSpringSimulator';
import { ICharacterAI } from '../interfaces/ICharacterAI';
import { World } from '../world/World';
import { IControllable } from '../interfaces/IControllable';
import { ICharacterState } from '../interfaces/ICharacterState';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { Vehicle } from '../vehicles/Vehicle';
import { CapsuleCollider } from '../physics/colliders/CapsuleCollider';
import { VehicleEntryInstance } from './VehicleEntryInstance';
import { GroundImpactData } from './GroundImpactData';
import { EntityType } from '../enums/EntityType';
import { NameTag } from '../party/NameTag';
import { WeaponSpec } from '../combat/Weapons';
export declare class Character extends THREE.Object3D implements IWorldEntity {
    updateOrder: number;
    entityType: EntityType;
    height: number;
    tiltContainer: THREE.Group;
    modelContainer: THREE.Group;
    materials: THREE.Material[];
    mixer: THREE.AnimationMixer;
    animations: any[];
    currentAnimation: string;
    acceleration: THREE.Vector3;
    velocity: THREE.Vector3;
    arcadeVelocityInfluence: THREE.Vector3;
    velocityTarget: THREE.Vector3;
    arcadeVelocityIsAdditive: boolean;
    defaultVelocitySimulatorDamping: number;
    defaultVelocitySimulatorMass: number;
    velocitySimulator: VectorSpringSimulator;
    moveSpeed: number;
    angularVelocity: number;
    orientation: THREE.Vector3;
    orientationTarget: THREE.Vector3;
    defaultRotationSimulatorDamping: number;
    defaultRotationSimulatorMass: number;
    rotationSimulator: RelativeSpringSimulator;
    viewVector: THREE.Vector3;
    actions: {
        [action: string]: KeyBinding;
    };
    characterCapsule: CapsuleCollider;
    rayResult: CANNON.RaycastResult;
    rayHasHit: boolean;
    rayCastLength: number;
    raySafeOffset: number;
    wantsToJump: boolean;
    initJumpSpeed: number;
    groundImpactData: GroundImpactData;
    raycastBox: THREE.Mesh;
    world: World;
    charState: ICharacterState;
    behaviour: ICharacterAI;
    controlledObject: IControllable;
    occupyingSeat: VehicleSeat;
    vehicleEntryInstance: VehicleEntryInstance;
    static readonly MAX_HEALTH: number;
    /** How far a body has to come down to lie on the ground rather than over it. */
    private static readonly FALLEN_DROP;
    health: number;
    weapon: WeaponSpec;
    ammo: number;
    reserve: number;
    /** Set for anyone in a party, so hits can be addressed to their client. */
    networkId: number;
    playerName: string;
    playerColor: string;
    nameTag: NameTag;
    private physicsEnabled;
    private originalColors;
    private weaponModel;
    private headTexture;
    private headCanvas;
    /**
     * Where "three.js" is printed on the boxman's face texture, measured off the
     * image itself. The text sits below the smiley and reads upside down in the
     * atlas, which is how it comes out the right way up on the model.
     */
    private static readonly HEAD_LABEL;
    /** The cream the face plate is painted, sampled either side of the text. */
    private static readonly HEAD_PLATE;
    constructor(gltf: any);
    setAnimations(animations: []): void;
    setArcadeVelocityInfluence(x: number, y?: number, z?: number): void;
    setViewVector(vector: THREE.Vector3): void;
    /**
     * Set state to the player. Pass state class (function) name.
     * @param {function} State
     */
    setState(state: ICharacterState): void;
    setPosition(x: number, y: number, z: number): void;
    resetVelocity(): void;
    setArcadeVelocityTarget(velZ: number, velX?: number, velY?: number): void;
    setOrientation(vector: THREE.Vector3, instantly?: boolean): void;
    resetOrientation(): void;
    setBehaviour(behaviour: ICharacterAI): void;
    setPhysicsEnabled(value: boolean): void;
    /**
     * Names and colours the character. The tag is parented to the model container,
     * so it rides along into vehicles and hides itself in first person view.
     */
    setPlayerAppearance(name: string, color: string): void;
    /**
     * Paints the player's name over the "three.js" the boxman is shipped wearing.
     *
     * The face texture is redrawn into a canvas and handed back to the same
     * three.js texture, so every setting the loader put on it survives. Each
     * character parses its own copy of the model, so this only ever repaints the
     * one head it belongs to.
     */
    private stampNameOnHead;
    /** Copies the loaded face texture onto a canvas the tag can be drawn into. */
    private captureHeadTexture;
    /**
     * Model container sits 0.57 below the character origin, so that's the baseline.
     * Sitting lifts the character, so the tag comes down to hug the vehicle roof.
     */
    private updateNameTagHeight;
    /**
     * Puts a gun in the character's right hand.
     *
     * Parented to the visuals rather than to the arm bone: the bone swings with
     * every animation in the set, and pinning a gun to it convincingly would
     * mean a hand tuned offset per clip.
     */
    equipWeapon(spec: WeaponSpec): void;
    unequipWeapon(): void;
    /** Where shots leave the gun, so flashes and tracers start at the barrel. */
    getMuzzlePosition(): THREE.Vector3;
    setTint(color: string): void;
    readCharacterData(gltf: any): void;
    handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void;
    handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void;
    handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void;
    handleMouseWheel(event: WheelEvent, value: number): void;
    triggerAction(actionName: string, value: boolean): void;
    takeControl(): void;
    resetControls(): void;
    update(timeStep: number): void;
    /**
     * Falls over when killed, and gets up on respawn.
     *
     * Not a ragdoll: the skeleton drives every animation in the set and handing
     * it to the solver means a physics body per bone. Tipping the whole model
     * over reads as death from any distance a fight happens at, and costs a
     * rotation. The model container hangs below the tilt group, so laying that
     * group down also lifts the body, and the offset brings it back to ground.
     */
    private updateDeathPose;
    inputReceiverInit(): void;
    displayControls(): void;
    inputReceiverUpdate(timeStep: number): void;
    setAnimation(clipName: string, fadeIn: number): number;
    springMovement(timeStep: number): void;
    springRotation(timeStep: number): void;
    getLocalMovementDirection(): THREE.Vector3;
    getCameraRelativeMovementVector(): THREE.Vector3;
    setCameraRelativeOrientationTarget(): void;
    rotateModel(): void;
    jump(initJumpSpeed?: number): void;
    findVehicleToEnter(wantsToDrive: boolean): void;
    enterVehicle(seat: VehicleSeat, entryPoint: THREE.Object3D): void;
    teleportToVehicle(vehicle: Vehicle, seat: VehicleSeat): void;
    startControllingVehicle(vehicle: IControllable, seat: VehicleSeat): void;
    transferControls(entity: IControllable): void;
    stopControllingVehicle(): void;
    exitVehicle(): void;
    occupySeat(seat: VehicleSeat): void;
    leaveSeat(): void;
    physicsPreStep(body: CANNON.Body, character: Character): void;
    feetRaycast(): void;
    physicsPostStep(body: CANNON.Body, character: Character): void;
    addToWorld(world: World): void;
    removeFromWorld(world: World): void;
}
