import { World } from '../world/World';
import { Vehicle } from '../vehicles/Vehicle';
import { IUpdatable } from '../interfaces/IUpdatable';
import { NetworkClient, PlayerInfo } from './NetworkClient';
import { RemotePlayer } from './RemotePlayer';
import { PlayerIdentity } from './PlayerIdentity';
import { UIManager } from '../core/UIManager';

/**
 * Holds a party together: keeps the connection, mirrors everyone else into the
 * world as RemotePlayers, and publishes the local player's transform.
 */
export class PartySession implements IUpdatable
{
	// Last, so what gets published is the transform this frame actually ended on
	public updateOrder: number = 20;

	private static readonly SEND_INTERVAL: number = 1 / 20;

	public client: NetworkClient = new NetworkClient();
	public active: boolean = false;

	private world: World;
	private players: { [id: number]: RemotePlayer } = {};
	private sendTimer: number = 0;
	private applyingRemoteScenario: boolean = false;

	constructor(world: World)
	{
		this.world = world;
		this.world.registerUpdatable(this);

		this.client.onJoined = (code, id, players, scenario) =>
		{
			this.active = true;

			players.forEach((info) => this.addPlayer(info));
			this.refreshHud();

			if (scenario !== null && scenario !== undefined && scenario !== this.world.lastScenarioID)
			{
				this.applyScenario(scenario);
			}
		};

		this.client.onPlayerJoin = (info) =>
		{
			this.addPlayer(info);
			this.refreshHud();
		};

		this.client.onPlayerLeave = (id) =>
		{
			if (this.players[id] !== undefined)
			{
				this.players[id].dispose();
				delete this.players[id];
			}
			this.refreshHud();
		};

		this.client.onPlayerState = (message) =>
		{
			let player = this.players[message.id];
			if (player !== undefined) player.applyState(message);
		};

		this.client.onVehicleState = (message) =>
		{
			let player = this.players[message.id];
			if (player !== undefined) player.applyVehicleState(message);
		};

		this.client.onIdentity = (info) =>
		{
			let player = this.players[info.id];
			if (player !== undefined) player.setIdentity(info.name, info.color);
			this.refreshHud();
		};

		this.client.onScenario = (id) =>
		{
			this.applyScenario(id);
		};

		this.client.onDisconnect = () =>
		{
			this.leave('Lost the connection to the party server.');
		};
	}

	public host(url: string, identity: PlayerIdentity): Promise<void>
	{
		return this.client.connect(url).then(() =>
		{
			NetworkClient.saveUrl(url);
			this.client.createRoom(identity.name, identity.color, this.world.lastScenarioID);
		});
	}

	public join(url: string, code: string, identity: PlayerIdentity): Promise<void>
	{
		return this.client.connect(url).then(() =>
		{
			NetworkClient.saveUrl(url);
			this.client.joinRoom(code, identity.name, identity.color);
		});
	}

	public leave(reason?: string): void
	{
		if (!this.active && !this.client.connected) return;

		this.active = false;
		this.client.disconnect();

		for (const id in this.players)
		{
			if (this.players.hasOwnProperty(id)) this.players[id].dispose();
		}
		this.players = {};

		this.refreshHud();

		if (reason !== undefined) console.warn(reason);
	}

	/** Tells the party the local player's name or colour changed. */
	public publishIdentity(identity: PlayerIdentity): void
	{
		if (!this.active) return;

		this.client.send({ t: 'identity', name: identity.name, color: identity.color });
	}

	/**
	 * Called after any scenario launch. Launching wipes every entity, remote
	 * characters included, so they have to be rebuilt either way. Whoever
	 * launched it locally also tells the rest of the party to follow.
	 */
	public onScenarioLaunched(scenarioID: string): void
	{
		if (!this.active) return;

		if (!this.applyingRemoteScenario)
		{
			this.client.send({ t: 'scenario', id: scenarioID });
		}

		this.rebuildPlayers();
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		if (!this.active || !this.client.connected) return;

		this.sendTimer += unscaledTimeStep;
		if (this.sendTimer < PartySession.SEND_INTERVAL) return;
		this.sendTimer = 0;

		this.publishLocalState();
	}

	private publishLocalState(): void
	{
		let character = this.world.localCharacter;
		if (character === undefined) return;

		let seat = character.occupyingSeat;
		let vehicle = seat !== null ? (seat.vehicle as unknown as Vehicle) : undefined;
		let vehicleId = (vehicle !== undefined && vehicle.spawnPoint !== undefined) ? vehicle.spawnPoint.name : null;

		this.client.send({
			t: 'state',
			p: PartySession.round3([character.position.x, character.position.y, character.position.z]),
			q: PartySession.round3([character.quaternion.x, character.quaternion.y, character.quaternion.z, character.quaternion.w]),
			a: character.currentAnimation,
			v: vehicleId,
			s: vehicle !== undefined ? vehicle.seats.indexOf(seat) : -1
		});

		// Only the driver is authoritative for where the vehicle is
		if (vehicle !== undefined && vehicle.controllingCharacter === character)
		{
			let body = vehicle.collision;

			this.client.send({
				t: 'vehicle',
				p: PartySession.round3([body.position.x, body.position.y, body.position.z]),
				q: PartySession.round3([body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w])
			});
		}
	}

	private applyScenario(id: string): void
	{
		this.applyingRemoteScenario = true;
		this.world.launchScenario(id);
		this.applyingRemoteScenario = false;
	}

	private addPlayer(info: PlayerInfo): void
	{
		if (this.players[info.id] !== undefined) return;

		this.players[info.id] = new RemotePlayer(this.world, info);
	}

	/** Their characters were destroyed with the rest of the scenario, so respawn them. */
	private rebuildPlayers(): void
	{
		let infos: PlayerInfo[] = [];

		for (const id in this.players)
		{
			if (this.players.hasOwnProperty(id))
			{
				infos.push(this.players[id].info);
				this.players[id].dispose();
			}
		}

		this.players = {};
		infos.forEach((info) => this.addPlayer(info));
	}

	private refreshHud(): void
	{
		if (!this.active)
		{
			UIManager.setPartyVisible(false);
			return;
		}

		let names = [this.world.localPlayer.name];
		let colors = [this.world.localPlayer.color];

		for (const id in this.players)
		{
			if (this.players.hasOwnProperty(id))
			{
				names.push(this.players[id].info.name);
				colors.push(this.players[id].info.color);
			}
		}

		UIManager.setPartyVisible(true);
		UIManager.setPartyDetails(this.client.code, names, colors);
	}

	private static round3(values: number[]): number[]
	{
		return values.map((value) => Math.round(value * 1000) / 1000);
	}
}
