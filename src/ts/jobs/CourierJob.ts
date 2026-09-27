import * as THREE from 'three';
import { Job } from './Job';
import { JobSystem, JobMarker } from './JobSystem';
import { Vehicle } from '../vehicles/Vehicle';
import { EntityType } from '../enums/EntityType';
import { DropRolling } from '../characters/character_states/DropRolling';

type Stage = 'collecting' | 'delivering';

interface Spot
{
	position: THREE.Vector3;
	facing: THREE.Vector3;
}

interface Parcel
{
	number: number;
	spot: Spot;
	/** Straight out from the depot, which is what it pays on. */
	distance: number;
	fragile: boolean;
	marker: JobMarker;
	delivered: boolean;
}

/**
 * Three parcels from a depot to three doors across town, on foot or in
 * whatever the player's driving.
 *
 * The depot is marked on the map, a stack of boxes by its ring; stand in it,
 * or stop in it, and the parcels are loaded. All three addresses show at
 * once, so the order is the player's to plan, against one clock for the lot.
 * Each pays on the doorstep, more the further it's come. One is fragile: it
 * pays more, but every knock the car takes and every hard landing while it's
 * aboard comes off what it pays. Time left at the last door is a bonus; run
 * out of it and the rest are late, though what's been delivered stays paid.
 */
export class CourierJob extends Job
{
	public readonly id: string = 'courier';
	public readonly title: string = 'Courier';
	public readonly description: string = 'Collect three parcels from the depot and get them to their doors before the clock runs out. Plan your own round, and mind the fragile one.';
	public readonly pays: string = '$150 - $450';

	private static readonly COLOR: string = '#e8913a';
	private static readonly FRAGILE_COLOR: string = '#ff5a4e';
	private static readonly PARCELS: number = 3;
	private static readonly DEPOT_RADIUS: number = 2.5;
	private static readonly DOOR_RADIUS: number = 3.5;
	/** A car's middle can't get as far onto the pavement as a pair of feet can, so it gets more room round a ring. */
	private static readonly CAR_SLACK: number = 2.5;
	private static readonly FOOT_SLACK: number = 0.5;
	private static readonly PICKUP_SPEED: number = 2.5;
	private static readonly DROP_SPEED: number = 3;
	/** Taken off the fragile parcel for each point off the car and each hard landing. */
	private static readonly KNOCK_COST: number = 3;
	/** Falling faster than this as the wheels touch down is a hard landing: a drop of two metres or so. */
	private static readonly HARD_FALL: number = 5;
	/** Shorter than this in the air is a bump in the road. */
	private static readonly MIN_AIRTIME: number = 0.35;

	private static cardboard: THREE.MeshStandardMaterial[];
	private static tape: THREE.MeshStandardMaterial;
	private static fragileTape: THREE.MeshStandardMaterial;
	private static wood: THREE.MeshStandardMaterial;

	private stage: Stage;
	private depot: JobMarker;
	private depotSpot: Spot;
	private parcels: Parcel[] = [];
	private timeLeft: number = 0;
	/** Everything this job put in the scene: the depot's stack, and the parcels left on doorsteps. */
	private props: THREE.Object3D[] = [];
	/** The top of the stack, which is what gets taken away. */
	private loads: THREE.Object3D[] = [];

	// Minding the fragile one
	private knocks: number = 0;
	private landings: number = 0;
	private watched: Vehicle;
	private lastIntegrity: number = 100;
	private airborne: boolean = false;
	private airtime: number = 0;
	private falling: number = 0;
	private rolling: boolean = false;

	constructor(system: JobSystem)
	{
		super(system);
	}

	public start(): string
	{
		this.stage = 'collecting';
		this.parcels = [];
		this.timeLeft = 0;
		this.knocks = 0;
		this.landings = 0;
		this.watched = undefined;
		this.airborne = false;
		this.rolling = false;

		let depot = this.system.pavementSpot(this.system.playerPosition(), 60, 250);
		if (depot === undefined) return 'there\'s no depot near here, head into the city';
		let addresses = this.pickAddresses(depot.position);
		if (addresses === undefined) return 'nowhere to deliver to from the depot';

		let fragile = Math.floor(Math.random() * addresses.length);
		this.parcels = addresses.map((spot, i) => ({
			number: i + 1,
			spot: spot,
			distance: CourierJob.flat(depot.position, spot.position),
			fragile: i === fragile,
			marker: undefined as JobMarker,
			delivered: false
		}));
		this.depotSpot = depot;
		this.depot = this.system.addMarker(depot.position, CourierJob.COLOR, CourierJob.DEPOT_RADIUS, 'Depot');
		this.buildStack(depot);
		return undefined;
	}

