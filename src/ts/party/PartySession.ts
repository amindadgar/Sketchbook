import Swal from 'sweetalert2';

import { World } from '../world/World';
import { Vehicle } from '../vehicles/Vehicle';
import { IUpdatable } from '../interfaces/IUpdatable';
import { NetworkClient, PlayerInfo } from './NetworkClient';
import { RemotePlayer } from './RemotePlayer';
import { PlayerIdentity } from './PlayerIdentity';
import { UIManager } from '../core/UIManager';
import * as THREE from 'three';

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
	private pending: { resolve: () => void, reject: (error: Error) => void };
	private pendingTimer: number;
	private notice: string;
	private localScore: number = 0;

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

			this.settle();
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

		this.client.onShot = (message) =>
		{
			this.world.combat.showRemoteShot(
				new THREE.Vector3(message.p[0], message.p[1], message.p[2]),
				new THREE.Vector3(message.d[0], message.d[1], message.d[2]),
				message.w);
		};

		this.client.onHit = (message) =>
		{
			// Relayed to the whole room, but only the player it names is hit
			if (message.target !== this.client.id) return;

			this.world.combat.takeRemoteHit(message.damage, message.id);
		};

		this.client.onScore = (id, score) =>
		{
			if (id === this.client.id) this.localScore = score;
			else if (this.players[id] !== undefined) this.players[id].info.score = score;

			this.refreshScoreboard();
		};

		this.client.onError = (message) =>
		{
			// Before the room is confirmed this is a refusal, after it it's a kick
			if (this.pending !== undefined) this.settle(new Error(message));
			else this.notice = message;
		};

		this.client.onDisconnect = () =>
		{
			let reason = this.notice !== undefined ? this.notice : 'The connection to the party server dropped.';
			this.notice = undefined;

			this.leave();

			Swal.fire({
				icon: 'info',
				title: 'Party ended',
				text: reason,
				buttonsStyling: false
			});
		};
	}

	public host(url: string, identity: PlayerIdentity): Promise<void>
	{
		return this.client.connect(url).then(() =>
		{
			NetworkClient.saveUrl(url);
			return this.awaitRoom(() =>
				this.client.createRoom(identity.name, identity.color, this.world.lastScenarioID));
		});
	}

	public join(url: string, code: string, identity: PlayerIdentity): Promise<void>
	{
		return this.client.connect(url).then(() =>
		{
			NetworkClient.saveUrl(url);
			return this.awaitRoom(() => this.client.joinRoom(code, identity.name, identity.color));
		});
	}

	/**
	 * Settles once the server confirms the room rather than when the socket opens.
	 * A wrong code used to close the menu and start the game as though it had
	 * worked, with the refusal arriving after there was anywhere left to show it.
	 */
	private awaitRoom(request: () => void): Promise<void>
	{
		return new Promise<void>((resolve, reject) =>
		{
			this.pending = { resolve: resolve, reject: reject };
			this.pendingTimer = window.setTimeout(() =>
			{
				this.settle(new Error('The party server didn\'t answer.'));
			}, 8000);

			request();
		});
	}

	private settle(error?: Error): void
	{
		if (this.pending === undefined) return;

		window.clearTimeout(this.pendingTimer);

		let pending = this.pending;
		this.pending = undefined;

		if (error !== undefined)
		{
			this.client.disconnect();
			pending.reject(error);
		}
		else
		{
			pending.resolve();
		}
	}

	public leave(): void
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

	public publishShot(from: THREE.Vector3, direction: THREE.Vector3, weaponId: string): void
	{
		if (!this.active) return;

		this.client.send({
			t: 'shot',
			p: PartySession.round3([from.x, from.y, from.z]),
			d: PartySession.round3([direction.x, direction.y, direction.z]),
			w: weaponId
		});
	}

	/** Their client owns their health, so a hit is a request, not a verdict. */
	public publishHit(targetId: number, damage: number): void
	{
		if (!this.active) return;

		this.client.send({ t: 'hit', target: targetId, damage: damage });
	}

	public publishDeath(killerId: number): void
	{
		if (!this.active) return;

		this.client.send({ t: 'death', killer: killerId });
	}

	/** Works out of a party too, where it's just you and your score. */
	public refreshScoreboard(): void
	{
		let names = [this.world.localPlayer.name];
		let colors = [this.world.localPlayer.color];
		let scores = [this.localScore];

		for (const id in this.players)
		{
			if (!this.players.hasOwnProperty(id)) continue;

			let info = this.players[id].info;
			names.push(info.name);
			colors.push(info.color);
			scores.push(info.score !== undefined ? info.score : 0);
		}

		UIManager.setScoreboard(names, colors, scores);
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

		// Kept current here rather than at join: the character is replaced on every
		// scenario change, and hits are addressed by this
		character.networkId = this.client.id;

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
			this.refreshScoreboard();
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

		this.refreshScoreboard();
	}

	private static round3(values: number[]): number[]
	{
		return values.map((value) => Math.round(value * 1000) / 1000);
	}
}
