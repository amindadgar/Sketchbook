import * as THREE from 'three';
import * as CANNON from 'cannon';
import { ISpawnPoint } from '../interfaces/ISpawnPoint';
import { VehicleSpawnPoint } from './VehicleSpawnPoint';
import { CharacterSpawnPoint } from './CharacterSpawnPoint';
import { World } from '../world/World';
import { LoadingManager } from '../core/LoadingManager';
import { CollisionGroups } from '../enums/CollisionGroups';

export class Scenario
{
	public id: string;
	public name: string;
	public spawnAlways: boolean = false;
	public default: boolean = false;
	public world: World;
	public descriptionTitle: string;
	public descriptionContent: string;
	/**
	 * The path node the computer drivers are pointed at, when there are any.
	 * That ring of nodes is the track, so its presence is what makes a scenario
	 * a race rather than anything written down about its name.
	 */
	public racePath: string;
	/** How many laps a race is, when it isn't the usual. */
	public laps: number;
	
	private rootNode: THREE.Object3D;
	private spawnPoints: ISpawnPoint[] = [];
	private invisible: boolean = false;
	private initialCameraAngle: number;
	/** Spare party cars made this launch, by name, so one isn't made twice. */
	private partyExtras: { [name: string]: boolean } = {};

	/** Rows of spare cars behind the start, how far apart, and how far to either side. */
	private static readonly EXTRA_ROWS: number = 6;
	private static readonly EXTRA_SPACING: number = 6;
	private static readonly EXTRA_SIDE: number = 4;
	/** How near another spawn point a spare car may be parked. */
	private static readonly EXTRA_CLEARANCE: number = 4;

	constructor(root: THREE.Object3D, world: World)
	{
		this.rootNode = root;
		this.world = world;
		this.id = root.name;

		// Scenario
		if (root.userData.hasOwnProperty('name')) 
		{
			this.name = root.userData.name;
		}
		if (root.userData.hasOwnProperty('default') && root.userData.default === 'true') 
		{
			this.default = true;
		}
		if (root.userData.hasOwnProperty('spawn_always') && root.userData.spawn_always === 'true') 
		{
			this.spawnAlways = true;
		}
		if (root.userData.hasOwnProperty('invisible') && root.userData.invisible === 'true') 
		{
			this.invisible = true;
		}
		if (root.userData.hasOwnProperty('desc_title')) 
		{
			this.descriptionTitle = root.userData.desc_title;
		}
		if (root.userData.hasOwnProperty('desc_content')) 
		{
			this.descriptionContent = root.userData.desc_content;
		}
		if (root.userData.hasOwnProperty('camera_angle')) 
		{
			this.initialCameraAngle = root.userData.camera_angle;
		}
		if (root.userData.hasOwnProperty('laps'))
		{
			this.laps = Number(root.userData.laps);
		}

		if (!this.invisible) this.createLaunchLink();

		// Find all scenario spawns and enitites
		root.traverse((child) => {
			if (child.hasOwnProperty('userData') && child.userData.hasOwnProperty('data'))
			{
				if (child.userData.data === 'spawn')
				{
					if (child.userData.type === 'car' || child.userData.type === 'airplane' || child.userData.type === 'heli')
					{
						let sp = new VehicleSpawnPoint(child);

						if (child.userData.hasOwnProperty('type')) 
						{
							sp.type = child.userData.type;
						}

						if (child.userData.hasOwnProperty('driver')) 
						{
							sp.driver = child.userData.driver;

							if (child.userData.driver === 'ai' && child.userData.hasOwnProperty('first_node'))
							{
								sp.firstAINode = child.userData.first_node;
								this.racePath = child.userData.first_node;
							}
						}

						this.spawnPoints.push(sp);
					}
					else if (child.userData.type === 'player')
					{
						let sp = new CharacterSpawnPoint(child);
						this.spawnPoints.push(sp);
					}
				}
			}
		});
	}

	/** Lets a scenario be assembled in code rather than read out of the world file. */
	public addSpawnPoint(spawnPoint: ISpawnPoint): void
	{
		this.spawnPoints.push(spawnPoint);
	}

	public createLaunchLink(): void
	{
		this.world.params[this.name] = () =>
		{
			this.world.launchScenario(this.id);
		};
		this.world.scenarioGUIFolder.add(this.world.params, this.name);
	}

