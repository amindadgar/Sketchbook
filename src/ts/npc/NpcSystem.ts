import * as THREE from 'three';
import * as CANNON from 'cannon';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { City } from '../city/City';
import { Navigation, Lane, Walk, Crossing, Route } from './Navigation';
import { Pedestrian, PedestrianClips } from './Pedestrian';
import { TrafficCar } from './TrafficCar';
import { createGLTFLoader } from '../core/Loaders';
import { HumanModel } from '../characters/HumanModel';
import { DeviceProfile } from '../core/DeviceProfile';
import { mulberry32 } from '../city/CityPlan';
import { Car } from '../vehicles/Car';
import { Vehicle } from '../vehicles/Vehicle';
import { SeatType } from '../enums/SeatType';

/**
 * The people and traffic of the city.
 *
 * One client simulates them: whoever plays alone, or in a party the member
 * with the lowest id. That client spawns them round every player, walks and
 * drives them, and sends where they all are five times a second; everyone else
 * shows those positions, eased between updates. A shot at a pedestrian from
 * anyone else is sent to the simulating client, which decides what it does.
 * The traffic lights run off the same clock, sent along with the positions.
 */
export class NpcSystem implements IUpdatable
{
	public updateOrder: number = 7;

	public static readonly VARIANTS: string[] = ['npc_business', 'npc_denim', 'npc_worker', 'npc_jacket', 'npc_plaid',
		'npc_tee', 'npc_office', 'npc_sport', 'npc_shorts'];

	private static readonly SNAPSHOT_INTERVAL: number = 0.2;
	/** Close enough to a car in the traffic to pull its driver out, and slow enough. */
	private static readonly STEAL_REACH: number = 4.2;
	private static readonly STEAL_SPEED: number = 9;
	/** Taken cars left further than this from every player are cleared away. */
	private static readonly STOLEN_KEEP: number = 280;
	private static readonly MAX_STOLEN: number = 8;
	private static readonly STOLEN_PREFIX: string = 'stolen:';
	/** Names the cars taken while playing alone, unlike anyone else's from before they joined up. */
	private static readonly SESSION_TAG: string = Math.random().toString(36).slice(2, 10);
	private static readonly STATES: string[] = ['walk', 'wait', 'idle', 'flee', 'dead'];

	public navigation: Navigation;
	public pedestrians: Pedestrian[] = [];
	public cars: TrafficCar[] = [];

	private world: World;
	private city: City;
	private ready: boolean = false;
	private models: THREE.Object3D[] = [];
	private clips: PedestrianClips[] = [];
	private carTemplate: THREE.Object3D;
	private lampTexture: THREE.Texture;
	private nextId: number = 1;
	private spawnTimer: number = 0;
	private snapshotTimer: number = 0;
	private wasAuthority: boolean = true;
	private random: () => number = mulberry32(Date.now() & 0xffff);
	private laneSpots: { lane: Lane, distance: number, position: THREE.Vector3 }[] = [];
	private walkSpots: { walk: Walk, distance: number, position: THREE.Vector3 }[] = [];
	private lightsOn: boolean = false;

	// Taking cars out of the traffic
	/** A car model loaded and waiting, so taking a car happens the moment the key goes down. */
	private spareCar: any;
	private loadingSpare: boolean = false;
	private stolenCount: number = 0;
	/** Cars taken from the traffic, here or by other players, oldest first. */
	private stolen: Vehicle[] = [];
	/** Names of taken cars still loading here, so each is only made once. */
	private stolenLoading: Set<string> = new Set();
	/** Traffic taken here but maybe still in the next snapshot from whoever simulates it. */
	private taken: Map<number, number> = new Map();
	private stolenTimer: number = 0;

	private maxCars: number;
	private maxPedestrians: number;

	constructor(world: World, city: City)
	{
		this.world = world;
		this.city = city;
		this.navigation = new Navigation(city);
		let phone = DeviceProfile.isTouch();
		this.maxCars = phone ? 10 : 24;
		this.maxPedestrians = phone ? 14 : 36;

		this.indexSpots();
		this.lampTexture = NpcSystem.makeLampTexture();
		this.load();
		world.registerUpdatable(this);
		world.physicsWorld.addEventListener('postStep', () => this.afterStep());
	}

	// Loading, in the background once the world is up

	private load(): void
	{
		let loader = createGLTFLoader();
		let pending = 2 + NpcSystem.VARIANTS.length;
		let playerClips: THREE.AnimationClip[];
		let playerHips = 0.55;
		let loaded: THREE.Object3D[] = [];

		let finish = () =>
		{
			if (--pending > 0) return;
			NpcSystem.VARIANTS.forEach((_, i) =>
			{
				let model = loaded[i];
				if (model === undefined) return;
				this.models[i] = model;
				this.clips[i] = NpcSystem.adaptClips(playerClips, playerHips, NpcSystem.hipsHeight(model));
			});
			this.ready = this.models.length > 0 && this.carTemplate !== undefined;
		};

		loader.load(HumanModel.PLAYER, (gltf) =>
		{
			playerClips = gltf.animations;
			playerHips = NpcSystem.hipsHeight(gltf.scene);
			finish();
		}, undefined, () => finish());

		NpcSystem.VARIANTS.forEach((name, i) =>
		{
			loader.load('build/assets/humans/' + name + '.glb', (gltf) =>
			{
				gltf.scene.traverse((child: any) =>
				{
					if (child.isMesh && HumanModel.isHumanMaterial(child.material)) child.material.roughness = 0.78;
				});
				loaded[i] = gltf.scene;
				finish();
			}, undefined, () => finish());
		});

		loader.load('build/assets/car.glb', (gltf) =>
		{
			this.carTemplate = gltf.scene;
			finish();
			this.loadSpare();
		}, undefined, () => finish());
	}

	private loadSpare(): void
	{
		if (this.spareCar !== undefined || this.loadingSpare) return;
		this.loadingSpare = true;
		createGLTFLoader().load('build/assets/car.glb', (gltf) =>
		{
			this.spareCar = gltf;
			this.loadingSpare = false;
		}, undefined, () => this.loadingSpare = false);
	}

	private static hipsHeight(root: THREE.Object3D): number
	{
		root.updateMatrixWorld(true);
		let hips = root.getObjectByName('mixamorigHips');
		if (hips === undefined) return 0.55;
		return hips.getWorldPosition(new THREE.Vector3()).y;
	}