	public update(timeStep: number): void
	{
		switch (this.stage)
		{
			case 'collecting': this.collect(); break;
			case 'delivering': this.deliver(timeStep); break;
		}
	}

	public cleanup(): void
	{
		for (const prop of this.props)
		{
			this.world.graphicsWorld.remove(prop);
			prop.traverse((child: any) =>
			{
				// The materials are shared between runs; only the shapes are this run's
				if (child.isMesh) child.geometry.dispose();
			});
		}
		this.props = [];
		this.loads = [];
		this.parcels = [];
		this.depot = undefined;
		this.watched = undefined;
	}

	// The stages

	private collect(): void
	{
		let reach = this.reach();
		let inRing = this.depot.contains(reach.point, reach.slack);
		if (!inRing || reach.speed >= CourierJob.PICKUP_SPEED)
		{
			this.system.setHud('Collect the parcels', inRing ? 'stop in the ring to load up' : 'at the depot, marked on the map');
			return;
		}
		this.pickUp();
	}

	/** Loaded up: the addresses go on the map and the clock starts. */
	private pickUp(): void
	{
		this.system.removeMarker(this.depot);
		this.depot = undefined;
		for (const load of this.loads) load.visible = false;

		for (const parcel of this.parcels)
		{
			let label = 'Parcel ' + parcel.number + (parcel.fragile ? ' FRAGILE' : '');
			let color = parcel.fragile ? CourierJob.FRAGILE_COLOR : CourierJob.COLOR;
			parcel.marker = this.system.addMarker(parcel.spot.position, color, CourierJob.DOOR_RADIUS, label);
		}

		// Timed on a sensible round rather than the best one, so there's room for the roads not being straight
		let round = CourierJob.roundLength(this.depotSpot.position, this.parcels.map((parcel) => parcel.spot.position));
		this.timeLeft = Math.round(round / 7 + 40);
		this.stage = 'delivering';

		// Whatever the player's in now starts clean, however battered it already is
		this.watched = this.drivingVehicle();
		this.lastIntegrity = this.watched !== undefined ? this.watched.integrity : 100;
		this.airborne = false;
		this.rolling = this.isRolling();

		this.world.notices.say('Parcels loaded', 'good', 'parcel ' + this.fragileParcel().number + ' is fragile');
	}

	private deliver(timeStep: number): void
	{
		this.timeLeft -= timeStep;
		this.mindFragile(timeStep);

		let reach = this.reach();
		if (reach.speed < CourierJob.DROP_SPEED)
		{
			for (const parcel of this.parcels)
			{
				if (!parcel.delivered && parcel.marker.contains(reach.point, reach.slack)) this.handOver(parcel);
			}
		}

		let left = this.parcels.filter((parcel) => !parcel.delivered);
		if (left.length === 0)
		{
			let bonus = Math.round(Math.max(0, this.timeLeft) * 2);
			if (bonus > 0) this.system.pay(bonus, 'speed bonus');
			this.system.finish('all delivered');
			return;
		}
		if (this.timeLeft <= 0)
		{
			this.system.fail('the parcels were late');
			return;
		}

		let objective = left.length === 1 ? 'Deliver the last parcel' : 'Deliver ' + left.length + ' parcels';
		let fragile = this.fragileParcel();
		let detail: string;
		if (!fragile.delivered)
		{
			let penalty = this.penalty();
			detail = 'parcel ' + fragile.number + ' is FRAGILE, worth $' + this.payFor(fragile)
				+ (penalty > 0 ? ' after $' + penalty + ' of knocks' : '');
		}
		else detail = (left.length === 1 ? 'parcel ' : 'parcels ') + left.map((parcel) => parcel.number).join(' and ') + ' to go';
		this.system.setHud(objective, detail, this.timeLeft);
	}

	/** On the doorstep and paid for. */
	private handOver(parcel: Parcel): void
	{
		parcel.delivered = true;
		this.system.removeMarker(parcel.marker);
		parcel.marker = undefined;
		this.leaveOnDoorstep(parcel);
		let penalty = parcel.fragile ? this.penalty() : 0;
		this.system.pay(this.payFor(parcel), 'parcel ' + parcel.number + ' delivered' + (penalty > 0 ? ', less the knocks' : ''));
	}

