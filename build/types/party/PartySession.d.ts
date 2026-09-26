import { World } from '../world/World';
import { Vehicle } from '../vehicles/Vehicle';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { IUpdatable } from '../interfaces/IUpdatable';
import { NetworkClient } from './NetworkClient';
import { PlayerIdentity } from './PlayerIdentity';
import * as THREE from 'three';
/**
 * Holds a party together: keeps the connection, mirrors everyone else into the
 * world as RemotePlayers, and publishes the local player's transform.
 */
export declare class PartySession implements IUpdatable {
    updateOrder: number;
    private static readonly SEND_INTERVAL;
    /**
     * A car let go of keeps being reported, less often, until it comes to rest.
     * Left to each client's own physics a car still rolling down a hill ends up
     * somewhere different on every screen. The cap is only a backstop.
     */
    private static readonly COAST_INTERVAL;
    private static readonly COAST_TIME;
    /** How long a report for a vehicle that hasn't spawned here yet is kept for it. */
    private static readonly PENDING_TIME;
    client: NetworkClient;
    active: boolean;
    /** Round state, mirrored from the server and counted down between updates. */
    private matchPhase;
    private matchRemaining;
    private matchRound;
    private shownSeconds;
    private world;
    private players;
    private sendTimer;
    private applyingRemoteScenario;
    private pending;
    private pendingTimer;
    private notice;
    private localScore;
    /** What the relay said it can do beyond the original protocol. Empty for an older relay. */
    private features;
    /**
     * Who holds which seat, as the relay last said: 'vehicle#seat' to the id of
     * the member holding it. The relay decides, first claim first, because two
     * clients each checking their own copy of a car would both see it empty
     * and both climb into the same seat.
     */
    private seatHolders;
    /** The same the other way round, each member's claim. */
    private memberSeats;
    /** The claim this client last sent, null for none. */
    private claimedKey;
    /** Vehicle id to the member whose reports it last followed. */
    private lastDrivers;
    /** The vehicle the local player drove as of the last frame. */
    private drivenVehicle;
    /** Vehicles the local player let go of, still reported while they come to rest. */
    private coasting;
    /** Reports for vehicles that haven't spawned here yet. */
    private pendingVehicles;
    constructor(world: World);
    host(url: string, identity: PlayerIdentity): Promise<void>;
    join(url: string, code: string, identity: PlayerIdentity): Promise<void>;
    /**
     * Settles once the server confirms the room rather than when the socket opens.
     * A wrong code used to close the menu and start the game as though it had
     * worked, with the refusal arriving after there was anywhere left to show it.
     */
    private awaitRoom;
    private settle;
    leave(): void;
    /** Tells the party the local player's name or colour changed. */
    publishIdentity(identity: PlayerIdentity): void;
    /** Where everyone in the city is, from the client that simulates them. */
    publishNpcs(snapshot: any): void;
    /** A shot at a pedestrian, for the client that simulates them to apply. */
    sendNpcHit(id: number, damage: number, from: THREE.Vector3): void;
    /**
     * Anything nobody drives that the local player's car is touching and
     * moving: pushed slowly, or kept pushing after the first knock, it's
     * reported for as long as it's being moved, not just from the first hit.
     */
    private trackPushing;
    /**
     * A car nobody is driving, just hit by the local player's: reported until
     * it comes to rest, so it ends up in the same place on every screen.
     */
    shoved(vehicle: Vehicle): void;
    /** A car that has just appeared here, so the room and everyone in it have it before anyone drives it. */
    announceVehicle(vehicle: Vehicle): void;
    /** A car this player took out of the traffic, for the client that simulates it to clear away. */
    sendNpcSteal(id: number, door: THREE.Vector3): void;
    /** A lamp or sign this player's car knocked over, so it falls on everyone's screen. */
    sendBreak(id: number, velocity: THREE.Vector3): void;
    /** Whether the relay supports something beyond the original protocol. */
    hasFeature(name: string): boolean;
    /**
     * Called after any scenario launch. Launching wipes every entity, remote
     * characters included, so they have to be rebuilt either way. Whoever
     * launched it locally also tells the rest of the party to follow.
     */
    onScenarioLaunched(scenarioID: string): void;
    /**
     * The muzzle, the aim, and where each pellet actually ended, so everyone
     * else draws the shot that was fired rather than working out their own.
     */
    publishShot(from: THREE.Vector3, direction: THREE.Vector3, weaponId: string, endpoints: THREE.Vector3[]): void;
    /**
     * Their client owns their health, so a hit is a request, not a verdict.
     * The weapon and the place it was fired from travel with it: the relay uses
     * them to check the claim is possible, and the client being shot at uses
     * them to check there wasn't a wall in the way. The life it was aimed at
     * comes too, so a hit on someone who has since respawned can be told apart.
     */
    publishHit(targetId: number, damage: number, weaponId: string, from: THREE.Vector3, targetLife?: number): void;
    /** Tells a shooter their hit counted, which is what lights their hit marker. */
    publishHurt(attackerId: number, damage: number, dead: boolean): void;
    publishPickup(index: number): void;
    publishChat(text: string): void;
    publishDeath(killerId: number, weaponId?: string): void;
    /**
     * The room hears about a death from the relay, but the player who died is
     * excluded from that broadcast, so their own line is written here. Works
     * outside a party too, where it's the only line there is.
     */
    reportOwnDeath(killerId: number, weaponId?: string): void;
    /** The key a seat is claimed under, or undefined for a vehicle with no id. */
    static seatKey(seat: VehicleSeat): string;
    /** The id of the member holding a seat, or undefined. */
    seatHolder(seat: VehicleSeat): number;
    /** Another member has claimed it. */
    isSeatHeldByOther(seat: VehicleSeat): boolean;
    /**
     * The relay has given this seat to the local player. Always true outside a
     * party, or against a relay too old to hand seats out, where the local
     * checks are all there is.
     */
    isSeatConfirmed(seat: VehicleSeat): boolean;
    /** Whichever seat a member has claimed, if it exists in this world. */
    seatOf(id: number): VehicleSeat;
    /** Everyone in the party, this player included. */
    memberIds(): number[];
    /**
     * A computer driver sitting where a party member wants to be gives the car
     * up. They're placeholders on a race grid, and each client has its own,
     * so the car goes to the person rather than being argued over.
     */
    evictAi(seat: VehicleSeat): void;
    /** One member's seat as the relay announced it: taken, moved, or given up. */
    private recordSeat;
    /**
     * Keeps the relay's idea of the local player's seat in step with the seat
     * they're in, climbing into or walking toward, and backs off one the
     * relay has given to someone else. Every frame, since a claim made at the
     * moment F is pressed is what stops two people walking to the same door.
     */
    private reconcileSeat;
    /**
     * Only the driver's client simulates a vehicle for real; everyone else's is
     * steered after its reports. A report counts only from whoever holds that
     * vehicle's driver's seat, or, with nobody in it, from whoever drove it
     * last and is still reporting it rolling to a stop. Anything else, like a
     * second client that thinks it's driving the same car, is ignored rather
     * than left to fight over it. And never while anyone here is at the wheel.
     */
    private acceptsVehicleFrom;
    private receiveVehicle;
    private steerVehicle;
    /** Reports that arrived before their vehicle did, applied once it has. */
    private applyPendingVehicles;
    /** Notices the local player letting go of a vehicle, which then coasts under our reports. */
    private trackDrivenVehicle;
    /**
     * Keeps reporting a car after getting out, until it comes to rest, then
     * says where it stopped. Otherwise everyone else's copy
     * is left wherever it was when the driver let go, and parked cars drift
     * apart between screens for good.
     */
    private publishCoasting;
    private driverSeatHeldByOther;
    private publishVehicle;
    private findVehicle;
    /** Seats, who drove what, and anything waiting on a vehicle: none of it survives a launch. */
    private clearSharedState;
    /**
     * Counts down between the server's updates, so the clock moves every frame
     * rather than once every five seconds, and gets corrected when one arrives.
     */
    private tickMatchClock;
    private static mmss;
    /** Works out of a party too, where it's just you and your score. */
    refreshScoreboard(): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    /**
     * World position and rotation. Opening a car door parents the character to
     * the car, and from then until they're out again its own position is only
     * where in the car it is; published as it was, everyone else saw them
     * vanish to the middle of the map, under the ground.
     */
    private publishLocalState;
    private applyScenario;
    private addPlayer;
    /** Their characters were destroyed with the rest of the scenario, so respawn them. */
    private rebuildPlayers;
    private refreshHud;
    /** Three finite numbers as a vector, or undefined. */
    private static readVector;
    private static now;
    private static round3;
}