	/**
	 * The player's animations, fitted to a body of a different height. Every
	 * track but the hips' position is a rotation, which fits any body; the
	 * hips are moved in proportion, so shorter legs don't leave feet dangling.
	 */
	private static adaptClips(source: THREE.AnimationClip[], sourceHips: number, targetHips: number): PedestrianClips
	{
		let scale = targetHips / sourceHips;
		let fit = (name: string) =>
		{
			let clip = source.find((c) => c.name === name);
			if (clip === undefined) return undefined;
			let copy = clip.clone();
			copy.tracks = copy.tracks.map((track) =>
			{
				if (!track.name.endsWith('.position')) return track;
				let scaled = track.clone();
				for (let i = 0; i < scaled.values.length; i++) scaled.values[i] *= scale;
				return scaled;
			});
			return copy;
		};
		return { idle: fit('idle'), walk: fit('walk') || fit('run'), run: fit('sprint') || fit('run') };
	}

	/** Candidate places to put things down: every twenty metres of lane, every few of pavement. */
	private indexSpots(): void
	{
		for (const lane of this.navigation.lanes)
		{
			if (lane.turn || lane.length < 24) continue;
			for (let d = 8; d < lane.length - 8; d += 22)
			{
				this.laneSpots.push({ lane: lane, distance: d, position: lane.sample(d, new THREE.Vector3()) });
			}
		}
		for (const walk of this.navigation.walks)
		{
			for (let d = 2; d < walk.length; d += 7)
			{
				this.walkSpots.push({ walk: walk, distance: d, position: walk.sample(d, new THREE.Vector3()) });
			}
		}
	}

	// Who simulates

	private get authority(): boolean
	{
		let party = this.world.party;
		if (party === undefined || !party.active || !party.hasFeature('npcs')) return true;
		let ids = party.memberIds();
		return Math.min(...ids) === party.client.id;
	}

	/** Where every player is, whose surroundings get populated. */
	private playerPositions(): THREE.Vector3[]
	{
		let positions: THREE.Vector3[] = [];
		for (const character of this.world.characters)
		{
			if (character.networkId === undefined && character !== this.world.localCharacter) continue;
			positions.push(character.getWorldPosition(new THREE.Vector3()));
		}
		if (positions.length === 0) positions.push(this.world.camera.position.clone());
		return positions;
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		if (!this.ready) return;

		let authority = this.authority;
		if (authority !== this.wasAuthority)
		{
			// Handing over: start afresh rather than guess what the last one was doing
			this.clear();
			this.wasAuthority = authority;
		}

		if (authority)
		{
			this.simulate(timeStep);
			this.snapshotTimer -= unscaledTimeStep;
			if (this.snapshotTimer <= 0 && this.world.party !== undefined && this.world.party.active)
			{
				this.snapshotTimer = NpcSystem.SNAPSHOT_INTERVAL;
				this.world.party.publishNpcs(this.snapshot());
			}
		}
		else
		{
			for (const car of this.cars)
			{
				// Knocked about here, it's this client's physics that has it until
				// it stops, and then it eases back to wherever it's been reported
				if (car.knocked) this.settleCopy(car, timeStep);
				else car.follow(timeStep);
			}
			for (const pedestrian of this.pedestrians) pedestrian.follow(timeStep);
		}

		this.stolenTimer -= unscaledTimeStep;
		if (this.stolenTimer <= 0)
		{
			this.stolenTimer = 2;
			this.tidyStolen();
		}

		let camera = this.world.camera.position;
		let night = this.world.sky !== undefined && this.world.sky.isNight;
		for (const car of this.cars)
		{
			car.updateVisual(timeStep);
			if (night !== this.lightsOn) car.setLights(night);
			if (car.knocked && this.world.skidMarks !== undefined) car.leaveMarks(this.world.skidMarks);
		}
		this.lightsOn = night;
		for (const pedestrian of this.pedestrians)
		{
			pedestrian.updateVisual(timeStep, pedestrian.position.distanceTo(camera));
		}
	}

	// Simulation

	private simulate(timeStep: number): void
	{
		let players = this.playerPositions();

		this.spawnTimer -= timeStep;
		if (this.spawnTimer <= 0)
		{
			this.spawnTimer = 0.4;
			this.populate(players);
		}

		for (const car of this.cars.slice())
		{
			if (car.knocked) this.settle(car, timeStep);
			else this.drive(car, timeStep);
		}
		for (const pedestrian of this.pedestrians.slice()) this.walk(pedestrian, timeStep);
		this.checkImpacts();
	}

	private nearestPlayer(players: THREE.Vector3[], point: THREE.Vector3): number
	{
		let best = Infinity;
		for (const p of players) best = Math.min(best, p.distanceTo(point));
		return best;
	}

	/** Tops up traffic and crowds round the players, and clears what's left behind. */
	private populate(players: THREE.Vector3[]): void
	{
		// No traffic on a race: the course is the city's own roads
		let racing = this.world.race !== undefined && this.world.race.active;
		for (const car of this.cars.slice())
		{
			if (racing || this.nearestPlayer(players, car.position) > 320) this.removeCar(car);
		}
		for (const pedestrian of this.pedestrians.slice())
		{
			if (this.nearestPlayer(players, pedestrian.position) > 150) this.removePedestrian(pedestrian);
		}

		// Nobody out in the city at all: nothing to do
		if (!players.some((p) => City.onLand(p.x, p.z))) return;

		for (let tries = 0; tries < 6 && !racing && this.cars.length < this.maxCars; tries++)
		{
			let spot = this.laneSpots[Math.floor(this.random() * this.laneSpots.length)];
			let distance = this.nearestPlayer(players, spot.position);
			if (distance < 70 || distance > 240) continue;
			if (this.cars.some((c) => c.position.distanceTo(spot.position) < 16)) continue;
			this.spawnCar(spot.lane, spot.distance, Math.floor(this.random() * TrafficCar.COLORS.length));
		}

		for (let tries = 0; tries < 10 && this.pedestrians.length < this.maxPedestrians; tries++)
		{
			let spot = this.walkSpots[Math.floor(this.random() * this.walkSpots.length)];
			let distance = this.nearestPlayer(players, spot.position);
			if (distance < 22 || distance > 110) continue;
			this.spawnPedestrian(spot.walk, spot.distance, Math.floor(this.random() * this.models.length));
		}
	}

	private spawnCar(lane: Lane, distance: number, color: number, id?: number): TrafficCar
	{
		let car = new TrafficCar(id !== undefined ? id : this.nextId++, color, this.carTemplate, this.lampTexture);
		if (lane !== undefined)
		{
			car.lane = lane;
			car.distance = distance;
			car.speed = lane.speed * 0.6;
			car.placeOnLane();
		}
		car.setLights(this.lightsOn);
		this.world.graphicsWorld.add(car.object);
		this.world.physicsWorld.addBody(car.body);
		this.cars.push(car);
		return car;
	}