	private payFor(parcel: Parcel): number
	{
		let pay = 40 + parcel.distance * 0.25;
		if (!parcel.fragile) return Math.round(pay);
		return Math.max(10, Math.round(pay + 60 - this.penalty()));
	}

	private penalty(): number
	{
		return (Math.round(this.knocks) + this.landings) * CourierJob.KNOCK_COST;
	}

	// The fragile one

	/**
	 * While it's aboard, every point off whatever's being driven counts
	 * against it, and so does every hard landing, in a car or on foot. A
	 * change of car starts from however the new one was found.
	 */
	private mindFragile(timeStep: number): void
	{
		if (this.fragileParcel().delivered) return;

		let vehicle = this.drivingVehicle();
		if (vehicle !== this.watched)
		{
			this.watched = vehicle;
			this.lastIntegrity = vehicle !== undefined ? vehicle.integrity : 100;
			this.airborne = false;
		}
		if (vehicle !== undefined)
		{
			// A repair lifts it, and only what's lost after that counts
			let lost = this.lastIntegrity - vehicle.integrity;
			if (lost > 0) this.knocks += lost;
			this.lastIntegrity = vehicle.integrity;
			this.watchLanding(vehicle, timeStep);
		}

		// On foot, a fall that ends in a roll
		let rolling = this.isRolling();
		if (rolling && !this.rolling) this.hardLanding();
		this.rolling = rolling;
	}

	/** Wheels off the ground, then back on it falling fast. */
	private watchLanding(vehicle: Vehicle, timeStep: number): void
	{
		let wheels = vehicle.rayCastVehicle;
		if (wheels === undefined || wheels.wheelInfos.length === 0 || vehicle.entityType === EntityType.Helicopter) return;

		if (wheels.numWheelsOnGround === 0)
		{
			if (!this.airborne)
			{
				this.airborne = true;
				this.airtime = 0;
			}
			this.airtime += timeStep;
			// The last frame up rather than the landing one, where the springs have already slowed it
			this.falling = Math.max(0, -vehicle.collision.velocity.y);
			return;
		}
		if (this.airborne && this.airtime >= CourierJob.MIN_AIRTIME && this.falling >= CourierJob.HARD_FALL) this.hardLanding();
		this.airborne = false;
	}

	private hardLanding(): void
	{
		this.landings++;
		this.world.notices.say('Hard landing', 'bad', 'the fragile parcel felt that, -$' + CourierJob.KNOCK_COST);
	}

	private isRolling(): boolean
	{
		let character = this.world.localCharacter;
		return character !== undefined && character.occupyingSeat === null && character.charState instanceof DropRolling;
	}

	private fragileParcel(): Parcel
	{
		return this.parcels.find((parcel) => parcel.fragile);
	}

	// Where things are

	/**
	 * Three doors, each a fair way from the depot and none on top of another.
	 * Undefined if the city won't give three.
	 */
	private pickAddresses(depot: THREE.Vector3): Spot[]
	{
		let chosen: Spot[] = [];
		for (let attempt = 0; attempt < 80 && chosen.length < CourierJob.PARCELS; attempt++)
		{
			let spot = this.system.pavementSpot(depot, 150, 600);
			if (spot === undefined) return undefined;
			if (chosen.every((other) => CourierJob.flat(other.position, spot.position) >= 120)) chosen.push(spot);
		}
		return chosen.length === CourierJob.PARCELS ? chosen : undefined;
	}

	/** Where the player counts as being for a ring, how much room that gets, and how fast they're going. */
	private reach(): { point: THREE.Vector3, slack: number, speed: number }
	{
		let character = this.world.localCharacter;
		let seat = character !== undefined ? character.occupyingSeat : null;
		if (seat !== null)
		{
			let vehicle = seat.vehicle as unknown as Vehicle;
			return { point: vehicle.position, slack: CourierJob.CAR_SLACK, speed: vehicle.collision.velocity.length() };
		}
		return { point: this.system.playerPosition(), slack: CourierJob.FOOT_SLACK, speed: 0 };
	}

	/** Whatever the player's at the controls of: a helicopter's knocks shake a parcel as much as a car's. */
	private drivingVehicle(): Vehicle
	{
		let character = this.world.localCharacter;
		if (character === undefined || character.controlledObject === undefined) return undefined;
		return character.controlledObject as unknown as Vehicle;
	}

