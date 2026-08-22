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
    /** Seconds of boost from full, and seconds to fill again from empty. */
    private static readonly BOOST_SECONDS;
    private static readonly BOOST_RECHARGE;
    /** Newtons at a standstill, tapering to nothing at the boosted top speed. */
    private static readonly BOOST_FORCE;
    private static readonly BOOST_TOP;
    /** How much is left, nought to one. Read by the HUD. */
    boostLeft: number;
    boosting: boolean;
    private boostPuff;
    constructor(gltf: any);
    noDirectionPressed(): boolean;
    update(timeStep: number): void;
    /**
     * Spends the boost while it's held and refills it when it isn't. Only the
     * meter and the flames are here; the push itself belongs in the physics
     * step, where it can be applied every substep rather than once a frame.
     */
    private updateBoost;
    /** A flame out of the back, roughly where an exhaust would be. */
    private trailFlames;
    shiftUp(): void;
    shiftDown(): void;
    physicsPreStep(body: CANNON.Body, car: Car): void;
    onInputChange(): void;
    inputReceiverInit(): void;
    readCarData(gltf: any): void;
}
