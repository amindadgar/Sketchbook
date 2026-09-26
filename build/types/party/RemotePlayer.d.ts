import { Character } from '../characters/Character';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { PlayerInfo } from './NetworkClient';
/**
 * Somebody else's character, driven by network updates instead of by input.
 *
 * Their own client simulates them, so physics and the state machine are both
 * switched off here. All this does is ease the model toward the last reported
 * transform and replay whichever animation they said they were playing, sit
 * them where they said they were sitting, and show their gun and their death.
 * The vehicle they drive is steered by the party session, from its own reports.
 */
export declare class RemotePlayer implements IUpdatable {
    updateOrder: number;
    private static loader;
    /** How quickly the model closes on where it was reported, per second. */
    private static readonly FOLLOW_RATE;
    /** A report is carried forward by the speed it implies, but no further than this. */
    private static readonly MAX_LEAD;
    /** Further than this is a respawn or a teleport, not movement, so no easing. */
    private static readonly SNAP_DISTANCE;
    private static readonly MAX_SPEED;
    info: PlayerInfo;
    character: Character;
    private world;
    private disposed;
    private targetPosition;
    private targetQuaternion;
    private hasTarget;
    /** Estimated from successive reports, to lead the model into where they are now. */
    private velocity;
    private reportedAt;
    private animation;
    private life;
    /** Undefined until they say; null for empty handed. */
    private weaponId;
    /** The vehicle painted in their colour, which is only ever one they drive. */
    private paintedVehicle;
    /** The seat whose door they last used, for shutting it behind them. */
    private doorSeat;
    constructor(world: World, info: PlayerInfo);
    setIdentity(name: string, color: string, hat?: string): void;
    applyState(message: any): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    /**
     * The relay has let go of their seat claim: they've gone quiet in a
     * background tab, or died, or left. Whoever it was, they aren't sitting
     * there any more for anyone else's purposes.
     */
    seatReleased(): void;
    dispose(): void;
    private applyWeapon;
    private applySeat;
    private canTake;
    /**
     * A stripped down version of Character.teleportToVehicle. The real one starts
     * the driving state machine and rewrites the controls panel, which belongs to
     * the local player, not to somebody being played back.
     */
    private seat;
    /** Across to another seat of the same vehicle, without leaving it. */
    private shiftTo;
    private unseat;
    /** Only the driver's colour goes on a car; a passenger climbing in doesn't repaint it. */
    private paint;
    /** Back to the colour of whoever drives it now, if anyone here does. */
    private unpaint;
    /**
     * Opens and shuts the door they're using, which their own client does from
     * its state machine and nothing here would otherwise touch. Getting in, the
     * seat is the one they've claimed, since they aren't sitting in it yet.
     */
    private mirrorDoor;
    private findVehicle;
}