	/** Nearest door next, each time, as the crow flies. */
	private static roundLength(from: THREE.Vector3, stops: THREE.Vector3[]): number
	{
		let left = stops.slice();
		let at = from;
		let total = 0;
		while (left.length > 0)
		{
			let best = 0;
			for (let i = 1; i < left.length; i++)
			{
				if (CourierJob.flat(at, left[i]) < CourierJob.flat(at, left[best])) best = i;
			}
			total += CourierJob.flat(at, left[best]);
			at = left[best];
			left.splice(best, 1);
		}
		return total;
	}

	private static flat(a: THREE.Vector3, b: THREE.Vector3): number
	{
		return Math.hypot(a.x - b.x, a.z - b.z);
	}

	// Props

	/** A pallet of boxes just along the pavement from the depot's ring, the top three being the job's. */
	private buildStack(spot: Spot): void
	{
		let stack = new THREE.Group();
		stack.name = 'courier depot';

		let pallet = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.58), CourierJob.materials().wood);
		pallet.position.y = 0.04;
		pallet.castShadow = true;
		pallet.receiveShadow = true;
		stack.add(pallet);

		for (const [x, z] of [[-0.18, -0.145], [0.18, -0.145], [-0.18, 0.145], [0.18, 0.145]])
		{
			let box = CourierJob.box(0.33, 0.25, 0.27, false);
			box.position.set(x, 0.08, z);
			box.rotation.y = (Math.random() - 0.5) * 0.1;
			stack.add(box);
		}

		// x, z, width, height, depth: laid out so none overlaps
		let tops = [[-0.17, -0.12, 0.3, 0.22, 0.24], [0.17, -0.1, 0.28, 0.2, 0.26], [0, 0.15, 0.4, 0.18, 0.22]];
		tops.forEach(([x, z, width, height, depth], i) =>
		{
			let box = CourierJob.box(width, height, depth, i === 2);
			box.position.set(x, 0.33, z);
			box.rotation.y = (Math.random() - 0.5) * 0.2;
			stack.add(box);
			this.loads.push(box);
		});

		let along = spot.facing.clone().setY(0).normalize();
		stack.position.copy(spot.position).addScaledVector(along, CourierJob.DEPOT_RADIUS + 0.8);
		stack.rotation.y = Math.atan2(along.x, along.z);
		this.world.graphicsWorld.add(stack);
		this.props.push(stack);
	}

	/** The parcel, left by the door, until the job's over. */
	private leaveOnDoorstep(parcel: Parcel): void
	{
		let inward = parcel.spot.position.clone().sub(this.system.kerbside(parcel.spot)).setY(0);
		if (inward.lengthSq() > 0) inward.normalize();
		let box = CourierJob.box(0.3, 0.2, 0.24, parcel.fragile);
		box.position.copy(parcel.spot.position).addScaledVector(inward, 0.6);
		box.rotation.y = Math.random() * Math.PI * 2;
		this.world.graphicsWorld.add(box);
		this.props.push(box);
	}

	/** A cardboard box standing on its base, with a band of tape round it: red for fragile. */
	private static box(width: number, height: number, depth: number, fragile: boolean): THREE.Group
	{
		let materials = CourierJob.materials();
		let group = new THREE.Group();
		let card = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth),
			materials.cardboard[Math.floor(Math.random() * materials.cardboard.length)]);
		card.position.y = height / 2;
		card.castShadow = true;
		card.receiveShadow = true;
		// Proud of the card by a hair, so the two don't flicker through each other
		let tape = new THREE.Mesh(new THREE.BoxGeometry(width + 0.006, height + 0.006, depth * 0.22),
			fragile ? materials.fragileTape : materials.tape);
		tape.position.y = height / 2;
		group.add(card, tape);
		return group;
	}

	private static materials(): { cardboard: THREE.MeshStandardMaterial[], tape: THREE.MeshStandardMaterial, fragileTape: THREE.MeshStandardMaterial, wood: THREE.MeshStandardMaterial }
	{
		if (CourierJob.cardboard === undefined)
		{
			CourierJob.cardboard = [
				new THREE.MeshStandardMaterial({ color: 0xa9794a, roughness: 0.92 }),
				new THREE.MeshStandardMaterial({ color: 0xb98c5c, roughness: 0.92 })
			];
			CourierJob.tape = new THREE.MeshStandardMaterial({ color: 0xd9cba4, roughness: 0.5 });
			CourierJob.fragileTape = new THREE.MeshStandardMaterial({ color: 0xc8322a, roughness: 0.5 });
			CourierJob.wood = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.95 });
		}
		return { cardboard: CourierJob.cardboard, tape: CourierJob.tape, fragileTape: CourierJob.fragileTape, wood: CourierJob.wood };
	}
}
