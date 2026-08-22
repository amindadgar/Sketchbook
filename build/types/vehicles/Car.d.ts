import * as CANNON from 'cannon';
import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { EntityType } from '../enums/EntityType';
export declare class Car extends Vehicle implements IControllable {
    entityType: EntityType;
    drive: string;
    protected engineSoundPath: string;
    topSpeed: number;
    get speed(): number;
    private _speed;
    private steeringWheel;
    private airSpinTimer;
    private steeringSimulator;
    private gear;
    private shiftTimer;
    private timeToShift;
    private canTiltForwards;
    private characterWantsToExit;
    /** What the tyres grip at normally, and what the handbrake drops them to. */
    private static readonly GRIP;
    private static readonly HANDBRAKE_GRIP;
    /**
     * Downforce as a share of the car's own weight at top speed. Applied down
     * the body's own up axis rather than the world's, so it presses the car into
     * the loop ramp on the way round instead of pulling it off.
     */
    private static readonly DOWNFORCE;
    constructor(gltf: any);
    noDirectionPressed(): boolean;
    update(timeStep: number): void;
    shiftUp(): void;
    shiftDown(): void;
    physicsPreStep(body: CANNON.Body, car: Car): void;
    onInputChange(): void;
    inputReceiverInit(): void;
    readCarData(gltf: any): void;
}
