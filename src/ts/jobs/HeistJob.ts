import * as THREE from 'three';
import * as CANNON from 'cannon';
import { Job } from './Job';
import { JobSystem, JobMarker } from './JobSystem';
import { Driver, Gunman, laneRoute, nearestLane } from './JobAI';
import { Character } from '../characters/Character';
import { Vehicle } from '../vehicles/Vehicle';
import { Blip } from '../core/Minimap';
import { City } from '../city/City';
import { CityPlan } from '../city/CityPlan';
import { CollisionGroups } from '../enums/CollisionGroups';

type Stage = 'waiting' | 'chasing' | 'halting' | 'loot';

/**
 * A security van on its round, and what it's carrying.
 *
 * The van is out on the streets across town, marked on the map, with a
 * driver and a guard aboard and a yellow bar on the roof. Stop it: ram it
 * until it gives up, shoot the driver through the window, or box it in and
 * wait. It puts its foot down once it sees you coming, and if it gets far
 * enough ahead it's gone. Stopped, the two of them get out shooting and four
 * cash bags land in the road behind it; each one is money in the wallet as
 * soon as it's picked up. With the first one a safehouse turns up on the
 * map: get there with any at all before the police find the van, for a bonus
 * on every bag brought in.
 */
export class HeistJob extends Job
{
	public readonly id: string = 'heist';
	public readonly title: string = 'Cash van heist';
	public readonly description: string = 'Stop a security van on its round, deal with the guards, grab the cash bags and get them to a safehouse.';
	public readonly pays: string = '$1,200 - $2,400';

	private static readonly VAN_COLOR: string = '#1f6b3a';
	private static readonly SAFEHOUSE_COLOR: string = '#3fcf6a';
	private static readonly BAGS: number = 4;
	private static readonly BONUS: number = 200;
	/** To stop the van, from the start. */
	private static readonly CHASE_TIME: number = 300;
	/** From the van stopping to the police turning up at it. */
	private static readonly LOOT_TIME: number = 150;
	private static readonly SPAWN_MIN: number = 250;
	private static readonly SPAWN_MAX: number = 450;
	private static readonly CRUISE: number = 9;
	private static readonly FLEE: number = 15;
	/** Near enough for the crew to see who's after them. */
	private static readonly SPOTTED: number = 40;
	private static readonly LOST: number = 600;
	/** Knocked about this badly, the driver gives up. */
	private static readonly WRECKED_BELOW: number = 45;
	/** Held still this long with the player close by, it's been boxed in. */
	private static readonly BOXED_TIME: number = 6;
	private static readonly BOXED_NEAR: number = 25;
	/** Longest the van's given to roll to a stop before the crew get out anyway. */
	private static readonly HALT_MAX: number = 4;
	private static readonly BAG_LIFE: number = 180;
	/** Each stretch of the round asked for at a time. */
	private static readonly ROUTE: number = 300;
	/** How long the van has to turn up before it's put down to bad luck. */
	private static readonly ARRIVAL_TIME: number = 20;

	private stage: Stage;
	/** Bumped at every start and end, so a bag picked up after the job's over doesn't count for the next one. */
	private run: number = 0;
	private van: Vehicle;
	private driver: Character;
	private guard: Character;
	private driverAI: Driver;
	private blip: Blip;
	private lightBar: THREE.Group;
	private barGeometry: THREE.BoxGeometry;
	private barMaterial: THREE.MeshBasicMaterial;
	private safehouse: JobMarker;
	private timeLeft: number = 0;
	private lootLeft: number = 0;
	private waiting: number = 0;
	private halting: number = 0;
	private stuck: number = 0;
	private spotted: boolean = false;
	private bagsTaken: number = 0;
	private bags: object[] = [];

	constructor(system: JobSystem)
	{
		super(system);
	}

