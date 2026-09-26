import Swal from 'sweetalert2';

import { World } from '../world/World';
import { Vehicle } from '../vehicles/Vehicle';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { SeatType } from '../enums/SeatType';
import { IUpdatable } from '../interfaces/IUpdatable';
import { NetworkClient, PlayerInfo } from './NetworkClient';
import { RemotePlayer } from './RemotePlayer';
import { PlayerIdentity } from './PlayerIdentity';
import { Account } from './Account';
import { UIManager } from '../core/UIManager';
import * as THREE from 'three';
import * as CANNON from 'cannon';

/**
 * Holds a party together: keeps the connection, mirrors everyone else into the
 * world as RemotePlayers, and publishes the local player's transform.
 */
export class PartySession implements IUpdatable
{
	// Last, so what gets published is the transform this frame actually ended on
	public updateOrder: number = 20;

	private static readonly SEND_INTERVAL: number = 1 / 20;
	/**
	 * A car let go of keeps being reported, less often, until it comes to rest.
	 * Left to each client's own physics a car still rolling down a hill ends up
	 * somewhere different on every screen. The cap is only a backstop.
	 */
	private static readonly COAST_INTERVAL: number = 1 / 10;
	private static readonly COAST_TIME: number = 30;
	/** How long a report for a vehicle that hasn't spawned here yet is kept for it. */
	private static readonly PENDING_TIME: number = 15;

	public client: NetworkClient = new NetworkClient();
	public active: boolean = false;

	/** Round state, mirrored from the server and counted down between updates. */
	private matchPhase: string;
	private matchRemaining: number = 0;
	private matchRound: number;
	private shownSeconds: number = -1;

	private world: World;
	private players: { [id: number]: RemotePlayer } = {};
	private sendTimer: number = 0;
	private applyingRemoteScenario: boolean = false;
	private pending: { resolve: () => void, reject: (error: Error) => void };
	private pendingTimer: number;
	private notice: string;
	private localScore: number = 0;
	/** What the relay said it can do beyond the original protocol. Empty for an older relay. */
	private features: string[] = [];

	/**
	 * Who holds which seat, as the relay last said: 'vehicle#seat' to the id of
	 * the member holding it. The relay decides, first claim first, because two
	 * clients each checking their own copy of a car would both see it empty
	 * and both climb into the same seat.
	 */
	private seatHolders: { [key: string]: number } = {};
	/** The same the other way round, each member's claim. */
	private memberSeats: { [id: number]: string } = {};
	/** The claim this client last sent, null for none. */
	private claimedKey: string = null;

	/** Vehicle id to the member whose reports it last followed. */
	private lastDrivers: { [vehicleId: string]: number } = {};
	/** The vehicle the local player drove as of the last frame. */
	private drivenVehicle: Vehicle;
	/** Vehicles the local player let go of, still reported while they come to rest. */
	private coasting: { vehicle: Vehicle, until: number, timer: number, still: number }[] = [];
	/** Reports for vehicles that haven't spawned here yet. */
	private pendingVehicles: { [vehicleId: string]: { message: any, sender: number, at: number } } = {};

