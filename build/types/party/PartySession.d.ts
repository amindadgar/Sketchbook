import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { NetworkClient } from './NetworkClient';
import { PlayerIdentity } from './PlayerIdentity';
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
    constructor(world: World);
    host(url: string, identity: PlayerIdentity): Promise<void>;
    join(url: string, code: string, identity: PlayerIdentity): Promise<void>;
    leave(reason?: string): void;
    /** Tells the party the local player's name or colour changed. */
    publishIdentity(identity: PlayerIdentity): void;
    /**
     * Called after any scenario launch. Launching wipes every entity, remote
     * characters included, so they have to be rebuilt either way. Whoever
     * launched it locally also tells the rest of the party to follow.
     */
    onScenarioLaunched(scenarioID: string): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    private publishLocalState;
    private applyScenario;
    private addPlayer;
    /** Their characters were destroyed with the rest of the scenario, so respawn them. */
    private rebuildPlayers;
    private refreshHud;
    private static round3;
}
