import { World } from '../world/World';
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
    client: NetworkClient;
    active: boolean;
    private world;
    private players;
    private sendTimer;
    private applyingRemoteScenario;
    private pending;
    private pendingTimer;
    private notice;
    private localScore;
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
    /**
     * Called after any scenario launch. Launching wipes every entity, remote
     * characters included, so they have to be rebuilt either way. Whoever
     * launched it locally also tells the rest of the party to follow.
     */
    onScenarioLaunched(scenarioID: string): void;
    publishShot(from: THREE.Vector3, direction: THREE.Vector3, weaponId: string): void;
    /**
     * Their client owns their health, so a hit is a request, not a verdict.
     * The weapon and the place it was fired from travel with it: the relay uses
     * them to check the claim is possible, and the client being shot at uses
     * them to check there wasn't a wall in the way.
     */
    publishHit(targetId: number, damage: number, weaponId: string, from: THREE.Vector3): void;
    publishDeath(killerId: number): void;
    /** Works out of a party too, where it's just you and your score. */
    refreshScoreboard(): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    private publishLocalState;
    private applyScenario;
    private addPlayer;
    /** Their characters were destroyed with the rest of the scenario, so respawn them. */
    private rebuildPlayers;
    private refreshHud;
    private static round3;
}
