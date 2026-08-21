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
    characterCaller: Character;
    constructor(world: World, camera: THREE.Camera, sensitivityX?: number, sensitivityY?: number);
    setSensitivity(sensitivityX: number, sensitivityY?: number): void;
    setRadius(value: number, instantly?: boolean): void;
    move(deltaX: number, deltaY: number): void;
    update(timeScale: number): void;
    /**
     * Swings the orbit angle around to sit behind whatever the player is steering,
     * their character on foot or their vehicle while driving. Pitch is left alone,
     * so whatever camera height they picked survives being centred.
     */
    /** Narrows the view while aiming, which reads as zoom without moving the camera. */
    private applyAimFov;
    private centerBehindSubject;
    handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void;
    handleMouseWheel(event: WheelEvent, value: number): void;
    handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void;
    handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void;
    inputReceiverInit(): void;
    inputReceiverUpdate(timeStep: number): void;
}