	public start(): string
	{
		let npcs = this.world.npcs;
		if (npcs === undefined || npcs.navigation === undefined) return 'there\'s no traffic out to rob';
		let spawn = this.findStart(this.system.playerPosition());
		if (spawn === undefined) return 'no cash vans are out on the roads near here';

		this.run++;
		this.stage = 'waiting';
		this.van = undefined;
		this.driver = undefined;
		this.guard = undefined;
		this.driverAI = undefined;
		this.safehouse = undefined;
		this.timeLeft = HeistJob.CHASE_TIME;
		this.lootLeft = HeistJob.LOOT_TIME;
		this.waiting = 0;
		this.halting = 0;
		this.stuck = 0;
		this.spotted = false;
		this.bagsTaken = 0;

		let color = Math.random() < 0.5 ? 3 : 1;
		this.system.addVehicle(spawn.position, spawn.heading, color, (vehicle) => this.vanArrived(vehicle, spawn.route), 'van');
		return undefined;
	}

	public update(timeStep: number): void
	{
		this.followVan();
		switch (this.stage)
		{
			case 'waiting': this.waitForVan(timeStep); break;
			case 'chasing': this.chase(timeStep); break;
			case 'halting': this.halt(timeStep); break;
			case 'loot': this.loot(timeStep); break;
		}
	}

	public cleanup(): void
	{
		this.run++;
		this.removeBlip();
		// Whatever's still in the road goes with the van
		for (const bag of this.bags) this.world.cashDrops.take(bag);
		this.bags = [];
		if (this.lightBar !== undefined)
		{
			this.world.graphicsWorld.remove(this.lightBar);
			this.barGeometry.dispose();
			this.barMaterial.dispose();
			this.lightBar = undefined;
		}
		this.van = undefined;
		this.driver = undefined;
		this.guard = undefined;
		this.driverAI = undefined;
		this.safehouse = undefined;
	}

	// The stages

	private waitForVan(timeStep: number): void
	{
		this.timeLeft -= timeStep;
		this.waiting += timeStep;
		this.system.setHud('Stop the cash van', 'finding it on its round', this.timeLeft);
		if (this.waiting > HeistJob.ARRIVAL_TIME) this.system.fail('the cash van never came out');
	}

	/** Loaded and on the road: marked, lit, and the crew aboard as soon as they can be. */
	private vanArrived(vehicle: Vehicle, route: THREE.Vector3[]): void
	{
		this.van = vehicle;
		this.driverAI = new Driver(route, HeistJob.CRUISE, () => this.moreRoad());
		this.buildLightBar(vehicle);
		this.blip = { position: vehicle.position.clone(), color: HeistJob.VAN_COLOR, label: 'Cash van', pin: true, shape: 'diamond' };
		this.world.blips.push(this.blip);
		this.stage = 'chasing';
		this.boardCrew();
	}

	private chase(timeStep: number): void
	{
		let van = this.van;
		if (van.world === undefined)
		{
			this.system.fail('the van got away');
			return;
		}
		this.boardCrew();
		this.timeLeft -= timeStep;

		let distance = this.system.playerPosition().distanceTo(van.position);
		if (distance > HeistJob.LOST)
		{
			this.system.fail('the van got away');
			return;
		}
		if (this.timeLeft <= 0)
		{
			this.system.fail('the van finished its round');
			return;
		}

		// Seen coming: foot down
		if (!this.spotted && this.driver !== undefined && distance < HeistJob.SPOTTED)
		{
			this.spotted = true;
			this.driverAI.speed = HeistJob.FLEE;
			this.world.notices.say('They\'ve seen you', 'bad', 'the van is making a run for it');
		}
		if (this.driverAI.done) this.newRound(van);

		// Boxed in, the driver shunts back and forth trying to get out: that
		// wears the count down rather than starting it again
		let speed = van.collision.velocity.length();
		if (distance < HeistJob.BOXED_NEAR) this.stuck = speed < 1 ? this.stuck + timeStep : Math.max(0, this.stuck - timeStep);
		else this.stuck = 0;

		let driverDown = this.driver !== undefined && (this.driver.health <= 0 || this.driver.occupyingSeat === null
			|| (this.driver.occupyingSeat.vehicle as unknown as Vehicle) !== van);
		if (van.integrity < HeistJob.WRECKED_BELOW || driverDown || this.stuck > HeistJob.BOXED_TIME)
		{
			this.stop();
			return;
		}

		let detail: string;
		if (this.stuck > 1.5) detail = 'keep it boxed in';
		else if (this.spotted) detail = 'it\'s running: ram it or shoot the driver';
		else detail = Math.round(distance / CityPlan.METRE / 10) * 10 + ' m off: ram it or shoot the driver';
		this.system.setHud('Stop the cash van', detail, this.timeLeft);
	}