	private removeCar(car: TrafficCar): void
	{
		this.world.graphicsWorld.remove(car.object);
		this.world.physicsWorld.remove(car.body);
		this.cars.splice(this.cars.indexOf(car), 1);
	}

	private spawnPedestrian(walk: Walk, distance: number, variant: number, id?: number): Pedestrian
	{
		let model = SkeletonUtils.clone(this.models[variant]);
		let pedestrian = new Pedestrian(id !== undefined ? id : this.nextId++, variant, model, this.clips[variant]);
		if (walk !== undefined)
		{
			pedestrian.route = walk;
			pedestrian.distance = distance;
			pedestrian.direction = this.random() < 0.5 ? 1 : -1;
			pedestrian.speed = Pedestrian.WALK_SPEED * (0.85 + this.random() * 0.3);
			this.placePedestrian(pedestrian);
		}
		this.world.graphicsWorld.add(pedestrian.object);
		this.world.physicsWorld.addBody(pedestrian.body);
		this.pedestrians.push(pedestrian);
		return pedestrian;
	}

	private removePedestrian(pedestrian: Pedestrian): void
	{
		this.world.graphicsWorld.remove(pedestrian.object);
		this.world.physicsWorld.remove(pedestrian.body);
		pedestrian.dispose();
		this.pedestrians.splice(this.pedestrians.indexOf(pedestrian), 1);
	}

	public clear(): void
	{
		for (const car of this.cars.slice()) this.removeCar(car);
		for (const pedestrian of this.pedestrians.slice()) this.removePedestrian(pedestrian);
	}

	// Driving

	private drive(car: TrafficCar, timeStep: number): void
	{
		let lane = car.lane;
		if (car.nextLane === undefined && lane.next.length > 0)
		{
			// Mostly straight on; turns now and then
			let straight = lane.next.filter((l) => l.speed > 6);
			let pool = straight.length > 0 && this.random() < 0.65 ? straight : lane.next;
			car.nextLane = pool[Math.floor(this.random() * pool.length)];
		}

		let limit = lane.speed;
		let remaining = lane.length - car.distance;

		if (car.stunned > 0)
		{
			car.stunned -= timeStep;
			limit = 0;
		}

		// Lights: stop at the line on red, and on amber unless it's too late to
		if (lane.signalled && lane.endNode !== undefined && remaining < 40)
		{
			let light = this.city.signalFor(lane.endNode.id, lane.axis);
			let stopAt = remaining - 1.6;
			let committed = light === 'yellow' && stopAt < car.speed * 0.9;
			if (light !== 'green' && !committed) limit = Math.min(limit, Math.sqrt(2 * 6 * Math.max(0, stopAt)));
		}

		// No lights where a street meets a main road: stop, look, go
		if (lane.giveWay && car.waited < 1.4)
		{
			let stopAt = remaining - 1.6;
			limit = Math.min(limit, Math.sqrt(2 * 5 * Math.max(0, stopAt)));
			if (stopAt < 0.8 && car.speed < 0.5) car.waited += timeStep;
		}

		// Whatever's in the road ahead
		let gap = this.clearAhead(car);
		limit = Math.min(limit, Math.sqrt(2 * 7 * Math.max(0, gap - 4.2)));

		if (car.speed < limit) car.speed = Math.min(limit, car.speed + 3.4 * timeStep);
		else car.speed = Math.max(limit, car.speed - 10 * timeStep);

		car.distance += car.speed * timeStep;
		while (car.distance > car.lane.length)
		{
			car.distance -= car.lane.length;
			if (car.nextLane === undefined)
			{
				this.removeCar(car);
				return;
			}
			car.lane = car.nextLane;
			car.nextLane = undefined;
			car.waited = 0;
		}
		car.placeOnLane();
	}

	/**
	 * How far the car can go before it meets something: another car, a player,
	 * someone crossing. Anything within a lane's width of its line ahead counts.
	 */
	private clearAhead(car: TrafficCar): number
	{
		let gap = 60;
		let consider = (point: THREE.Vector3, halfWidth: number) =>
		{
			let dx = point.x - car.position.x;
			let dz = point.z - car.position.z;
			if (Math.abs(point.y - car.position.y) > 2.5) return;
			let ahead = dx * car.forward.x + dz * car.forward.z;
			if (ahead <= 0 || ahead > 26) return;
			let lateral = Math.abs(dx * car.forward.z - dz * car.forward.x);
			if (lateral > halfWidth) return;
			gap = Math.min(gap, ahead);
		};

		for (const other of this.cars)
		{
			if (other === car) continue;
			// One knocked across the lane reaches further to the side than one in it
			let tolerance = 1.5;
			if (other.knocked || other.reportedWreck > 0)
			{
				let along = Math.abs(other.forward.x * car.forward.x + other.forward.z * car.forward.z);
				let across = Math.abs(other.forward.x * car.forward.z - other.forward.z * car.forward.x);
				tolerance = car.halfWidth + other.halfWidth * along + other.halfLength * across + 0.3;
			}
			consider(other.position, tolerance);
		}
		for (const vehicle of this.world.vehicles)
		{
			consider((vehicle as any).position, 1.7);
		}
		for (const character of this.world.characters)
		{
			if (character.occupyingSeat !== null) continue;
			consider(character.getWorldPosition(NpcSystem.scratch), 1.4);
		}
		for (const pedestrian of this.pedestrians)
		{
			if (pedestrian.route instanceof Crossing || pedestrian.position.y < 15.1) consider(pedestrian.position, 1.4);
		}
		return gap;
	}

	private static scratch: THREE.Vector3 = new THREE.Vector3();

	// Walking

	private placePedestrian(pedestrian: Pedestrian): void
	{
		let direction = new THREE.Vector3();
		pedestrian.route.sample(pedestrian.distance, pedestrian.position, direction);
		let sign = pedestrian.route instanceof Crossing ? 1 : pedestrian.direction;
		if (direction.lengthSq() > 0) pedestrian.heading = Math.atan2(direction.x * sign, direction.z * sign);
	}

