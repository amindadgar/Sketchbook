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
    /** World units from the neck joint to the top of the head. */
    private static readonly HAT_HEIGHT;
    /** A person's head is about half the width of the boxman's, and its joint sits lower in it. */
    private static readonly HUMAN_HAT_HEIGHT;
    private static readonly HUMAN_HAT_SCALE;
    health: number;
    weapon: WeaponSpec;
    ammo: number;
    reserve: number;
    /** Set for anyone in a party, so hits can be addressed to their client. */
    networkId: number;
    /**
     * Which life a remote player is on, as they last reported it. A hit carries
     * it back to them, so one aimed at the body they just left doesn't land on
     * the one that respawned.
     */
    networkLife: number;
    playerName: string;
    playerColor: string;
    nameTag: NameTag;
    private physicsEnabled;
    private originalColors;
    private weaponModel;
    /** Until when, in seconds of page time, the gun is held up, and along what. */
    aimUntil: number;
    aimAlong: THREE.Vector3;
    private headTexture;
    private headCanvas;
    private headBone;
    private hat;
    private hatId;
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
    setPlayerAppearance(name: string, color: string, hat?: string): void;
    /**
     * Paints the player's name over the "three.js" the boxman is shipped wearing.
     *
     * The face texture is redrawn into a canvas and handed back to the same
     * three.js texture, so every setting the loader put on it survives. Each
     * character parses its own copy of the model, so this only ever repaints the
     * one head it belongs to.
     */
    private stampNameOnHead;
    /**
     * Puts whatever they've earned on their head.
     *
     * Hung off the head bone rather than the model container, so it stays put
     * through the walk cycle instead of hovering where the head used to be.
     */
    wearHat(id: string, color: string): void;
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
    /**
     * Holds the gun out along a direction: both bones of the arm and the
     * hand turned to point along it, over whatever the animation had them
     * doing. A long gun gets the other hand on it too. Called after the
     * animation, every frame the character is aiming or has just fired.
     */
    private poseAim;
    /** Turns a bone, keeping its parent where it is, so its length points along a world direction. */
    private static pointBone;
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
    /** Straight back up, for a respawn that shouldn't be seen climbing off the floor. */
    resetDeathPose(): void;
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
    /**
     * The closest seat in a vehicle worth walking to, and whether to slide over
     * and drive once there.
     *
     * Asking to drive considers the driver's seat and any passenger seat that
     * slides across into it, but only while that driver's seat is free: sliding
     * over into it is exactly how two people used to end up sitting in one seat.
     * With somebody already driving it falls back to riding along, which is also
     * the only way in there is from a phone, where F is the one button.
     */
    private chooseSeat;
    /**
     * Free for this character: nobody else is in it here, and no other member
     * of the party has claimed it. The claim covers the part a local check can't
     * see, somebody on another screen who is still walking up to the door.
     */
    canUseSeat(seat: VehicleSeat): boolean;
    /** The seat this character is in, getting into, or walking up to. */
    getSeatOfInterest(): VehicleSeat;
    /** Sitting in, climbing into or out of, or parented to a vehicle. */
    isBusyWithVehicle(): boolean;
    /**
     * Gives up a seat another player turned out to hold. Only the local
     * character does this; everyone else is played back from their own client.
     *
     * Walking up to it just stops. Halfway through the door, back out. Already
     * sitting in it, which happens when a whole party spawns into the one car,
     * move along to a free seat, or climb out if there isn't one.
     */
    yieldSeat(seat: VehicleSeat): void;
    /** Stops walking toward a vehicle, without leaving the forward key stuck down. */
    cancelVehicleEntry(): void;
    /** Straight into another seat of the same vehicle, no animation. */
    private moveToSeat;
    /**
     * Out of any vehicle, all at once: no longer driving, no longer sitting,
     * parented back to the world with physics on, standing by the door. Safe
     * to call on foot, where it only makes sure of all that.
     *
     * For dying at the wheel and for respawning, both of which used to leave the
     * body seated and then move it in the car's own coordinates. Must not run
     * inside a physics step, since it puts the capsule back into the world.
     */
    forceLeaveVehicle(): void;
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