	/** Pulled up: the driver's foot on the brake, and the police are on their way. */
	private stop(): void
	{
		this.stage = 'halting';
		this.halting = 0;
		this.lootLeft = HeistJob.LOOT_TIME;
		if (this.driverAI !== undefined) this.driverAI.paused = true;
		this.world.notices.say('The van\'s stopped', 'good', 'the guards are armed');
	}

	private halt(timeStep: number): void
	{
		this.halting += timeStep;
		this.lootLeft -= timeStep;
		this.system.setHud('Get the cash bags', 'the guards are getting out', this.lootLeft);

		// Brakes on, whoever's at the wheel: a dead driver's foot is on nothing
		if (this.van.world !== undefined)
		{
			for (const action of ['throttle', 'reverse', 'left', 'right']) this.van.triggerAction(action, false);
			this.van.triggerAction('brake', true);
		}

		// Out of the doors once it's still, or they'd be thrown down the road
		let speed = this.van.world !== undefined ? this.van.collision.velocity.length() : 0;
		if (speed > 1 && this.halting < HeistJob.HALT_MAX) return;
		if (this.van.world !== undefined) this.van.triggerAction('brake', false);
		this.crewOut();
		this.dropBags();
		this.stage = 'loot';
	}

	private loot(timeStep: number): void
	{
		this.lootLeft -= timeStep;
		if (this.lootLeft <= 0)
		{
			this.system.fail('the police found the van');
			return;
		}
		let bags = 'bags ' + this.bagsTaken + ' / ' + HeistJob.BAGS;
		if (this.bagsTaken >= HeistJob.BAGS) this.removeBlip();

		if (this.bagsTaken === 0)
		{
			this.system.setHud('Grab the cash bags', bags + ', behind the van', this.lootLeft);
			return;
		}
		if (this.safehouse === undefined && !this.placeSafehouse())
		{
			this.system.setHud('Get clear of the van', bags, this.lootLeft);
			return;
		}

		this.system.wayTo = this.safehouse.position;
		if (this.safehouse.contains(this.system.playerPosition(), 1.5))
		{
			this.system.pay(HeistJob.BONUS * this.bagsTaken, 'cash bags to the safehouse');
			this.system.finish('the money is safe');
			return;
		}
		this.system.setHud('Get to the safehouse', bags, this.lootLeft);
	}

	// The van and its crew

	/** The driver and the guard, as soon as there are bodies to make them from. */
	private boardCrew(): void
	{
		if (this.driver === undefined)
		{
			this.driver = this.system.seatPerson(this.van, true);
			if (this.driver !== undefined) this.system.setMind(this.driver, this.driverAI);
		}
		if (this.driver !== undefined && this.guard === undefined) this.guard = this.system.seatPerson(this.van, false);
	}

	/** Both of them out and shooting, whoever's still alive. */
	private crewOut(): void
	{
		for (const person of [this.driver, this.guard])
		{
			if (person === undefined || person.world === undefined || person.health <= 0) continue;
			if (person.occupyingSeat !== null) person.exitVehicle();
			let gunman = new Gunman(this.world, { weapon: Math.random() < 0.5 ? 'automatic' : 'shotgun', hostile: true, accuracy: 0.4 });
			this.system.setMind(person, gunman);
			gunman.arm();
		}
	}