	private walk(pedestrian: Pedestrian, timeStep: number): void
	{
		if (pedestrian.state === 'dead')
		{
			pedestrian.timer += timeStep;
			if (pedestrian.timer > 15) this.removePedestrian(pedestrian);
			return;
		}

		if (pedestrian.state === 'idle')
		{
			pedestrian.timer -= timeStep;
			if (pedestrian.timer <= 0) pedestrian.state = 'walk';
			return;
		}

		if (pedestrian.state === 'wait')
		{
			pedestrian.timer += timeStep;
			let crossing = pedestrian.pendingCrossing;
			if (this.mayCross(crossing) || pedestrian.timer > 25)
			{
				pedestrian.route = crossing;
				pedestrian.distance = 0;
				pedestrian.state = 'walk';
				pedestrian.pendingCrossing = undefined;
			}
			return;
		}

		let speed = pedestrian.speed;
		if (pedestrian.state === 'flee')
		{
			speed = Pedestrian.RUN_SPEED;
			pedestrian.timer -= timeStep;
			if (pedestrian.timer <= 0) pedestrian.state = 'walk';
		}

		let route = pedestrian.route;
		if (route instanceof Crossing)
		{
			pedestrian.distance += speed * timeStep;
			if (pedestrian.distance >= route.length)
			{
				let walk = route.to;
				pedestrian.route = walk;
				pedestrian.distance = route.toDistance !== undefined ? route.toDistance : walk.corners[route.toCorner];
				pedestrian.direction = this.random() < 0.5 ? 1 : -1;
				pedestrian.lastCorner = route.toCorner;
			}
			this.placePedestrian(pedestrian);
			return;
		}

		let walk = route as Walk;
		let before = pedestrian.distance;
		pedestrian.distance += speed * timeStep * pedestrian.direction;
		let after = pedestrian.distance;
		pedestrian.distance = ((after % walk.length) + walk.length) % walk.length;

		// Round a corner: sometimes stop, sometimes cross
		for (let c = 0; c < 4; c++)
		{
			let at = walk.corners[c];
			let passed = pedestrian.direction > 0
				? (before < at && after >= at) || (c === 0 && after >= walk.length)
				: (before > at && after <= at) || (c === 0 && after <= 0);
			if (!passed || c === pedestrian.lastCorner) continue;
			pedestrian.lastCorner = c;
			if (pedestrian.state === 'flee') break;

			let roll = this.random();
			let crossings = walk.crossings[c] || [];
			if (roll < 0.35 && crossings.length > 0)
			{
				pedestrian.pendingCrossing = crossings[Math.floor(this.random() * crossings.length)];
				pedestrian.state = 'wait';
				pedestrian.timer = 0;
				pedestrian.distance = at;
			}
			else if (roll < 0.45)
			{
				pedestrian.state = 'idle';
				pedestrian.timer = 1.5 + this.random() * 4;
			}
			else if (roll < 0.7)
			{
				pedestrian.direction *= -1;
			}
			break;
		}
		if (Math.abs(pedestrian.distance - walk.corners[pedestrian.lastCorner]) > 3) pedestrian.lastCorner = -1;

		this.placePedestrian(pedestrian);
	}

	/** At lights, when the traffic crossing their path has a red. Elsewhere, when nothing's coming. */
	private mayCross(crossing: Crossing): boolean
	{
		if (crossing.node.signals) return this.city.signalFor(crossing.node.id, crossing.trafficAxis) === 'red';
		let mid = crossing.points[1].clone().lerp(crossing.points[2], 0.5);
		return !this.cars.some((car) => car.position.distanceTo(mid) < 22 && car.speed > 1);
	}

	// Knocks

	/**
	 * After every physics step: anything moving that's about to run into a
	 * car in the traffic, which is then let go into the physics world before
	 * the two touch, so the hit shoves it instead of stopping dead against it.
	 * Knocked cars count too, so one can be shunted into the next.
	 */
	private afterStep(): void
	{
		if (!this.ready || this.cars.length === 0) return;
		let dt = this.world.physicsWorld.dt || 1 / 60;

		for (const vehicle of this.world.vehicles as any[])
		{
			let body: CANNON.Body = vehicle.collision;
			if (body === undefined || body.world === null) continue;
			this.knockAhead(body, this.footprint(body), undefined, dt);
		}
		for (const car of this.cars)
		{
			if (car.knocked) this.knockAhead(car.body, { x: 0, z: 0, width: car.halfWidth, length: car.halfLength }, car, dt);
		}
	}

	private knockAhead(body: CANNON.Body, outline: { x: number, z: number, width: number, length: number }, self: TrafficCar, dt: number): void
	{
		let vx = body.velocity.x;
		let vz = body.velocity.z;
		if (vx * vx + vz * vz < 0.5) return;

		// Heights as boxes, so a car jumping clean over one doesn't count as hitting it
		body.computeAABB();
		let reachY = Math.abs(body.velocity.y) * dt * 1.5 + 0.1;

		// The mover's outline from above: its sideways and forward directions, and its middle
		let right = NpcSystem.flat(body.quaternion, 1, 0);
		let ahead = NpcSystem.flat(body.quaternion, 0, 1);
		let cx = body.position.x + right.x * outline.x + ahead.x * outline.z;
		let cz = body.position.z + right.z * outline.x + ahead.z * outline.z;

		for (const car of this.cars)
		{
			if (car === self || car.knocked) continue;
			let target = car.body.position;
			if (Math.abs(target.y - body.position.y) > 4) continue;

			// Closing on it, and not just crawling
			let rvx = vx - car.forward.x * car.speed;
			let rvz = vz - car.forward.z * car.speed;
			let dx = target.x - cx;
			let dz = target.z - cz;
			let closing = Math.hypot(rvx, rvz);
			let reach = outline.width + outline.length + car.halfWidth + car.halfLength + closing * dt * 2 + 0.3;
			if (dx * dx + dz * dz > reach * reach) continue;
			if (rvx * dx + rvz * dz <= 0 || closing < 0.6) continue;
			car.body.computeAABB();
			if (body.aabb.lowerBound.y > car.body.aabb.upperBound.y + reachY || body.aabb.upperBound.y < car.body.aabb.lowerBound.y - reachY) continue;

			// Swept on a step and a half at the speed they're closing
			let sx = rvx * dt * 1.5;
			let sz = rvz * dt * 1.5;
			let a = { x: cx + sx / 2, z: cz + sz / 2 };
			let widthA = outline.width + Math.abs(sx * right.x + sz * right.z) / 2;
			let lengthA = outline.length + Math.abs(sx * ahead.x + sz * ahead.z) / 2;
			let carAhead = { x: car.forward.x, z: car.forward.z };
			let carRight = { x: car.forward.z, z: -car.forward.x };
			if (!NpcSystem.overlaps(a, right, ahead, widthA, lengthA, { x: target.x, z: target.z }, carRight, carAhead, car.halfWidth, car.halfLength)) continue;

			car.knock();
		}
	}