	public launch(loadingManager: LoadingManager, world: World): void
	{
		this.partyExtras = {};
		let plan = this.planPartyGrid(loadingManager, world);

		this.spawnPoints.forEach((sp) => {
			let planned = plan !== undefined ? plan.find((entry) => entry.spawnPoint === sp) : undefined;

			if (planned !== undefined) (sp as VehicleSpawnPoint).spawn(loadingManager, world, planned.driver);
			else sp.spawn(loadingManager, world);
		});

		// The cars past the end of the grid, which the world file doesn't have
		if (plan !== undefined)
		{
			plan.forEach((entry) =>
			{
				if (this.spawnPoints.indexOf(entry.spawnPoint) < 0) entry.spawnPoint.spawn(loadingManager, world, entry.driver);
			});
		}

		if (!this.spawnAlways)
		{
			loadingManager.createWelcomeScreenCallback(this);

			world.cameraOperator.theta = this.initialCameraAngle;
			world.cameraOperator.phi = 15;
		}
	}

	/** The car a single player starts in, if this scenario starts them in one. */
	public playerVehicleSpawn(): VehicleSpawnPoint
	{
		for (const sp of this.spawnPoints)
		{
			if (sp instanceof VehicleSpawnPoint && sp.driver === 'player') return sp;
		}

		return undefined;
	}

	/**
	 * Races and stunts were built for one player: one car in the player's spot
	 * and, in a race, a grid of computer drivers ahead of it. In a party every
	 * member gets a car of their own instead of all of them being put in that
	 * one.
	 *
	 * The grid is the player's spot and then the computer drivers' cars,
	 * nearest first. Each member takes the place their id ranks at, lowest
	 * first, and the computer only drives the cars nobody has. Past the end of
	 * the grid, or where there's no grid at all, spare cars are parked in rows
	 * behind the start, wherever there's ground for one. Every client works
	 * this out the same way from the same roster and the same map, so the cars
	 * and their names line up across the party. Someone who joins later is
	 * given the next place, and the computer driver in it gets out.
	 */
	private planPartyGrid(loadingManager: LoadingManager, world: World): { spawnPoint: VehicleSpawnPoint, driver: string }[]
	{
		let party = world.party;
		if (party === undefined || !party.active) return undefined;

		let base = this.playerVehicleSpawn();
		if (base === undefined) return undefined;

		let members = party.memberIds().sort((a, b) => a - b);
		let mine = members.indexOf(party.client.id);
		let grid = this.gridOrder(base);
		let plan: { spawnPoint: VehicleSpawnPoint, driver: string }[] = [];

		for (let slot = 0; slot < members.length; slot++)
		{
			let driver = slot === mine ? 'player' : null;

			if (slot < grid.length)
			{
				plan.push({ spawnPoint: grid[slot], driver: driver });
				continue;
			}

			let extra = this.extraSpawn(base, slot - grid.length + 1, world);

			if (extra !== undefined)
			{
				this.partyExtras[extra.name] = true;
				plan.push({ spawnPoint: extra, driver: driver });
			}
			else if (slot === mine)
			{
				// Nowhere left to park another car, so this one starts on foot
				// beside the first, and can ride along in it
				this.spawnBeside(base, loadingManager, world);
			}
		}

		// Whoever isn't here to take a computer driver's car leaves it driven
		return plan;
	}

	/** The player's spot, then the computer drivers' cars nearest to it first. */
	private gridOrder(base: VehicleSpawnPoint): VehicleSpawnPoint[]
	{
		let at = base.getWorldPosition(new THREE.Vector3());

		let others = this.spawnPoints
			.filter((sp) => sp instanceof VehicleSpawnPoint && sp !== base && sp.driver === 'ai' && sp.type === base.type)
			.map((sp) => sp as VehicleSpawnPoint);

		others.sort((a, b) => a.getWorldPosition(new THREE.Vector3()).distanceTo(at) - b.getWorldPosition(new THREE.Vector3()).distanceTo(at));

		return [base].concat(others);
	}

