import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { LoadingManager } from '../core/LoadingManager';
import { CityPlan, roadWidth } from './CityPlan';
import { CityMaterials } from './CityMaterials';
import { CityContext } from './CityContext';
import { StreetFurniture } from './StreetFurniture';
import { RoadBuilder, SignalHead } from './RoadBuilder';
import { BlockBuilder } from './BlockBuilder';
import { Waterfront } from './Waterfront';
import { Breakables } from './Breakables';
import { Scenario } from '../world/Scenario';
import { Path } from '../world/Path';

export type SignalLight = 'green' | 'yellow' | 'red';

/**
 * The city on the mainland: built once when the world loads, identically on
 * every client, and then mostly left alone. What it does each frame is run
 * the traffic lights and turn the lights on when it gets dark.
 */
export class City implements IUpdatable
{
	public updateOrder: number = 6;

	/** One cycle of the lights: green one way, amber, all red, then the other way. */
	public static readonly GREEN: number = 13;
	public static readonly AMBER: number = 3;
	public static readonly ALL_RED: number = 1.5;

	public plan: CityPlan;
	public materials: CityMaterials;
	public context: CityContext;
	public roads: RoadBuilder;
	public blocks: BlockBuilder;
	public waterfront: Waterfront;
	public furniture: StreetFurniture;
	/** Lamps, signals and pavement clutter a car knocks over. */
	public breakables: Breakables;

	/** Places on a pavement to start from, spread over the whole city. */
	public spawnSpots: { position: THREE.Vector3, facing: THREE.Vector3 }[] = [];

	private world: World;
	private lenses: THREE.InstancedMesh;
	private lensStates: string[] = [];
	private lensMatrices: THREE.Matrix4[] = [];
	private clock: number = 0;
	private night: number = -1;
	private cullTimer: number = 0;

	private static readonly LENS_COLORS: { [name: string]: THREE.Color } = {
		redOn: new THREE.Color(4.0, 0.25, 0.15), redOff: new THREE.Color(0.12, 0.02, 0.02),
		amberOn: new THREE.Color(4.0, 2.2, 0.2), amberOff: new THREE.Color(0.12, 0.08, 0.02),
		greenOn: new THREE.Color(0.2, 4.0, 1.4), greenOff: new THREE.Color(0.02, 0.1, 0.05)
	};

	constructor(world: World, loadingManager: LoadingManager)
	{
		this.world = world;
		this.plan = new CityPlan();
		let anisotropy = Math.min(8, world.renderer.capabilities.getMaxAnisotropy());
		this.materials = new CityMaterials(loadingManager, anisotropy);
		this.context = new CityContext(this.materials);
		this.furniture = new StreetFurniture(this.context);

		this.roads = new RoadBuilder(this.context, this.plan);
		this.roads.build();
		this.waterfront = new Waterfront(this.context, this.plan);
		this.waterfront.build();
		this.blocks = new BlockBuilder(this.context, this.plan, this.roads.lampSpots);
		this.blocks.build();

		this.context.buildBatches();
		this.context.buildInstances();
		this.furniture.loadProps(loadingManager, () => this.context.buildInstances(StreetFurniture.PROPS));
		this.buildLenses(this.roads.signals);

		world.graphicsWorld.add(this.context.group);
		this.context.addBodiesTo(world.physicsWorld);
		this.breakables = new Breakables(world, this.context, (lenses, hidden) => this.setLensesHidden(lenses, hidden));

		this.spawnSpots = this.blocks.spawnSpots.concat(this.waterfront.spawnSpots);
		this.addScenarios();

		world.registerUpdatable(this);
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		// The lights run on the world's clock, so a party sees the same colours
		this.clock += timeStep;
		this.updateLenses();

		this.breakables.update(timeStep);

		this.cullTimer -= unscaledTimeStep;
		if (this.cullTimer <= 0)
		{
			this.cullTimer = 0.2;
			this.context.cull(this.world.camera.position);
		}

		let night = this.world.sky !== undefined ? this.world.sky.nightFactor : 0;
		if (Math.abs(night - this.night) > 0.005)
		{
			this.night = night;
			this.materials.setNight(night);
			this.furniture.setNight(night);
			this.world.graphics.setBloom(0.3 + night * 0.5);
		}
	}

	/** Keeps the lights in step with whatever clock the party agrees on. */
	public setClock(seconds: number): void
	{
		this.clock = seconds;
	}