	/** Four bags out of the back and into the road behind, each a little to one side. */
	private dropBags(): void
	{
		let van = this.van;
		let back = new THREE.Vector3(0, 0, -1).applyQuaternion(van.quaternion).setY(0);
		// On its nose or its tail, any way will do
		if (back.lengthSq() < 0.01) back.set(0, 0, -1);
		back.normalize();
		let side = new THREE.Vector3(-back.z, 0, back.x);
		let run = this.run;
		for (let i = 0; i < HeistJob.BAGS; i++)
		{
			let at = van.position.clone()
				.addScaledVector(back, 3 + i * 1.2)
				.addScaledVector(side, (i % 2 === 0 ? -1 : 1) * (0.4 + Math.random() * 0.4));
			at.y = this.groundBelow(at, van.position.y);
			let amount = 250 + Math.round(Math.random() * 150);
			this.bags.push(this.world.cashDrops.drop(at, amount, 'cash bag', HeistJob.BAG_LIFE, () =>
			{
				if (run === this.run) this.bagsTaken++;
			}));
		}

		// The map points at the bags now, not the van
		if (this.blip !== undefined)
		{
			this.blip.position.copy(van.position).addScaledVector(back, 4.8);
			this.blip.label = 'Cash bags';
		}
	}

	/** Somewhere to lie low, well away. False if there's nowhere yet: it's asked for again. */
	private placeSafehouse(): boolean
	{
		let from = this.system.playerPosition();
		let spot = this.system.pavementSpot(from, 300, 600) || this.system.pavementSpot(from, 150, 900);
		if (spot === undefined) return false;
		this.safehouse = this.system.addMarker(spot.position, HeistJob.SAFEHOUSE_COLOR, 4, 'Safehouse');
		this.world.notices.say('Safehouse', 'good', 'get the money there before the police turn up');
		return true;
	}

	// The round

	/** A spot on a lane, far enough off to go looking for, on land and clear of the traffic. */
	private findStart(from: THREE.Vector3): { position: THREE.Vector3, heading: number, route: THREE.Vector3[] }
	{
		let npcs = this.world.npcs;
		let lanes = npcs.navigation.lanes.filter((lane) => !lane.turn && lane.length > 12);
		if (lanes.length === 0) return undefined;
		let position = new THREE.Vector3();
		let direction = new THREE.Vector3();
		for (let tries = 0; tries < 400; tries++)
		{
			let lane = lanes[Math.floor(Math.random() * lanes.length)];
			let along = 4 + Math.random() * (lane.length - 8);
			lane.sample(along, position, direction);
			let d = Math.hypot(position.x - from.x, position.z - from.z);
			if (d < HeistJob.SPAWN_MIN || d > HeistJob.SPAWN_MAX || !City.onLand(position.x, position.z)) continue;
			if (npcs.cars.some((car) => car.position.distanceTo(position) < 8)) continue;
			let route = laneRoute(lane, along, HeistJob.ROUTE);
			if (route.length < 2) continue;
			return { position: position.clone(), heading: Math.atan2(direction.x, direction.z), route: route };
		}
		return undefined;
	}

	/** More of the round, on from wherever the last stretch ended, so the van never runs out of road. */
	private moreRoad(): THREE.Vector3[]
	{
		let points = this.driverAI !== undefined ? this.driverAI.points : [];
		if (points.length === 0) return [];
		let last = points[points.length - 1];
		let heading: THREE.Vector3;
		for (let i = points.length - 2; i >= 0 && heading === undefined; i--)
		{
			if (points[i].distanceTo(last) > 1) heading = last.clone().sub(points[i]).setY(0).normalize();
		}
		return this.routeFrom(last, heading);
	}