	/**
	 * The n-th usable spot for a spare car, counting from one: rows behind the
	 * start, the middle of each row first. Only ground at about the start's own
	 * height, with a clear line to it from the start and no other vehicle's
	 * spawn close by, will do. Judged against the map alone and never anything
	 * that moves, so every client arrives at the same spots whenever it asks.
	 */
	private extraSpawn(base: VehicleSpawnPoint, n: number, world: World): VehicleSpawnPoint
	{
		let origin = base.getWorldPosition(new THREE.Vector3());
		let rotation = base.getWorldQuaternion(new THREE.Quaternion());
		let back = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation).setY(0).normalize();
		let side = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).setY(0).normalize();

		let groundHere = Scenario.groundBelow(origin, world);
		if (groundHere === undefined) return undefined;

		let others = this.spawnPoints
			.filter((sp) => sp instanceof VehicleSpawnPoint && sp !== base)
			.map((sp) => (sp as VehicleSpawnPoint).getWorldPosition(new THREE.Vector3()));

		let found = 0;

		for (let row = 1; row <= Scenario.EXTRA_ROWS; row++)
		{
			for (const across of [0, Scenario.EXTRA_SIDE, -Scenario.EXTRA_SIDE])
			{
				let spot = origin.clone()
					.addScaledVector(back, row * Scenario.EXTRA_SPACING)
					.addScaledVector(side, across);

				let groundThere = Scenario.groundBelow(spot, world);
				if (groundThere === undefined || Math.abs(groundThere - groundHere) > 1) continue;

				spot.y = groundThere + (origin.y - groundHere);

				if (others.some((other) => other.distanceTo(spot) < Scenario.EXTRA_CLEARANCE)) continue;
				if (Scenario.staticHitBetween(origin, spot, world)) continue;

				found++;
				if (found < n) continue;

				let object = new THREE.Object3D();
				object.name = base.name + '+' + n;
				object.position.copy(spot);
				object.quaternion.copy(rotation);
				object.updateMatrixWorld(true);

				let spawnPoint = new VehicleSpawnPoint(object);
				spawnPoint.type = base.type;
				return spawnPoint;
			}
		}

		return undefined;
	}

	/**
	 * Makes one of this launch's spare party cars that another member has and
	 * this client doesn't, named as 'spawn+n'. They joined after this client
	 * launched, so it didn't count them. False when the name isn't one of ours.
	 */
	public spawnPartyExtra(name: string, world: World): boolean
	{
		if (this.partyExtras[name]) return true;

		let base = this.playerVehicleSpawn();
		if (base === undefined) return false;

		let prefix = base.name + '+';
		if (name.indexOf(prefix) !== 0) return false;

		let n = Number(name.substring(prefix.length));
		if (!(n >= 1 && n <= Scenario.EXTRA_ROWS * 3) || Math.floor(n) !== n) return false;

		let extra = this.extraSpawn(base, n, world);
		if (extra === undefined) return false;

		this.partyExtras[name] = true;
		extra.spawn(undefined, world, null);
		return true;
	}

	/** A player on foot next to the start, for when there's no car left for them. */
	private spawnBeside(base: VehicleSpawnPoint, loadingManager: LoadingManager, world: World): void
	{
		let object = new THREE.Object3D();
		base.getWorldPosition(object.position);
		object.position.addScaledVector(
			new THREE.Vector3(-1, 0, 0).applyQuaternion(base.getWorldQuaternion(new THREE.Quaternion())), 3);
		object.updateMatrixWorld(true);

		new CharacterSpawnPoint(object).spawn(loadingManager, world);
	}

	/** Height of the fixed ground under a point, ignoring anything that moves. */
	private static groundBelow(point: THREE.Vector3, world: World): number
	{
		let highest: number;

		world.physicsWorld.raycastAll(
			new CANNON.Vec3(point.x, point.y + 3, point.z),
			new CANNON.Vec3(point.x, point.y - 6, point.z),
			// tslint:disable-next-line: no-bitwise
			{ collisionFilterMask: ~CollisionGroups.Characters, skipBackfaces: true },
			(result: CANNON.RaycastResult) =>
			{
				if (result.body.mass !== 0) return;
				if (highest === undefined || result.hitPointWorld.y > highest) highest = result.hitPointWorld.y;
			});

		return highest;
	}

	/** Whether fixed scenery stands between two points, a metre off the ground. */
	private static staticHitBetween(from: THREE.Vector3, to: THREE.Vector3, world: World): boolean
	{
		let blocked = false;

		world.physicsWorld.raycastAll(
			new CANNON.Vec3(from.x, from.y + 1, from.z),
			new CANNON.Vec3(to.x, to.y + 1, to.z),
			// tslint:disable-next-line: no-bitwise
			{ collisionFilterMask: ~CollisionGroups.Characters, skipBackfaces: true },
			(result: CANNON.RaycastResult) =>
			{
				if (result.body.mass === 0) blocked = true;
			});

		return blocked;
	}
}