	/**
	 * What the lights show to traffic moving along an axis at a junction.
	 * Junctions are offset from each other by where they are, so the city
	 * doesn't change all at once, and the offset follows the grid so there's
	 * a green wave down the avenues at a steady speed.
	 */
	public signalFor(node: number, axis: 'x' | 'z'): SignalLight
	{
		let position = this.plan.nodes[node].position;
		let cycle = (City.GREEN + City.AMBER + City.ALL_RED) * 2;
		let offset = ((position.z + 600) / 20 + (position.x + 1100) / 37) % cycle;
		let t = ((this.clock + offset) % cycle + cycle) % cycle;
		let phase = City.GREEN + City.AMBER + City.ALL_RED;
		let local = axis === 'z' ? t : (t + phase) % cycle;
		if (local < City.GREEN) return 'green';
		if (local < City.GREEN + City.AMBER) return 'yellow';
		return 'red';
	}

	private buildLenses(heads: SignalHead[]): void
	{
		let geometry = new THREE.CircleGeometry(0.11, 12);
		let material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
		let count = heads.length * 3;
		this.lenses = new THREE.InstancedMesh(geometry, material, count);
		this.lenses.name = 'signal lenses';
		let matrix = new THREE.Matrix4();
		let up = new THREE.Vector3(0, 1, 0);
		heads.forEach((head, i) =>
		{
			let facing = head.travel.clone().negate();
			let rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
			head.lamps.forEach((lamp, k) =>
			{
				matrix.compose(lamp.clone().add(facing.clone().multiplyScalar(0.01)), rotation, new THREE.Vector3(1, 1, 1));
				this.lenses.setMatrixAt(i * 3 + k, matrix);
				this.lensMatrices[i * 3 + k] = matrix.clone();
				this.lenses.setColorAt(i * 3 + k, City.LENS_COLORS.redOff);
			});
			this.lensStates.push('');
		});
		this.lenses.instanceMatrix.needsUpdate = true;
		this.lenses.computeBoundingSphere();
		this.context.group.add(this.lenses);
	}

	/** A knocked down signal's lights go with it. */
	private setLensesHidden(lenses: number[], hidden: boolean): void
	{
		let nowhere = new THREE.Matrix4().makeScale(0, 0, 0);
		for (const index of lenses) this.lenses.setMatrixAt(index, hidden ? nowhere : this.lensMatrices[index]);
		this.lenses.instanceMatrix.needsUpdate = true;
	}

	private updateLenses(): void
	{
		if (this.lenses === undefined) return;
		let heads = this.roads.signals;
		let changed = false;
		let c = City.LENS_COLORS;
		for (let i = 0; i < heads.length; i++)
		{
			let state = this.signalFor(heads[i].node, heads[i].axis);
			if (state === this.lensStates[i]) continue;
			this.lensStates[i] = state;
			this.lenses.setColorAt(i * 3, state === 'red' ? c.redOn : c.redOff);
			this.lenses.setColorAt(i * 3 + 1, state === 'yellow' ? c.amberOn : c.amberOff);
			this.lenses.setColorAt(i * 3 + 2, state === 'green' ? c.greenOn : c.greenOff);
			changed = true;
		}
		if (changed) this.lenses.instanceColor.needsUpdate = true;
	}

	// Scenarios

	private addScenarios(): void
	{
		let root = new THREE.Group();
		root.name = 'city scenarios';
		this.world.graphicsWorld.add(root);

		this.addFreeRoam(root);
		this.addRace(root);
		root.updateMatrixWorld(true);
	}

	private spawn(parent: THREE.Object3D, name: string, userData: any, position: THREE.Vector3, heading: number): THREE.Object3D
	{
		let object = new THREE.Object3D();
		object.name = name;
		object.userData = userData;
		object.position.copy(position);
		object.rotation.y = heading;
		parent.add(object);
		return object;
	}

