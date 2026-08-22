import { Character } from '../characters/Character';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { PlayerInfo } from './NetworkClient';
/**
 * Somebody else's character, driven by network updates instead of by input.
 *
 * Their own client simulates them, so physics and the state machine are both
 * switched off here. All this does is ease the model toward the last reported
 * transform and replay whichever animation they said they were playing.
 */
export declare class RemotePlayer implements IUpdatable {
    updateOrder: number;
    private static loader;
    info: PlayerInfo;
    character: Character;
    private world;
    private disposed;
    private targetPosition;
    private targetQuaternion;
    private hasTarget;
    private animation;
    private vehicle;
    private vehicleTargetPosition;
    private vehicleTargetQuaternion;
    private hasVehicleTarget;
    constructor(world: World, info: PlayerInfo);
    setIdentity(name: string, color: string, hat?: string): void;
    applyState(message: any): void;
    applyVehicleState(message: any): void;
    update(timeStep: number): void;
    dispose(): void;
    /**
     * The driver's client is the authority on where their vehicle is, so the
     * body is pushed toward what they reported and its velocity is cancelled to
     * stop the local simulation from arguing with it.
     */
    private driveVehicle;
    private applySeat;
    /**
     * A stripped down version of Character.teleportToVehicle. The real one starts
     * the driving state machine and rewrites the controls panel, which belongs to
     * the local player, not to somebody being played back.
     */
    private seat;
    private unseat;
    private leaveVehicle;
    private findVehicle;
}
