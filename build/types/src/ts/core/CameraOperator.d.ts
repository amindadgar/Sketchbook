import * as THREE from 'three';
import { World } from '../world/World';
import { IInputReceiver } from '../interfaces/IInputReceiver';
import { KeyBinding } from './KeyBinding';
import { Character } from '../characters/Character';
import { IUpdatable } from '../interfaces/IUpdatable';
export declare class CameraOperator implements IInputReceiver, IUpdatable {
    updateOrder: number;
    world: World;
    camera: THREE.Camera;
    target: THREE.Vector3;
    sensitivity: THREE.Vector2;
    radius: number;
    theta: number;
    phi: number;
    onMouseDownPosition: THREE.Vector2;
    onMouseDownTheta: any;
    onMouseDownPhi: any;
    targetRadius: number;
    movementSpeed: number;
    actions: {
        [action: string]: KeyBinding;
    };
    upVelocity: number;
    forwardVelocity: number;
    rightVelocity: number;
    followMode: boolean;
    autoCenter: boolean;
    aiming: boolean;
    /** How close the camera pulls in over the shoulder, and how far it slides across. */
    private static readonly AIM_RADIUS;
    private static readonly AIM_SHOULDER;
    private static readonly AIM_FOV;
    private aimBlend;
    private static readonly BASE_FOV;
    private static scratch;
    /** How long the camera leaves the view alone after the player drags it. */
    private static readonly MANUAL_LOOK_GRACE;
    /** Below this the subject counts as parked, and the view is the player's. */
    private static readonly MOVING_AT;
    /**
     * How fast the view is allowed to swing round on its own, in degrees a
     * second. On foot the character turns to face wherever the camera does, so
     * the two pull on each other and an unbounded correction spins the screen
     * far faster than anyone can read. A vehicle steers under its own power and
     * only needs the ceiling for a spin.
     */
    private static readonly SWING_ON_FOOT;
    private static readonly SWING_DRIVING;
    /** Matches the old 10% a frame at 60fps, but no longer tied to the frame rate. */
    private static readonly SWING_RESPONSE;
    private manualLookTimer;
    /** How much of a shot's kick is still owed back to the player, in degrees. */
    private recoilOwed;
    private static readonly RECOIL_RECOVERY;
    characterCaller: Character;
    constructor(world: World, camera: THREE.Camera, sensitivityX?: number, sensitivityY?: number);
    setSensitivity(sensitivityX: number, sensitivityY?: number): void;
    setRadius(value: number, instantly?: boolean): void;
    /**
     * Says the player just turned the camera themselves, which holds the
     * automatic centring off for a moment so it doesn't drag the view straight
     * back. Touch only: a mouse never sits perfectly still, so calling this from
     * move() would leave the desktop toggle with nothing to do.
     */
    noteManualLook(): void;
    /**
     * Kicks the view for a shot. Every degree taken is given back over the next
     * fraction of a second, so a burst walks the aim up the target and settles
     * where it started rather than leaving the player pointing at the sky.
     */
    addRecoil(degrees: number): void;
    private recoverRecoil;
    move(deltaX: number, deltaY: number): void;
    update(timeScale: number, unscaledTimeStep: number): void;
    /** Narrows the view while aiming, which reads as zoom without moving the camera. */
    private applyAimFov;
    /**
     * Swings the orbit angle around to sit behind whatever the player is steering,
     * their character on foot or their vehicle while driving. Pitch is left alone,
     * so whatever camera height they picked survives being centred.
     */
    private centerBehindSubject;
    handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void;
    handleMouseWheel(event: WheelEvent, value: number): void;
    handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void;
    handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void;
    inputReceiverInit(): void;
    inputReceiverUpdate(timeStep: number): void;
}