	/**
	 * Downtown, on the pavement of the street through the middle of it, with
	 * a car parked at the kerb beside you.
	 */
	private addFreeRoam(root: THREE.Object3D): void
	{
		let scenario = new THREE.Group();
		scenario.name = 'city';
		scenario.userData = {
			data: 'scenario',
			name: 'City (free roam)',
			default: 'true',
			desc_title: 'Welcome to the city',
			desc_content: 'Downtown, with a car parked at the kerb. The highway rings the city, the beach is east along the coast road, and the bridge on 60th Street goes back to the island.',
			camera_angle: 90
		};
		root.add(scenario);

		let parking = CityPlan.STREET.lanes * CityPlan.STREET.laneWidth + CityPlan.STREET.parking / 2;
		// Westbound traffic keeps to the north side of an east-west street
		// Facing west, down the street, with the car just ahead
		this.spawn(scenario, 'city_player', { data: 'spawn', type: 'player' },
			new THREE.Vector3(CityPlan.START.x, CityPlan.GROUND + CityPlan.CURB, CityPlan.START.z), -Math.PI / 2);
		this.spawn(scenario, 'city_car', { data: 'spawn', type: 'car' },
			new THREE.Vector3(-688, CityPlan.GROUND, -parking), -Math.PI / 2);
		this.spawn(scenario, 'city_car_2', { data: 'spawn', type: 'car' },
			new THREE.Vector3(-676, CityPlan.GROUND, parking), Math.PI / 2);

		this.world.scenarios.push(new Scenario(scenario, this.world));
	}

	/**
	 * Once round the ring road and down the coast, against a grid of
	 * computer drivers, starting just south of the bridge.
	 */
	private addRace(root: THREE.Object3D): void
	{
		let pathRoot = new THREE.Group();
		pathRoot.name = 'cityloop_path';
		pathRoot.userData = { data: 'path', name: 'cityloop' };
		root.add(pathRoot);

		// The loop starts at the top of the coast road; begin it just past the grid
		let points = this.plan.loop;
		let start = points.findIndex((p) => Math.abs(p.x - CityPlan.OCEAN_X) < 10 && p.z > 110);
		let ordered = points.slice(start).concat(points.slice(0, start));
		let count = ordered.length;
		ordered.forEach((point, i) =>
		{
			let node = new THREE.Object3D();
			node.name = 'cityloop_' + i;
			node.position.copy(point);
			node.userData = {
				data: 'pathNode',
				nextNode: 'cityloop_' + ((i + 1) % count),
				previousNode: 'cityloop_' + ((i - 1 + count) % count)
			};
			pathRoot.add(node);
		});
		pathRoot.updateMatrixWorld(true);
		this.world.paths.push(new Path(pathRoot));

		let scenario = new THREE.Group();
		scenario.name = 'city_race';
		scenario.userData = {
			data: 'scenario',
			name: 'City loop race',
			desc_title: 'City loop race',
			desc_content: 'One lap of the city: south down the coast road, west along the south shore, up the ring road and back east over the harbour viaduct.',
			camera_angle: 0,
			laps: 1
		};
		root.add(scenario);

		let lanes = [
			CityPlan.OCEAN_X - (CityPlan.OCEAN.median / 2 + CityPlan.OCEAN.laneWidth * 0.5),
			CityPlan.OCEAN_X - (CityPlan.OCEAN.median / 2 + CityPlan.OCEAN.laneWidth * 1.5)
		];
		// Heading south, which is +Z
		let heading = 0;
		let slot = 0;
		for (let row = 0; row < 3; row++)
		{
			for (const x of lanes)
			{
				let z = 100 - row * 7 - (x === lanes[1] ? 3.5 : 0);
				let isPlayer = row === 2 && x === lanes[1];
				this.spawn(scenario, 'cityrace_' + slot, isPlayer
					? { data: 'spawn', type: 'car', driver: 'player' }
					: { data: 'spawn', type: 'car', driver: 'ai', first_node: 'cityloop_0' },
					new THREE.Vector3(x, CityPlan.GROUND, z), heading);
				slot++;
			}
		}

		this.world.scenarios.push(new Scenario(scenario, this.world));
	}

	/** Nearest pavement spot to a point, for putting someone back somewhere sensible. */
	public nearestSpawn(to: THREE.Vector3): THREE.Vector3
	{
		let best: THREE.Vector3;
		let distance = Infinity;
		for (const spot of this.spawnSpots)
		{
			let d = spot.position.distanceToSquared(to);
			if (d < distance)
			{
				distance = d;
				best = spot.position;
			}
		}
		return best !== undefined ? best.clone() : new THREE.Vector3(-684, 16, -8);
	}

	/** Whether a point is over the city's land, rather than the sea or the island. */
	public static onLand(x: number, z: number): boolean
	{
		let L = CityPlan.LAND;
		return x > L.minX - 14 && x < L.maxX + 30 && z > L.minZ - 14 && z < L.maxZ + 14;
	}
}