	/** Two rectangles seen from above, each by its middle, its two directions and half its size along them. */
	private static overlaps(a: { x: number, z: number }, a1: { x: number, z: number }, a2: { x: number, z: number }, ha1: number, ha2: number,
		b: { x: number, z: number }, b1: { x: number, z: number }, b2: { x: number, z: number }, hb1: number, hb2: number, margin: number = 0.05): boolean
	{
		for (const n of [a1, a2, b1, b2])
		{
			let gap = Math.abs((b.x - a.x) * n.x + (b.z - a.z) * n.z);
			let ra = ha1 * Math.abs(a1.x * n.x + a1.z * n.z) + ha2 * Math.abs(a2.x * n.x + a2.z * n.z);
			let rb = hb1 * Math.abs(b1.x * n.x + b1.z * n.z) + hb2 * Math.abs(b2.x * n.x + b2.z * n.z);
			if (gap > ra + rb + margin) return false;
		}
		return true;
	}

	/** One of a body's own directions, flattened onto the ground. */
	private static flat(quaternion: CANNON.Quaternion, x: number, z: number): { x: number, z: number }
	{
		let v = quaternion.vmult(new CANNON.Vec3(x, 0, z));
		let length = Math.hypot(v.x, v.z) || 1;
		return { x: v.x / length, z: v.z / length };
	}

	private footprints: WeakMap<CANNON.Body, { x: number, z: number, width: number, length: number }> = new WeakMap();