	constructor(world: World)
	{
		this.world = world;
		this.world.registerUpdatable(this);

		this.client.onJoined = (message) =>
		{
			this.active = true;
			this.features = Array.isArray(message.features) ? message.features : [];
			this.clearSharedState();

			let players: PlayerInfo[] = Array.isArray(message.players) ? message.players : [];
			players.forEach((info) => this.addPlayer(info));
			this.refreshHud();

			// A race or stunt run gives everyone a car of their own, and which one
			// depends on who is in the party, so joining one already going means
			// starting it afresh here even when it's the one already loaded
			let scenario = message.scenario;
			if (scenario !== null && scenario !== undefined
				&& (scenario !== this.world.lastScenarioID || this.world.scenarioHasPartyGrid(scenario)))
			{
				this.applyScenario(scenario);
			}

			// After any launch, which starts all of this afresh
			if (Array.isArray(message.seats)) message.seats.forEach((seat) => this.recordSeat(seat));

			// Where the room has moved the cars to, applied as each one spawns
			if (Array.isArray(message.vehicles))
			{
				message.vehicles.forEach((entry) =>
				{
					if (entry !== null && typeof entry.v === 'string')
					{
						this.pendingVehicles[entry.v] = { message: Object.assign({}, entry, { f: 1 }), sender: undefined, at: PartySession.now() };
					}
				});
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
			this.recordSeat({ id: id, v: null });

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
			this.receiveVehicle(message);
		};

		this.client.onIdentity = (info) =>
		{
			let player = this.players[info.id];
			if (player !== undefined) player.setIdentity(info.name, info.color, info.hat);
			this.refreshHud();
		};

		this.client.onScenario = (message) =>
		{
			if (typeof message.id !== 'string') return;

			// A newer relay sends a change back to whoever made it as well, and
			// everyone applies changes in the order it saw them. Our own comes
			// back already applied, unless someone else's landed in between.
			if (message.by !== undefined && message.by === this.client.id)
			{
				if (this.world.lastScenarioID !== message.id) this.applyScenario(message.id);
				else this.clearSharedState();
				return;
			}

			this.applyScenario(message.id);
		};

		this.client.onSeat = (message) =>
		{
			this.recordSeat(message);
		};

		this.client.onShot = (message) =>
		{
			let from = PartySession.readVector(message.p);
			let direction = PartySession.readVector(message.d);
			if (from === undefined || direction === undefined) return;

			let ends: THREE.Vector3[];
			if (Array.isArray(message.e))
			{
				ends = message.e.map((point) => PartySession.readVector(point)).filter((point) => point !== undefined);
			}

			let shooter = this.players[message.id];

			this.world.combat.showRemoteShot(from, direction, message.w,
				shooter !== undefined ? shooter.character : undefined, ends);

			// Pedestrians near someone else's gunfire run too
			if (this.world.npcs !== undefined) this.world.npcs.onGunshot(from);
		};

		// The city's people and traffic, from whoever simulates them
		this.client.onNpcs = (message) =>
		{
			if (this.world.npcs !== undefined) this.world.npcs.applySnapshot(message);
		};

		this.client.onNpcSteal = (message) =>
		{
			if (this.world.npcs !== undefined) this.world.npcs.onStolen(Number(message.n), PartySession.readVector(message.p));
		};

		this.client.onBreak = (message) =>
		{
			let city = this.world.city;
			let velocity = PartySession.readVector(message.v) || new THREE.Vector3();
			if (city !== undefined && typeof message.b === 'number') city.breakables.knockRemote(message.b, velocity);
		};

		// Someone else shot a pedestrian; this client decides what happens to them
		this.client.onNpcHit = (message) =>
		{
			let from = PartySession.readVector(message.p) || new THREE.Vector3();
			let damage = Number(message.d);
			if (this.world.npcs !== undefined && isFinite(damage)) this.world.npcs.damagePedestrian(Number(message.n), damage, from);
		};

		this.client.onHit = (message) =>
		{
			// A newer relay only sends it to the player it names; an older one
			// sends it to the whole room
			if (message.target !== this.client.id) return;
			if (typeof message.damage !== 'number' || !isFinite(message.damage)) return;

			this.world.combat.takeRemoteHit(message.damage, message.id, PartySession.readVector(message.p), message.w,
				typeof message.l === 'number' ? message.l : undefined);
		};

		this.client.onHurt = (message) =>
		{
			this.world.combat.confirmHit(message.dead === true);
		};

		this.client.onPickup = (message) =>
		{
			if (typeof message.i === 'number') this.world.combat.remotePickup(message.i);
		};

		this.client.onDeath = (message) =>
		{
			let victim = this.players[message.id];
			let killer = message.killer !== undefined ? this.players[message.killer] : undefined;
			let killedByMe = message.killer === this.client.id;

			// Down straight away, rather than at their next movement update
			if (victim !== undefined && victim.character !== undefined) victim.character.health = 0;

			this.world.notices.kill(
				killedByMe ? this.world.localPlayer.name : (killer !== undefined ? killer.info.name : 'The scenery'),
				killedByMe ? this.world.localPlayer.color : (killer !== undefined ? killer.info.color : '#9a9a9a'),
				victim !== undefined ? victim.info.name : 'Someone',
				victim !== undefined ? victim.info.color : '#9a9a9a',
				(killedByMe || killer !== undefined) ? message.w : undefined);

			if (killedByMe) this.world.combat.creditKill();
		};

		this.client.onChat = (message) =>
		{
			this.world.chat.receive(message.name, message.color, message.text);
		};

		this.client.onMatch = (message) =>
		{
			this.matchPhase = message.phase;
			this.matchRemaining = message.remaining;

			UIManager.setMatchResult(message.phase === 'over' ? message.results : undefined);

			// Only when the round number moves on. The deadline is repeated every
			// few seconds to keep the clock honest, and treating those as the
			// start of a round wiped the scoreboard while people were playing.
			if (this.matchRound !== undefined && message.round !== this.matchRound)
			{
				this.localScore = 0;
				for (const id in this.players)
				{
					if (this.players.hasOwnProperty(id)) this.players[id].info.score = 0;
				}
				this.refreshScoreboard();
			}

			this.matchRound = message.round;
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
				this.client.createRoom(identity.name, identity.color, identity.hat,
					this.world.lastScenarioID, Account.token));
		});
	}

	public join(url: string, code: string, identity: PlayerIdentity): Promise<void>
	{
		return this.client.connect(url).then(() =>
		{
			NetworkClient.saveUrl(url);
			return this.awaitRoom(() =>
			this.client.joinRoom(code, identity.name, identity.color, identity.hat, Account.token));
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
		this.matchPhase = undefined;
		this.matchRound = undefined;
		this.shownSeconds = -1;
		UIManager.setMatchClock(undefined);
		UIManager.setMatchResult(undefined);

		if (!this.active && !this.client.connected) return;

		this.active = false;
		this.features = [];
		this.client.disconnect();

		for (const id in this.players)
		{
			if (this.players.hasOwnProperty(id)) this.players[id].dispose();
		}
		this.players = {};

		// Whatever other people were driving goes back to this world's own physics
		this.world.vehicles.forEach((vehicle) => vehicle.clearRemoteTarget());
		this.clearSharedState();

		// The party's score has nothing to do with playing alone
		this.localScore = 0;
		this.refreshHud();
	}

	/** Tells the party the local player's name or colour changed. */
	public publishIdentity(identity: PlayerIdentity): void
	{
		if (!this.active) return;

		this.client.send({ t: 'identity', name: identity.name, color: identity.color, hat: identity.hat });
	}

	/** Where everyone in the city is, from the client that simulates them. */
	public publishNpcs(snapshot: any): void
	{
		if (!this.active || !this.hasFeature('npcs')) return;
		this.client.send(snapshot);
	}

	/** A shot at a pedestrian, for the client that simulates them to apply. */
	public sendNpcHit(id: number, damage: number, from: THREE.Vector3): void
	{
		if (!this.active) return;
		this.client.send({ t: 'npcHit', n: id, d: damage, p: [from.x, from.y, from.z] });
	}

	/**
	 * Anything nobody drives that the local player's car is touching and
	 * moving: pushed slowly, or kept pushing after the first knock, it's
	 * reported for as long as it's being moved, not just from the first hit.
	 */
	private trackPushing(): void
	{
		if (this.drivenVehicle === undefined) return;
		let own = this.drivenVehicle.collision;
		for (const contact of this.world.physicsWorld.contacts)
		{
			let other = contact.bi === own ? contact.bj : (contact.bj === own ? contact.bi : undefined);
			if (other === undefined || other.sleepState === CANNON.Body.SLEEPING || other.velocity.length() < 0.2) continue;
			let pushed = this.world.vehicles.find((vehicle) => vehicle.collision === other);
			if (pushed !== undefined && pushed.controllingCharacter === undefined) this.shoved(pushed);
		}
	}

	/**
	 * A car nobody is driving, just hit by the local player's: reported until
	 * it comes to rest, so it ends up in the same place on every screen.
	 */
	public shoved(vehicle: Vehicle): void
	{
		if (!this.active || vehicle.getNetworkId() === undefined || vehicle.isRemoteDriven()) return;
		if (vehicle === this.drivenVehicle || this.driverSeatHeldByOther(vehicle)) return;

		let until = PartySession.now() + PartySession.COAST_TIME;
		let entry = this.coasting.find((candidate) => candidate.vehicle === vehicle);
		if (entry !== undefined)
		{
			entry.until = until;
			entry.still = 0;
		}
		else this.coasting.push({ vehicle: vehicle, until: until, timer: 0, still: 0 });
	}

	/** A car that has just appeared here, so the room and everyone in it have it before anyone drives it. */
	public announceVehicle(vehicle: Vehicle): void
	{
		if (!this.active || !this.client.connected) return;
		this.publishVehicle(vehicle, true);
	}

	/** A car this player took out of the traffic, for the client that simulates it to clear away. */
	public sendNpcSteal(id: number, door: THREE.Vector3): void
	{
		if (!this.active || !this.hasFeature('steal')) return;
		this.client.send({ t: 'npcSteal', n: id, p: [door.x, door.y, door.z] });
	}

	/** A lamp or sign this player's car knocked over, so it falls on everyone's screen. */
	public sendBreak(id: number, velocity: THREE.Vector3): void
	{
		if (!this.active || !this.hasFeature('breakables')) return;
		this.client.send({ t: 'break', b: id, v: PartySession.round3([velocity.x, velocity.y, velocity.z]) });
	}

	/** Whether the relay supports something beyond the original protocol. */
	public hasFeature(name: string): boolean
	{
		return this.active && this.features.indexOf(name) >= 0;
	}

	/**
	 * Called after any scenario launch. Launching wipes every entity, remote
	 * characters included, so they have to be rebuilt either way. Whoever
	 * launched it locally also tells the rest of the party to follow.
	 */
	public onScenarioLaunched(scenarioID: string): void
	{
		if (!this.active) return;

		// Every seat and every car is new
		this.clearSharedState();

		if (!this.applyingRemoteScenario)
		{
			this.client.send({ t: 'scenario', id: scenarioID });
		}

		this.rebuildPlayers();
	}

	/**
	 * The muzzle, the aim, and where each pellet actually ended, so everyone
	 * else draws the shot that was fired rather than working out their own.
	 */
	public publishShot(from: THREE.Vector3, direction: THREE.Vector3, weaponId: string, endpoints: THREE.Vector3[]): void
	{
		if (!this.active) return;

		this.client.send({
			t: 'shot',
			p: PartySession.round3([from.x, from.y, from.z]),
			d: PartySession.round3([direction.x, direction.y, direction.z]),
			w: weaponId,
			e: endpoints.slice(0, 8).map((point) => PartySession.round3([point.x, point.y, point.z]))
		});
	}

	/**
	 * Their client owns their health, so a hit is a request, not a verdict.
	 * The weapon and the place it was fired from travel with it: the relay uses
	 * them to check the claim is possible, and the client being shot at uses
	 * them to check there wasn't a wall in the way. The life it was aimed at
	 * comes too, so a hit on someone who has since respawned can be told apart.
	 */
	public publishHit(targetId: number, damage: number, weaponId: string, from: THREE.Vector3, targetLife?: number): void
	{
		if (!this.active) return;

		let message: any = {
			t: 'hit',
			target: targetId,
			damage: damage,
			w: weaponId,
			p: PartySession.round3([from.x, from.y, from.z])
		};

		if (typeof targetLife === 'number') message.l = targetLife;

		this.client.send(message);
	}

	/** Tells a shooter their hit counted, which is what lights their hit marker. */
	public publishHurt(attackerId: number, damage: number, dead: boolean): void
	{
		if (!this.active || attackerId === undefined) return;

		this.client.send({ t: 'hurt', to: attackerId, damage: damage, dead: dead });
	}

	public publishPickup(index: number): void
	{
		if (!this.active) return;

		this.client.send({ t: 'pickup', i: index });
	}

	public publishChat(text: string): void
	{
		if (!this.active) return;

		this.client.send({ t: 'chat', text: text });
	}

	public publishDeath(killerId: number, weaponId?: string): void
	{
		if (!this.active) return;

		this.client.send({ t: 'death', killer: killerId, w: weaponId });
	}

	/**
	 * The room hears about a death from the relay, but the player who died is
	 * excluded from that broadcast, so their own line is written here. Works
	 * outside a party too, where it's the only line there is.
	 */
	public reportOwnDeath(killerId: number, weaponId?: string): void
	{
		let killer = killerId !== undefined ? this.players[killerId] : undefined;

		this.world.notices.kill(
			killer !== undefined ? killer.info.name : 'The scenery',
			killer !== undefined ? killer.info.color : '#9a9a9a',
			this.world.localPlayer.name, this.world.localPlayer.color,
			killer !== undefined ? weaponId : undefined);
	}

	// ------------------------------------------------------------------- seats

	/** The key a seat is claimed under, or undefined for a vehicle with no id. */
	public static seatKey(seat: VehicleSeat): string
	{
		let vehicle = seat.vehicle as unknown as Vehicle;
		let id = vehicle.getNetworkId();
		if (id === undefined) return undefined;

		return id + '#' + vehicle.seats.indexOf(seat);
	}

	/** The id of the member holding a seat, or undefined. */
	public seatHolder(seat: VehicleSeat): number
	{
		if (!this.hasFeature('seats')) return undefined;

		let key = PartySession.seatKey(seat);
		return key !== undefined ? this.seatHolders[key] : undefined;
	}

	/** Another member has claimed it. */
	public isSeatHeldByOther(seat: VehicleSeat): boolean
	{
		let holder = this.seatHolder(seat);
		return holder !== undefined && holder !== this.client.id;
	}

	/**
	 * The relay has given this seat to the local player. Always true outside a
	 * party, or against a relay too old to hand seats out, where the local
	 * checks are all there is.
	 */
	public isSeatConfirmed(seat: VehicleSeat): boolean
	{
		if (!this.hasFeature('seats')) return true;

		let key = PartySession.seatKey(seat);
		return key === undefined || this.seatHolders[key] === this.client.id;
	}

	/** Whichever seat a member has claimed, if it exists in this world. */
	public seatOf(id: number): VehicleSeat
	{
		let key = this.memberSeats[id];
		if (key === undefined) return undefined;

		let split = key.lastIndexOf('#');
		let vehicle = this.findVehicle(key.substring(0, split));

		return vehicle !== undefined ? vehicle.seats[Number(key.substring(split + 1))] : undefined;
	}

	/** Everyone in the party, this player included. */
	public memberIds(): number[]
	{
		let ids = [this.client.id];

		for (const id in this.players)
		{
			if (this.players.hasOwnProperty(id)) ids.push(Number(id));
		}

		return ids;
	}

	/**
	 * A computer driver sitting where a party member wants to be gives the car
	 * up. They're placeholders on a race grid, and each client has its own,
	 * so the car goes to the person rather than being argued over.
	 */
	public evictAi(seat: VehicleSeat): void
	{
		let occupant = seat.occupiedBy;
		if (occupant === null || occupant === this.world.localCharacter || occupant.behaviour === undefined) return;

		let vehicle = seat.vehicle as unknown as Vehicle;
		if (vehicle.controllingCharacter === occupant)
		{
			vehicle.controllingCharacter = undefined;
			vehicle.resetControls();
		}

		occupant.controlledObject = undefined;
		occupant.leaveSeat();

		if (this.world.characters.indexOf(occupant) >= 0) this.world.remove(occupant);
	}

	/** One member's seat as the relay announced it: taken, moved, or given up. */
	private recordSeat(message: any): void
	{
		let id = message.id;
		if (typeof id !== 'number') return;

		let previous = this.memberSeats[id];
		if (previous !== undefined)
		{
			if (this.seatHolders[previous] === id) delete this.seatHolders[previous];
			delete this.memberSeats[id];
		}

		let key: string = null;
		if (typeof message.v === 'string' && typeof message.s === 'number')
		{
			key = message.v + '#' + message.s;
			this.seatHolders[key] = id;
			this.memberSeats[id] = key;
		}

		if (id === this.client.id)
		{
			// The relay's word on our own claim wins. When it has let one go for
			// us, having heard nothing while this tab was in the background, the
			// next reconcile claims it again if it's still wanted.
			this.claimedKey = key;
		}
		else if (key === null)
		{
			if (this.players[id] !== undefined) this.players[id].seatReleased();
		}
		else
		{
			// Their own car from a race grid, which this client may still have a
			// computer driver in, or never have made if they joined later
			let seat = this.seatOf(id);
			if (seat !== undefined) this.evictAi(seat);
			else this.world.spawnPartyVehicle(message.v);
		}
	}

	/**
	 * Keeps the relay's idea of the local player's seat in step with the seat
	 * they're in, climbing into or walking toward, and backs off one the
	 * relay has given to someone else. Every frame, since a claim made at the
	 * moment F is pressed is what stops two people walking to the same door.
	 */
	private reconcileSeat(): void
	{
		let character = this.world.localCharacter;
		let wanted = (character !== undefined && character.world !== undefined) ? character.getSeatOfInterest() : null;
		let key = wanted !== null ? PartySession.seatKey(wanted) : null;
		if (key === undefined) key = null;

		if (key !== null)
		{
			let holder = this.seatHolders[key];
			if (holder !== undefined && holder !== this.client.id)
			{
				character.yieldSeat(wanted);
				return;
			}
		}

		if (key === this.claimedKey) return;
		this.claimedKey = key;

		if (key === null)
		{
			this.client.send({ t: 'claim', v: null, s: -1 });
		}
		else
		{
			let vehicle = wanted.vehicle as unknown as Vehicle;
			this.client.send({ t: 'claim', v: vehicle.getNetworkId(), s: vehicle.seats.indexOf(wanted) });
		}
	}

	// ---------------------------------------------------------------- vehicles

	/**
	 * Only the driver's client simulates a vehicle for real; everyone else's is
	 * steered after its reports. A report counts only from whoever holds that
	 * vehicle's driver's seat, or, with nobody in it, from whoever drove it
	 * last and is still reporting it rolling to a stop. Anything else, like a
	 * second client that thinks it's driving the same car, is ignored rather
	 * than left to fight over it. And never while anyone here is at the wheel.
	 */
	private acceptsVehicleFrom(vehicle: Vehicle, sender: number): boolean
	{
		if (vehicle.controllingCharacter !== undefined) return false;

		let id = vehicle.getNetworkId();

		if (this.hasFeature('seats'))
		{
			let driver: number;

			vehicle.seats.forEach((seat, index) =>
			{
				let holder = this.seatHolders[id + '#' + index];
				if (seat.type === SeatType.Driver && holder !== undefined) driver = holder;
			});

			if (driver !== undefined) return driver === sender;
		}
		else
		{
			// No claims to go on, so whoever is sitting at the wheel here
			let player = this.players[sender];
			let seat = (player !== undefined && player.character !== undefined) ? player.character.occupyingSeat : null;
			if (seat !== null && seat.type === SeatType.Driver && (seat.vehicle as unknown as Vehicle) === vehicle) return true;
		}

		// Both of us shoved it at once: the lower id keeps reporting it and the
		// other follows, or each copy would chase the other's
		let mine = this.coasting.findIndex((entry) => entry.vehicle === vehicle);
		if (mine >= 0)
		{
			if (sender > this.client.id) return false;
			this.coasting.splice(mine, 1);
		}

		return this.lastDrivers[id] === undefined || this.lastDrivers[id] === sender;
	}

	private receiveVehicle(message: any): void
	{
		let vehicle: Vehicle;

		if (typeof message.v === 'string')
		{
			vehicle = this.findVehicle(message.v);

			if (vehicle === undefined)
			{
				// Still loading here, or a spare party car this client hasn't made
				// yet; kept for when it turns up
				this.pendingVehicles[message.v] = { message: message, sender: message.id, at: PartySession.now() };
				this.world.spawnPartyVehicle(message.v, message);
				return;
			}
		}
		else
		{
			// An older client doesn't name the vehicle, so it's whatever they sit in
			let player = this.players[message.id];
			let seat = (player !== undefined && player.character !== undefined) ? player.character.occupyingSeat : null;
			if (seat === null || seat.type !== SeatType.Driver) return;
			vehicle = seat.vehicle as unknown as Vehicle;
		}

		if (!this.acceptsVehicleFrom(vehicle, message.id)) return;

		let id = vehicle.getNetworkId();
		if (id !== undefined)
		{
			// Once it has come to rest nobody owns it, so whoever moves it next
			// is listened to, a player shoving it as much as one driving it
			if (message.f === 1 || message.f === true) delete this.lastDrivers[id];
			else this.lastDrivers[id] = message.id;
		}

		this.steerVehicle(vehicle, message);
	}

	private steerVehicle(vehicle: Vehicle, message: any): void
	{
		let position = PartySession.readVector(message.p);
		if (position === undefined || !Array.isArray(message.q) || message.q.length < 4) return;

		let quaternion = new THREE.Quaternion(message.q[0], message.q[1], message.q[2], message.q[3]);
		if (!isFinite(quaternion.x) || !isFinite(quaternion.y) || !isFinite(quaternion.z) || !isFinite(quaternion.w)) return;
		if (quaternion.lengthSq() < 0.5) return;

		let velocity = PartySession.readVector(message.lv) || new THREE.Vector3();
		let angularVelocity = PartySession.readVector(message.av) || new THREE.Vector3();

		vehicle.setRemoteTarget(position, quaternion, velocity, angularVelocity, message.f === 1 || message.f === true);
	}

	/** Reports that arrived before their vehicle did, applied once it has. */
	private applyPendingVehicles(): void
	{
		let now = PartySession.now();

		for (const id in this.pendingVehicles)
		{
			if (!this.pendingVehicles.hasOwnProperty(id)) continue;

			let entry = this.pendingVehicles[id];
			if (now - entry.at > PartySession.PENDING_TIME)
			{
				delete this.pendingVehicles[id];
				continue;
			}

			let vehicle = this.findVehicle(id);
			if (vehicle === undefined)
			{
				this.world.spawnPartyVehicle(id, entry.message);
				continue;
			}

			delete this.pendingVehicles[id];

			// From the room's memory rather than anyone in particular
			if (entry.sender === undefined)
			{
				if (vehicle.controllingCharacter === undefined) this.steerVehicle(vehicle, entry.message);
				continue;
			}

			if (!this.acceptsVehicleFrom(vehicle, entry.sender)) continue;

			if (entry.message.f === 1 || entry.message.f === true) delete this.lastDrivers[id];
			else this.lastDrivers[id] = entry.sender;
			this.steerVehicle(vehicle, entry.message);
		}
	}

	/** Notices the local player letting go of a vehicle, which then coasts under our reports. */
	private trackDrivenVehicle(): void
	{
		let character = this.world.localCharacter;
		let driving: Vehicle;

		if (character !== undefined && character.controlledObject !== undefined)
		{
			let vehicle = character.controlledObject as unknown as Vehicle;
			if (vehicle.controllingCharacter === character && vehicle.collision !== undefined) driving = vehicle;
		}

		if (driving === this.drivenVehicle) return;

		if (this.drivenVehicle !== undefined && this.drivenVehicle.world !== undefined)
		{
			this.coasting.push({ vehicle: this.drivenVehicle, until: PartySession.now() + PartySession.COAST_TIME, timer: 0, still: 0 });
		}

		this.drivenVehicle = driving;
		if (driving !== undefined) this.coasting = this.coasting.filter((entry) => entry.vehicle !== driving);
	}

	/**
	 * Keeps reporting a car after getting out, until it comes to rest, then
	 * says where it stopped. Otherwise everyone else's copy
	 * is left wherever it was when the driver let go, and parked cars drift
	 * apart between screens for good.
	 */
	private publishCoasting(timeStep: number): void
	{
		let now = PartySession.now();

		for (let i = this.coasting.length - 1; i >= 0; i--)
		{
			let entry = this.coasting[i];
			let vehicle = entry.vehicle;

			// Gone, driven by someone here, or claimed by someone else now
			if (vehicle.world === undefined || vehicle.controllingCharacter !== undefined || this.driverSeatHeldByOther(vehicle))
			{
				this.coasting.splice(i, 1);
				continue;
			}

			entry.timer -= timeStep;
			if (entry.timer > 0) continue;
			entry.timer = PartySession.COAST_INTERVAL;

			let body = vehicle.collision;
			let resting = body.sleepState === CANNON.Body.SLEEPING
				|| (body.velocity.length() < 0.05 && body.angularVelocity.length() < 0.05);

			// Still for half a second, not just at the bottom of one bounce
			entry.still = resting ? entry.still + 1 : 0;

			if (entry.still >= 5 || now >= entry.until)
			{
				this.publishVehicle(vehicle, true);
				this.coasting.splice(i, 1);
			}
			else
			{
				this.publishVehicle(vehicle, false);
			}
		}
	}

	private driverSeatHeldByOther(vehicle: Vehicle): boolean
	{
		for (const seat of vehicle.seats)
		{
			if (seat.type === SeatType.Driver && this.isSeatHeldByOther(seat)) return true;
		}

		return false;
	}

	private publishVehicle(vehicle: Vehicle, final: boolean): void
	{
		let id = vehicle.getNetworkId();
		if (id === undefined) return;

		let body = vehicle.collision;
		let message: any = {
			t: 'vehicle',
			v: id,
			p: PartySession.round3([body.position.x, body.position.y, body.position.z]),
			q: PartySession.round3([body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w]),
			lv: PartySession.round3([body.velocity.x, body.velocity.y, body.velocity.z]),
			av: PartySession.round3([body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z])
		};

		if (final) message.f = 1;

		this.client.send(message);
	}

	private findVehicle(id: string): Vehicle
	{
		for (const vehicle of this.world.vehicles)
		{
			if (vehicle.getNetworkId() === id) return vehicle;
		}

		return undefined;
	}

	/** Seats, who drove what, and anything waiting on a vehicle: none of it survives a launch. */
	private clearSharedState(): void
	{
		this.seatHolders = {};
		this.memberSeats = {};
		this.claimedKey = null;
		this.lastDrivers = {};
		this.pendingVehicles = {};
		this.coasting = [];
		this.drivenVehicle = undefined;
	}

	// ------------------------------------------------------------------- clock

	/**
	 * Counts down between the server's updates, so the clock moves every frame
	 * rather than once every five seconds, and gets corrected when one arrives.
	 */
	private tickMatchClock(unscaledTimeStep: number): void
	{
		if (this.matchPhase === undefined) return;

		this.matchRemaining = Math.max(0, this.matchRemaining - unscaledTimeStep);

		let seconds = Math.ceil(this.matchRemaining);
		if (seconds === this.shownSeconds) return;
		this.shownSeconds = seconds;

		UIManager.setMatchClock(this.matchPhase === 'over'
			? 'NEXT ROUND' : PartySession.mmss(seconds));
	}

	private static mmss(seconds: number): string
	{
		let minutes = Math.floor(seconds / 60);
		let rest = seconds % 60;
		return minutes + ':' + (rest < 10 ? '0' : '') + rest;
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

		this.tickMatchClock(unscaledTimeStep);

		if (this.hasFeature('seats')) this.reconcileSeat();
		this.trackDrivenVehicle();
		this.trackPushing();
		this.applyPendingVehicles();

		this.sendTimer += unscaledTimeStep;
		if (this.sendTimer >= PartySession.SEND_INTERVAL)
		{
			// Keeps to the cadence rather than drifting by whatever the frame overshot
			this.sendTimer = Math.min(this.sendTimer - PartySession.SEND_INTERVAL, PartySession.SEND_INTERVAL);
			this.publishLocalState();
		}

		this.publishCoasting(unscaledTimeStep);
	}

	/**
	 * World position and rotation. Opening a car door parents the character to
	 * the car, and from then until they're out again its own position is only
	 * where in the car it is; published as it was, everyone else saw them
	 * vanish to the middle of the map, under the ground.
	 */
	private publishLocalState(): void
	{
		let character = this.world.localCharacter;
		if (character === undefined || character.world === undefined) return;

		// Kept current here rather than at join: the character is replaced on every
		// scenario change, and hits are addressed by this
		character.networkId = this.client.id;

		let position = character.getWorldPosition(new THREE.Vector3());
		let quaternion = character.getWorldQuaternion(new THREE.Quaternion());

		let seat = character.occupyingSeat;
		let vehicle = seat !== null ? (seat.vehicle as unknown as Vehicle) : undefined;
		let vehicleId = vehicle !== undefined ? vehicle.getNetworkId() : undefined;
		if (vehicleId === undefined) vehicleId = null;

		this.client.send({
			t: 'state',
			p: PartySession.round3([position.x, position.y, position.z]),
			q: PartySession.round3([quaternion.x, quaternion.y, quaternion.z, quaternion.w]),
			a: character.currentAnimation,
			v: vehicleId,
			s: vehicleId !== null ? vehicle.seats.indexOf(seat) : -1,
			h: Math.round(character.health),
			w: character.weapon !== undefined ? character.weapon.id : null,
			l: this.world.combat.life
		});

		// Only the driver is authoritative for where the vehicle is
		if (this.drivenVehicle !== undefined) this.publishVehicle(this.drivenVehicle, false);
	}

	private applyScenario(id: string): void
	{
		this.applyingRemoteScenario = true;
		this.world.launchScenario(id, undefined, true);
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

	/** Three finite numbers as a vector, or undefined. */
	private static readVector(value: any): THREE.Vector3
	{
		if (!Array.isArray(value) || value.length < 3) return undefined;

		let x = value[0], y = value[1], z = value[2];
		if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return undefined;
		if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return undefined;

		return new THREE.Vector3(x, y, z);
	}

	private static now(): number
	{
		return performance.now() / 1000;
	}

	private static round3(values: number[]): number[]
	{
		return values.map((value) => Math.round(value * 1000) / 1000);
	}
}