	/** Run out of road all the same: a fresh round from where it's sitting. */
	private newRound(van: Vehicle): void
	{
		let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(van.quaternion).setY(0).normalize();
		let route = this.routeFrom(van.position, forward);
		if (route.length === 0) return;
		this.driverAI.points = route;
		this.driverAI.index = 0;
		this.driverAI.done = false;
	}

	private routeFrom(point: THREE.Vector3, heading?: THREE.Vector3): THREE.Vector3[]
	{
		let found = nearestLane(this.world.npcs.navigation, point, heading);
		if (found === undefined) return [];
		return laneRoute(found.lane, found.distance + 4, HeistJob.ROUTE);
	}

	// Props

	/** A yellow bar across the roof, so the van can be picked out of the traffic. */
	private buildLightBar(vehicle: Vehicle): void
	{
		let roof = HeistJob.roofOf(vehicle);
		this.barGeometry = new THREE.BoxGeometry(0.5, 0.07, 0.12);
		this.barMaterial = new THREE.MeshBasicMaterial({ color: 0xffc81e });
		let bar = new THREE.Mesh(this.barGeometry, this.barMaterial);
		bar.position.set(roof.x, roof.y + 0.035, roof.z);
		bar.castShadow = true;
		this.lightBar = new THREE.Group();
		this.lightBar.name = 'cash van light bar';
		this.lightBar.add(bar);
		this.world.graphicsWorld.add(this.lightBar);
		this.followVan();
	}

	/** The bar and the map mark keep up with the van; vehicles move earlier in the frame than jobs do. */
	private followVan(): void
	{
		let van = this.van;
		if (van === undefined) return;
		if (this.lightBar !== undefined)
		{
			this.lightBar.position.copy(van.position);
			this.lightBar.quaternion.copy(van.quaternion);
		}
		if (this.blip !== undefined && (this.stage === 'chasing' || this.stage === 'halting')) this.blip.position.copy(van.position);
	}

	private removeBlip(): void
	{
		if (this.blip === undefined) return;
		let i = this.world.blips.indexOf(this.blip);
		if (i >= 0) this.world.blips.splice(i, 1);
		this.blip = undefined;
	}

	/** The fixed ground under a point, for a bag to lie on rather than float over; the van's own height if there's none. */
	private groundBelow(point: THREE.Vector3, fallback: number): number
	{
		let highest: number;
		this.world.physicsWorld.raycastAll(
			new CANNON.Vec3(point.x, fallback + 1, point.z),
			new CANNON.Vec3(point.x, fallback - 4, point.z),
			// tslint:disable-next-line: no-bitwise
			{ collisionFilterMask: ~CollisionGroups.Characters, skipBackfaces: true },
			(result: CANNON.RaycastResult) =>
			{
				if (result.body.mass !== 0) return;
				if (highest === undefined || result.hitPointWorld.y > highest) highest = result.hitPointWorld.y;
			});
		return highest !== undefined ? highest : fallback;
	}

	/**
	 * Where the top of the car's body is, from its origin and turned with it.
	 * Measured before anyone's sat in it, since the people ride along as part
	 * of the car.
	 */
	private static roofOf(vehicle: Vehicle): THREE.Vector3
	{
		vehicle.updateMatrixWorld(true);
		let box = new THREE.Box3();
		let part = new THREE.Box3();
		vehicle.traverseVisible((child: THREE.Object3D) =>
		{
			let mesh = child as THREE.Mesh;
			if (!mesh.isMesh || mesh.geometry === undefined) return;
			if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
			box.union(part.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
		});
		if (box.isEmpty()) return new THREE.Vector3(0, 1.3, 0);
		let middle = box.getCenter(new THREE.Vector3()).sub(vehicle.position).applyQuaternion(vehicle.quaternion.clone().invert());
		return new THREE.Vector3(middle.x, box.max.y - vehicle.position.y, middle.z);
	}
}