	/** A vehicle's boxes as one rectangle from above, in its own frame. */
	private footprint(body: CANNON.Body): { x: number, z: number, width: number, length: number }
	{
		let known = this.footprints.get(body);
		if (known !== undefined) return known;
		let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
		body.shapes.forEach((shape: any, i) =>
		{
			if (shape.halfExtents === undefined) return;
			let offset = body.shapeOffsets[i];
			minX = Math.min(minX, offset.x - shape.halfExtents.x);
			maxX = Math.max(maxX, offset.x + shape.halfExtents.x);
			minZ = Math.min(minZ, offset.z - shape.halfExtents.z);
			maxZ = Math.max(maxZ, offset.z + shape.halfExtents.z);
		});
		let result = minX === Infinity
			? { x: 0, z: 0, width: 0.6, length: 1.2 }
			: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, width: (maxX - minX) / 2, length: (maxZ - minZ) / 2 };
		this.footprints.set(body, result);
		return result;
	}

	/** Whether a knocked car has come to rest, for long enough to count. */
	private cameToRest(car: TrafficCar, timeStep: number): boolean
	{
		car.readBody();
		car.knockedFor += timeStep;
		let moving = car.body.velocity.length() > 0.35 || car.body.angularVelocity.length() > 0.5;
		car.still = moving ? 0 : car.still + timeStep;
		// However it's twitching, a quarter of a minute is long enough
		return car.still > 1.2 || car.knockedFor > 15;
	}

	/**
	 * On the client simulating the city: once a knocked car stops, back into
	 * the nearest lane going roughly the way it points, and on it drives. On
	 * its roof, or pushed somewhere no lane is, it's a wreck, its driver gets
	 * out, and it's cleared away once nobody's looking.
	 */
	private settle(car: TrafficCar, timeStep: number): void
	{
		if (car.wrecked)
		{
			car.readBody();
			car.knockedFor += timeStep;
			// Once nobody's near it, or after a few minutes whoever is
			let alone = this.nearestPlayer(this.playerPositions(), car.position) > 60;
			if ((car.knockedFor > 45 && alone) || car.knockedFor > 180) this.removeCar(car);
			return;
		}
		if (!this.cameToRest(car, timeStep)) return;

		// The lane it points along, or failing that any lane close by: one left
		// across the road swings round onto it as it pulls away
		let spot = car.upright ? (this.nearestLane(car.position, car.forward) || this.nearestLane(car.position)) : undefined;
		if (spot === undefined)
		{
			car.wrecked = true;
			let side = new THREE.Vector3(car.forward.z, 0, -car.forward.x).multiplyScalar(1.4);
			this.bailOut(car.position.clone().add(side), car.position.clone());
			return;
		}

		// Not while something is sitting where it would go: pulling back in
		// would push it aside with nothing able to push back
		if (this.laneBlocked(car, spot))
		{
			car.still = 0;
			car.knockedFor = Math.min(car.knockedFor, 14);
			return;
		}

		let rest = car.position.clone();
		let restHeading = car.heading;
		car.unknock();
		car.lane = spot.lane;
		car.distance = spot.distance;
		car.nextLane = undefined;
		car.waited = 0;
		car.stunned = 1.2;
		car.placeOnLane();
		car.resumeFrom(rest, restHeading);
	}

	/** How far into the spot something has to be to stop a car pulling back in: touching it doesn't count. */
	private static readonly BLOCKED: number = -0.25;

	/** Whether a vehicle or another knocked car is where this one would pull back in to. */
	private laneBlocked(car: TrafficCar, spot: { lane: Lane, distance: number }): boolean
	{
		let at = new THREE.Vector3();
		let direction = new THREE.Vector3();
		spot.lane.sample(spot.distance, at, direction);
		let ahead = { x: direction.x, z: direction.z };
		let right = { x: direction.z, z: -direction.x };
		let here = { x: at.x, z: at.z };

		for (const vehicle of this.world.vehicles as any[])
		{
			let body: CANNON.Body = vehicle.collision;
			if (body === undefined || body.world === null || Math.abs(body.position.y - at.y) > 3) continue;
			let outline = this.footprint(body);
			let r = NpcSystem.flat(body.quaternion, 1, 0);
			let f = NpcSystem.flat(body.quaternion, 0, 1);
			let centre = { x: body.position.x + r.x * outline.x + f.x * outline.z, z: body.position.z + r.z * outline.x + f.z * outline.z };
			if (NpcSystem.overlaps(here, right, ahead, car.halfWidth, car.halfLength, centre, r, f, outline.width, outline.length, NpcSystem.BLOCKED)) return true;
		}
		for (const other of this.cars)
		{
			if (other === car || !other.knocked) continue;
			let f = { x: other.forward.x, z: other.forward.z };
			let r = { x: f.z, z: -f.x };
			if (NpcSystem.overlaps(here, right, ahead, car.halfWidth, car.halfLength, { x: other.position.x, z: other.position.z }, r, f, other.halfWidth, other.halfLength, NpcSystem.BLOCKED)) return true;
		}
		return false;
	}

	/** On everyone else's client: once it stops here, it goes back to showing the reports. */
	private settleCopy(car: TrafficCar, timeStep: number): void
	{
		if (!this.cameToRest(car, timeStep)) return;
		car.unknock();
		car.fresh = false;
	}

	/** The nearest point on a lane, pointing roughly the same way if a direction is given, if one is close. */
	private nearestLane(position: THREE.Vector3, forward?: THREE.Vector3): { lane: Lane, distance: number }
	{
		let best: { lane: Lane, distance: number };
		let bestGap = 4.5;
		for (const lane of this.navigation.lanes)
		{
			if (lane.turn) continue;
			let points = lane.points;
			for (let i = 1; i < points.length; i++)
			{
				let a = points[i - 1];
				let b = points[i];
				if (Math.abs(a.y - position.y) > 2) continue;
				let abx = b.x - a.x;
				let abz = b.z - a.z;
				let length2 = abx * abx + abz * abz;
				if (length2 < 1e-6) continue;
				let t = THREE.MathUtils.clamp(((position.x - a.x) * abx + (position.z - a.z) * abz) / length2, 0, 1);
				let gap = Math.hypot(position.x - (a.x + abx * t), position.z - (a.z + abz * t));
				if (gap >= bestGap) continue;
				let length = Math.sqrt(length2);
				if (forward !== undefined && (abx * forward.x + abz * forward.z) / length < 0.2) continue;
				let along = lane.lengths[i - 1] + t * length;
				// Not so near the end that it's straight into the junction
				if (along > lane.length - 3) continue;
				best = { lane: lane, distance: along };
				bestGap = gap;
			}
		}
		return best;
	}

	/** Cars hitting pedestrians and players ramming the traffic. */
	private checkImpacts(): void
	{
		// A car shoved along the pavement is as deadly as one driven along it
		for (const car of this.cars)
		{
			if (!car.knocked || car.body.velocity.length() < 3) continue;
			for (const pedestrian of this.pedestrians)
			{
				if (!pedestrian.alive) continue;
				let dx = pedestrian.position.x - car.position.x;
				let dz = pedestrian.position.z - car.position.z;
				if (dx * dx + dz * dz < 1.8 && Math.abs(pedestrian.position.y - car.position.y) < 1.5) this.kill(pedestrian);
			}
		}

		for (const vehicle of this.world.vehicles as any[])
		{
			let body = vehicle.collision;
			if (body === undefined) continue;
			let speed = body.velocity.length();
			if (speed < 3) continue;
			let at = vehicle.position as THREE.Vector3;

			for (const pedestrian of this.pedestrians)
			{
				if (!pedestrian.alive) continue;
				let dx = pedestrian.position.x - at.x;
				let dz = pedestrian.position.z - at.z;
				if (dx * dx + dz * dz < 1.6 && Math.abs(pedestrian.position.y + 0.5 - at.y) < 1.5) this.kill(pedestrian);
			}

			for (const car of this.cars)
			{
				if (!car.knocked && car.position.distanceTo(at) < 3.0 && car.stunned <= 0) car.stunned = 4;
			}
		}
	}

	private kill(pedestrian: Pedestrian): void
	{
		pedestrian.state = 'dead';
		pedestrian.health = 0;
		pedestrian.timer = 0;
		this.world.physicsWorld.remove(pedestrian.body);
		// Everyone nearby runs
		this.scatter(pedestrian.position, 18);
	}

	private scatter(from: THREE.Vector3, radius: number): void
	{
		for (const other of this.pedestrians)
		{
			if (!other.alive || other.position.distanceTo(from) > radius) continue;
			if (other.route instanceof Crossing) continue;
			let walk = other.route as Walk;
			let ahead = new THREE.Vector3();
			walk.sample(other.distance + other.direction * 2, ahead);
			// Run whichever way round the block takes them further away
			if (ahead.distanceTo(from) < other.position.distanceTo(from)) other.direction *= -1;
			other.state = 'flee';
			other.timer = 5 + this.random() * 4;
			other.pendingCrossing = undefined;
		}
	}

	// Combat hooks

	/** A gun went off: people nearby run. */
	public onGunshot(origin: THREE.Vector3): void
	{
		if (!this.authority) return;
		this.scatter(origin, 32);
	}

	/**
	 * Distance along a ray to the first pedestrian it passes through, as an
	 * upright cylinder, or undefined.
	 */
	public rayHitsPedestrian(origin: THREE.Vector3, direction: THREE.Vector3, range: number): { pedestrian: Pedestrian, distance: number }
	{
		let best: { pedestrian: Pedestrian, distance: number };
		const radius = 0.32;
		for (const pedestrian of this.pedestrians)
		{
			if (!pedestrian.alive) continue;
			let p = pedestrian.position;
			let dx = origin.x - p.x;
			let dz = origin.z - p.z;
			let a = direction.x * direction.x + direction.z * direction.z;
			if (a < 1e-6) continue;
			let b = 2 * (dx * direction.x + dz * direction.z);
			let c = dx * dx + dz * dz - radius * radius;
			let disc = b * b - 4 * a * c;
			if (disc < 0) continue;
			let root = Math.sqrt(disc);
			let t = (-b - root) / (2 * a);
			if (t < 0) t = (-b + root) / (2 * a);
			if (t < 0 || t > range) continue;
			let y = origin.y + direction.y * t;
			if (y < p.y || y > p.y + 1.02) continue;
			if (best === undefined || t < best.distance) best = { pedestrian: pedestrian, distance: t };
		}
		return best;
	}

	/** A bullet landed on a pedestrian, here or, arriving over the network, on someone else's screen. */
	public damagePedestrian(id: number, damage: number, from: THREE.Vector3): void
	{
		let pedestrian = this.pedestrians.find((p) => p.id === id);
		if (pedestrian === undefined || !pedestrian.alive) return;

		if (!this.authority)
		{
			this.world.party.sendNpcHit(id, damage, from);
			return;
		}

		pedestrian.health -= damage;
		if (pedestrian.health <= 0) this.kill(pedestrian);
		else this.scatter(pedestrian.position, 20);
	}

	// Taking cars

	/** The car in the traffic someone standing here could take, if there is one. */
	public stealable(from: THREE.Vector3): TrafficCar
	{
		if (!this.ready || this.spareCar === undefined) return undefined;
		// Without a relay that passes the word on, the client driving the traffic
		// would never hear the car had gone, and it would come back
		if (!this.authority && !this.world.party.hasFeature('steal')) return undefined;
		let best: TrafficCar;
		let distance = NpcSystem.STEAL_REACH;
		for (const car of this.cars)
		{
			let speed = car.knocked ? car.body.velocity.length() : car.speed;
			if (car.wrecked || car.reportedWreck > 0 || (car.knocked && !car.upright)) continue;
			if (speed > NpcSystem.STEAL_SPEED || Math.abs(car.position.y - from.y) > 2) continue;
			let d = Math.hypot(car.position.x - from.x, car.position.z - from.z);
			if (d < distance)
			{
				distance = d;
				best = car;
			}
		}
		return best;
	}

	/**
	 * Swaps a car in the traffic for a real one in exactly its place, the
	 * same colour, parked, and puts its driver out on the road running. The
	 * player then gets in it the way they get into anything else.
	 */
	public steal(car: TrafficCar): Vehicle
	{
		let gltf = this.spareCar;
		if (gltf === undefined) return undefined;
		this.spareCar = undefined;
		this.loadSpare();

		let party = this.world.party;
		let tag = party !== undefined && party.active ? String(party.client.id) : NpcSystem.SESSION_TAG;
		let name = NpcSystem.STOLEN_PREFIX + tag + ':' + (++this.stolenCount) + ':' + car.color;
		let position = car.object.position.clone();
		let rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.heading);
		let vehicle = this.makeStolen(gltf, name, position, rotation);

		// The driver's door, where they get out
		let door = new THREE.Vector3();
		let driver = vehicle.seats.find((seat) => seat.type === SeatType.Driver);
		if (driver !== undefined && driver.entryPoints.length > 0) driver.entryPoints[0].getWorldPosition(door);
		else door.copy(position).add(new THREE.Vector3(Math.cos(car.heading), 0, -Math.sin(car.heading)).multiplyScalar(1.4));
		door.y = car.position.y;

		this.removeCar(car);
		if (this.authority)
		{
			this.bailOut(door, car.position);
		}
		else
		{
			this.taken.set(car.id, performance.now());
			party.sendNpcSteal(car.id, door);
		}

		// Everyone else gets it now, not once somebody drives it off, so their
		// traffic doesn't run through a car only this screen has
		if (party !== undefined && party.active) party.announceVehicle(vehicle);
		return vehicle;
	}

	/** Another player took a car out of the traffic this client simulates. */
	public onStolen(id: number, door: THREE.Vector3): void
	{
		if (!this.authority) return;
		let car = this.cars.find((c) => c.id === id);
		if (car === undefined) return;
		let from = car.position.clone();
		let abandoned = car.wrecked;
		this.removeCar(car);
		// A wreck's driver has already gone
		if (!abandoned) this.bailOut(door !== undefined ? door : from, from);
	}

	/**
	 * A car somebody took, seen here for the first time in a report of where
	 * it is: made from its name, which carries its colour, at that spot.
	 */
	public spawnStolen(name: string, message: any): boolean
	{
		if (name.indexOf(NpcSystem.STOLEN_PREFIX) !== 0) return false;
		if (this.stolenLoading.has(name) || message === undefined || !Array.isArray(message.p) || !Array.isArray(message.q)) return true;

		let position = new THREE.Vector3(Number(message.p[0]), Number(message.p[1]), Number(message.p[2]));
		let reported = new THREE.Quaternion(Number(message.q[0]), Number(message.q[1]), Number(message.q[2]), Number(message.q[3]));
		if (![position.x, position.y, position.z, reported.x, reported.y, reported.z, reported.w].every(isFinite)) return true;
		reported.normalize();

		// Made upright, facing the way it was reported: the rotation a car is
		// made with is the one it rights itself to, and the report may have
		// caught it mid roll. The report itself is applied the frame after
		let ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(reported);
		let heading = Math.hypot(ahead.x, ahead.z) > 0.1 ? Math.atan2(ahead.x, ahead.z) : 0;
		let rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);

		let generation = this.world.scenarioGeneration;
		this.stolenLoading.add(name);
		createGLTFLoader().load('build/assets/car.glb', (gltf) =>
		{
			this.stolenLoading.delete(name);
			if (this.world.scenarioGeneration !== generation) return;
			if (this.world.vehicles.some((v) => v.getNetworkId() === name)) return;
			this.makeStolen(gltf, name, position, rotation);
		}, undefined, () => this.stolenLoading.delete(name));
		return true;
	}

	private makeStolen(gltf: any, name: string, position: THREE.Vector3, rotation: THREE.Quaternion): Vehicle
	{
		let vehicle = new Car(gltf);

		// Named for the party, which knows vehicles by their spawn point's name
		let spawn = new THREE.Object3D();
		spawn.name = name;
		spawn.position.copy(position);
		spawn.quaternion.copy(rotation);
		spawn.updateMatrixWorld(true);
		vehicle.spawnPoint = spawn;

		let color = Number(name.split(':')[3]);
		let paint = new THREE.Color(TrafficCar.COLORS[(isFinite(color) ? color : 0) % TrafficCar.COLORS.length]);
		vehicle.traverse((child: any) =>
		{
			if (child.isMesh && child.material !== undefined && child.material.name === 'Car')
			{
				child.material = child.material.clone();
				child.material.color.copy(paint);
			}
		});

		// Settles onto its wheels from a hand's width up. Turned before it goes
		// into the world, which remembers the rotation it arrived with
		vehicle.setPosition(position.x, position.y + 0.12, position.z);
		vehicle.collision.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
		vehicle.collision.interpolatedPosition.copy(vehicle.collision.position);
		vehicle.collision.interpolatedQuaternion.copy(vehicle.collision.quaternion);
		vehicle.position.set(position.x, position.y + 0.12, position.z);
		vehicle.quaternion.copy(rotation);
		vehicle.updateMatrixWorld(true);
		this.world.add(vehicle);

		this.stolen.push(vehicle);
		return vehicle;
	}

	/** The driver, out of the door and running for the pavement. */
	private bailOut(door: THREE.Vector3, car: THREE.Vector3): void
	{
		if (this.models.length === 0 || this.walkSpots.length === 0) return;

		// The nearest bit of pavement that isn't back past the car
		let best: { walk: Walk, distance: number, position: THREE.Vector3 };
		let score = Infinity;
		for (const spot of this.walkSpots)
		{
			let d = spot.position.distanceTo(door);
			if (d > 40) continue;
			let behind = spot.position.distanceTo(car) < d ? 6 : 0;
			if (d + behind < score)
			{
				score = d + behind;
				best = spot;
			}
		}
		if (best === undefined) return;

		let variant = Math.floor(this.random() * this.models.length);
		let pedestrian = this.spawnPedestrian(undefined, 0, variant);
		let start = door.clone();
		let run = new Crossing(-1, [start, best.position.clone()]);
		run.to = best.walk;
		run.toDistance = best.distance;
		pedestrian.route = run;
		pedestrian.distance = 0;
		pedestrian.direction = this.random() < 0.5 ? 1 : -1;
		pedestrian.state = 'flee';
		pedestrian.timer = 6 + this.random() * 3;
		this.placePedestrian(pedestrian);

		this.scatter(door, 12);
	}

	/** Clears away taken cars nobody is using and nobody is near, and keeps their number down. */
	private tidyStolen(): void
	{
		let now = performance.now();
		this.taken.forEach((at, id) =>
		{
			if (now - at > 5000) this.taken.delete(id);
		});

		// Gone already, with the rest of a launch
		for (const vehicle of this.stolen.slice())
		{
			if (this.world.vehicles.indexOf(vehicle) >= 0) continue;
			this.stolen.splice(this.stolen.indexOf(vehicle), 1);
			NpcSystem.dispose(vehicle);
		}

		let players = this.playerPositions();
		let party = this.world.party;
		// Sat in, being climbed into or walked up to, here or by anyone in the party
		let inUse = (vehicle: Vehicle) => vehicle.controllingCharacter !== undefined
			|| vehicle.seats.some((seat) => seat.occupiedBy !== null || (party !== undefined && party.seatHolder(seat) !== undefined))
			|| this.world.characters.some((character) =>
			{
				let seat = character.getSeatOfInterest();
				return seat !== null && (seat.vehicle as unknown as Vehicle) === vehicle;
			});

		for (const vehicle of this.stolen.slice())
		{
			let tooMany = this.stolen.length > NpcSystem.MAX_STOLEN;
			let far = this.nearestPlayer(players, vehicle.position) > NpcSystem.STOLEN_KEEP;
			if (inUse(vehicle) || (!far && !tooMany)) continue;
			this.world.remove(vehicle);
			this.stolen.splice(this.stolen.indexOf(vehicle), 1);
			NpcSystem.dispose(vehicle);
		}
	}

	/**
	 * Frees what a taken car was drawn with. Each one is its own copy of the
	 * model, loaded for it alone, so nothing else is using any of it; only the
	 * headlight glow and the sprites' quad are shared, and those stay.
	 */
	private static dispose(vehicle: Vehicle): void
	{
		let shared = (Vehicle as any).lampTexture;
		let free = (root: THREE.Object3D) => root.traverse((child: any) =>
		{
			// Every sprite in three shares one quad, which has to stay
			if (child.geometry !== undefined && child.isSprite !== true) child.geometry.dispose();
			let materials = Array.isArray(child.material) ? child.material : [child.material];
			for (const material of materials)
			{
				if (material === undefined || material === null) continue;
				for (const key in material)
				{
					let value = material[key];
					if (value !== null && value !== undefined && value.isTexture === true && value !== shared) value.dispose();
				}
				material.dispose();
			}
		});
		free(vehicle);
		for (const wheel of vehicle.wheels) free(wheel.wheelObject);
	}

	// Network

	private snapshot(): any
	{
		let r = (v: number, places: number) => Math.round(v * places) / places;
		return {
			t: 'npcs',
			k: r(this.cityClock(), 10),
			c: this.cars.map((car) => [car.id, car.color, r(car.position.x, 100), r(car.position.y, 100), r(car.position.z, 100), r(car.heading, 1000), r(car.knocked ? 0 : car.speed, 10), car.wrecked ? (car.upright ? 1 : 2) : 0]),
			p: this.pedestrians.map((p) => [p.id, p.variant, r(p.position.x, 100), r(p.position.y, 100), r(p.position.z, 100), r(p.heading, 100),
				NpcSystem.STATES.indexOf(p.state), r(p.state === 'flee' ? Pedestrian.RUN_SPEED : p.speed, 10)])
		};
	}

	private cityClock(): number
	{
		return (this.city as any).clock;
	}

	/** Where everything is, according to whoever simulates it. */
	public applySnapshot(message: any): void
	{
		if (!this.ready || this.authority) return;

		if (typeof message.k === 'number' && Math.abs(message.k - this.cityClock()) > 0.4) this.city.setClock(message.k);

		let seenCars = new Set<number>();
		for (const entry of message.c || [])
		{
			let [id, color, x, y, z, heading, speed, wrecked] = entry;
			// Taken here a moment ago, and the news hasn't got there yet
			if (this.taken.has(id)) continue;
			seenCars.add(id);
			let car = this.cars.find((c) => c.id === id);
			if (car === undefined)
			{
				car = this.spawnCar(undefined, 0, color, id);
				car.fresh = true;
			}
			car.target.set(x, y, z);
			car.targetHeading = heading;
			car.reportedWreck = wrecked === 1 || wrecked === 2 ? wrecked : 0;
			if (!car.knocked) car.speed = speed;
		}
		for (const car of this.cars.slice()) if (!seenCars.has(car.id)) this.removeCar(car);

		let seenPeople = new Set<number>();
		for (const entry of message.p || [])
		{
			let [id, variant, x, y, z, heading, state, speed] = entry;
			seenPeople.add(id);
			let pedestrian = this.pedestrians.find((p) => p.id === id);
			if (pedestrian === undefined)
			{
				if (this.models[variant] === undefined) continue;
				pedestrian = this.spawnPedestrian(undefined, 0, variant, id);
				pedestrian.fresh = true;
			}
			pedestrian.target.set(x, y, z);
			pedestrian.targetHeading = heading;
			pedestrian.speed = speed;
			let named = NpcSystem.STATES[state] as any;
			if (named === 'dead' && pedestrian.state !== 'dead') this.world.physicsWorld.remove(pedestrian.body);
			if (named !== undefined) pedestrian.state = named;
		}
		for (const pedestrian of this.pedestrians.slice()) if (!seenPeople.has(pedestrian.id)) this.removePedestrian(pedestrian);
	}

	private static makeLampTexture(): THREE.Texture
	{
		let canvas = document.createElement('canvas');
		canvas.width = canvas.height = 64;
		let context = canvas.getContext('2d');
		let gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
		gradient.addColorStop(0.35, 'rgba(255, 240, 200, 0.5)');
		gradient.addColorStop(1, 'rgba(255, 220, 150, 0)');
		context.fillStyle = gradient;
		context.fillRect(0, 0, 64, 64);
		let texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		return texture;
	}
}
