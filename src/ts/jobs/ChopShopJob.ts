import * as THREE from 'three';
import { Job } from './Job';
import { JobSystem, JobMarker } from './JobSystem';
import { Vehicle } from '../vehicles/Vehicle';
import { Character } from '../characters/Character';
import { Blip } from '../core/Minimap';
import { TrafficCar } from '../npc/TrafficCar';
import { findVehicleModel } from '../vehicles/VehicleCatalogue';

type Stage = 'stealing' | 'delivering' | 'handover';

/**
 * A car to order, for a buyer at the docks.
 *
 * The buyer wants one colour, and every car of it in the traffic shows on the
 * map. Take one the usual way, out from under its driver, and the chop shop
 * goes up on the map, down by the harbour if there's room there. Get out or
 * swap to the wrong car and it's back to looking. Stop in the ring and the
 * buyer pays: more the further the car came from where it was taken, and
 * less for every dent in it. There are six minutes before the buyer gives up.
 */
export class ChopShopJob extends Job
{
	public readonly id: string = 'chopshop';
	public readonly title: string = 'Chop shop';
	public readonly description: string = 'A buyer at the docks wants a car in one colour. Take one out of the traffic and bring it in with as few dents as you can.';
	public readonly pays: string = '$300 - $700';

	/** Every car sold here, across every run of the job. */
	private static sold: WeakSet<Vehicle> = new WeakSet();

	private static readonly COLOR: string = '#e8663d';
	private static readonly NAMES: string[] = ['white', 'black', 'silver', 'grey', 'navy', 'red', 'beige', 'green', 'plum', 'blue'];
	private static readonly CLOCK: number = 360;
	private static readonly MIN_DISTANCE: number = 250;
	private static readonly RADIUS: number = 5;
	private static readonly BASE_PRICE: number = 350;
	private static readonly PER_UNIT: number = 0.3;
	/** A wreck still sells for its parts. */
	private static readonly WORST_CONDITION: number = 0.3;
	/** How long the car sits with the buyer before it's gone. */
	private static readonly HANDOVER: number = 1.5;
	/** Past this it's left where it is, even if the player's climbed back in. */
	private static readonly HANDOVER_LIMIT: number = 6;

	private stage: Stage;
	private wanted: number = 0;
	private timeLeft: number = 0;
	private marker: JobMarker;
	private dropOff: THREE.Vector3;
	/** The car being delivered, or last delivered to the ring. */
	private car: Vehicle;
	/** Where each car of the right colour was first driven off from, which is what the buyer pays the distance on. */
	private takenFrom: Map<Vehicle, THREE.Vector3> = new Map();
	/** One map dot per traffic car of the wanted colour. */
	private carBlips: Map<TrafficCar, Blip> = new Map();
	private handingFor: number = 0;
	private verdict: string;

	constructor(system: JobSystem)
	{
		super(system);
	}

	public start(): string
	{
		let npcs = this.world.npcs;
		if (npcs === undefined) return 'there is no traffic to take a car from';

		// Not the colour of a car already taken and sat in, or it's done before it starts
		let count = TrafficCar.COLORS.length;
		let already = this.takenColor(this.system.drivenVehicle());
		let candidates = npcs.cars.filter((car) => !car.wrecked && ChopShopJob.painted(car) && car.color % count !== already);
		if (candidates.length > 0)
		{
			this.wanted = candidates[Math.floor(Math.random() * candidates.length)].color % count;
		}
		else
		{
			this.wanted = Math.floor(Math.random() * count);
			if (this.wanted === already) this.wanted = (this.wanted + 1) % count;
		}

		this.stage = 'stealing';
		this.timeLeft = ChopShopJob.CLOCK;
		this.marker = undefined;
		this.dropOff = undefined;
		this.car = undefined;
		this.takenFrom.clear();
		this.handingFor = 0;
		this.verdict = undefined;
		return undefined;
	}

	public update(timeStep: number): void
	{
		if (this.stage === 'handover')
		{
			this.handOver(timeStep);
			return;
		}

		this.timeLeft -= timeStep;
		if (this.timeLeft <= 0)
		{
			this.system.fail('the buyer went home');
			return;
		}

		let car = this.system.drivenVehicle();
		if (car !== undefined && this.takenColor(car) === this.wanted)
		{
			if (this.stage !== 'delivering' && !this.startDelivering(car)) return;
			this.deliver(car);
		}
		else
		{
			if (this.stage !== 'stealing') this.backToStealing();
			this.steal(car);
		}
	}

	public cleanup(): void
	{
		this.carBlips.forEach((blip) => this.dropBlip(blip));
		this.carBlips.clear();
		// Ended mid handover: the buyer keeps it all the same
		if (this.stage === 'handover' && this.car !== undefined) this.scrap(this.car);
		this.takenFrom.clear();
		this.marker = undefined;
		this.car = undefined;
	}

	// The stages

	/** Looking for a car of the colour, with every one of them on the map. */
	private steal(driving: Vehicle): void
	{
		let about = this.trackCars();
		let name = this.colorName();
		let detail: string;
		if (driving !== undefined) detail = 'not this one: it has to be ' + name + ', taken from the traffic';
		else if (this.car !== undefined && this.car.world !== undefined) detail = 'or get back in the one you took';
		else if (about === 0) detail = 'none about just now: keep looking';
		else detail = (about === 1 ? 'one about' : about + ' about') + ', marked on the map';
		this.system.setHud('Steal a ' + name + ' car', detail, this.timeLeft);
	}

	/** In a car of the right colour: the traffic's dots go and the chop shop goes up. */
	private startDelivering(car: Vehicle): boolean
	{
		this.clearCarBlips();
		if (!this.takenFrom.has(car)) this.takenFrom.set(car, car.position.clone());
		if (this.dropOff === undefined)
		{
			// Down at the docks if there's room far enough off, anywhere otherwise
			let from = car.position;
			let spot = this.system.pavementSpot(from, ChopShopJob.MIN_DISTANCE, 5000, ['harbor'])
				|| this.system.pavementSpot(from, ChopShopJob.MIN_DISTANCE, 5000);
			if (spot === undefined)
			{
				this.system.fail('the buyer couldn\'t be found');
				return false;
			}
			this.dropOff = this.system.kerbside(spot);
		}
		this.marker = this.system.addMarker(this.dropOff, ChopShopJob.COLOR, ChopShopJob.RADIUS, 'Chop shop');
		this.car = car;
		this.stage = 'delivering';
		return true;
	}

	/** Out of it, or into the wrong one: the chop shop's hidden until there's a car for it again. */
	private backToStealing(): void
	{
		this.system.removeMarker(this.marker);
		this.marker = undefined;
		this.stage = 'stealing';
	}

	private deliver(car: Vehicle): void
	{
		this.car = car;
		let price = this.priceFor(car);
		let knocked = car.integrity < 100;
		this.system.setHud('Take it to the chop shop', 'worth $' + price + (knocked ? ' with the dents' : ''), this.timeLeft);

		let slow = car.collision.velocity.length() < 2;
		if (!this.marker.contains(car.position, 1) || !slow) return;

		this.system.pay(price, 'car sold');
		ChopShopJob.sold.add(car);
		this.verdict = ChopShopJob.verdictOn(car.integrity);
		let player = this.world.localCharacter;
		if (player !== undefined && player.occupyingSeat !== null) player.exitVehicle();
		this.system.removeMarker(this.marker);
		this.marker = undefined;
		this.handingFor = 0;
		this.stage = 'handover';
	}

	/** Paid already; the car goes once the player's out and clear of it. */
	private handOver(timeStep: number): void
	{
		this.handingFor += timeStep;
		this.system.setHud('Leave it with the buyer', undefined);
		if (this.handingFor < ChopShopJob.HANDOVER) return;
		if (!this.isEmpty(this.car) && this.handingFor < ChopShopJob.HANDOVER_LIMIT) return;
		this.scrap(this.car);
		this.car = undefined;
		this.system.finish(this.verdict);
	}

	// Cars

	/** Keeps a dot on every traffic car of the wanted colour that could still be taken. How many there are. */
	private trackCars(): number
	{
		let npcs = this.world.npcs;
		let seen = new Set<TrafficCar>();
		if (npcs !== undefined)
		{
			let paint = '#' + TrafficCar.COLORS[this.wanted].toString(16).padStart(6, '0');
			for (const car of npcs.cars)
			{
				// A wreck's driver has gone and it won't be taken
				if (car.color % TrafficCar.COLORS.length !== this.wanted || car.wrecked || car.reportedWreck > 0 || !ChopShopJob.painted(car)) continue;
				seen.add(car);
				let blip = this.carBlips.get(car);
				if (blip === undefined)
				{
					blip = { position: car.position.clone(), color: paint, shape: 'dot', pin: false, bigMapOnly: false };
					this.carBlips.set(car, blip);
					this.world.blips.push(blip);
				}
				else blip.position.copy(car.position);
			}
		}
		this.carBlips.forEach((blip, car) =>
		{
			if (seen.has(car)) return;
			this.dropBlip(blip);
			this.carBlips.delete(car);
		});
		return seen.size;
	}

	private clearCarBlips(): void
	{
		this.carBlips.forEach((blip) => this.dropBlip(blip));
		this.carBlips.clear();
	}

	private dropBlip(blip: Blip): void
	{
		let i = this.world.blips.indexOf(blip);
		if (i >= 0) this.world.blips.splice(i, 1);
	}

	/** Nobody sat in it or on their way in. */
	private isEmpty(vehicle: Vehicle): boolean
	{
		if (vehicle === undefined) return true;
		if (vehicle.seats.some((seat) => seat.occupiedBy !== null)) return false;
		let player: Character = this.world.localCharacter;
		let seat = player !== undefined ? player.getSeatOfInterest() : null;
		return seat === null || (seat.vehicle as unknown as Vehicle) !== vehicle;
	}

	/** Gone to the buyer, if nobody's in it; otherwise left for the traffic to tidy away. */
	private scrap(vehicle: Vehicle): void
	{
		if (vehicle === undefined) return;
		if (this.world.npcs !== undefined) this.world.npcs.letGo(vehicle);
		if (vehicle.world !== undefined && this.isEmpty(vehicle)) this.world.remove(vehicle);
	}

	// Money

	/** Paid on how far it came from where it was taken to the chop shop, then knocked down for the damage. */
	private priceFor(car: Vehicle): number
	{
		let from = this.takenFrom.get(car);
		let distance = from !== undefined && this.dropOff !== undefined ? Math.hypot(this.dropOff.x - from.x, this.dropOff.z - from.z) : 0;
		let condition = Math.max(ChopShopJob.WORST_CONDITION, car.integrity / 100);
		return Math.round((ChopShopJob.BASE_PRICE + distance * ChopShopJob.PER_UNIT) * condition);
	}

	private static verdictOn(integrity: number): string
	{
		if (integrity >= 85) return 'the buyer is happy';
		if (integrity >= 55) return 'a few dents, and the buyer knocked the price down';
		if (integrity >= 30) return 'badly smashed up: the buyer only wanted the parts';
		return 'barely a car any more: the buyer paid scrap';
	}

	// Colours

	private colorName(): string
	{
		return ChopShopJob.NAMES[this.wanted] || 'particular';
	}

	/** Whether a traffic car wears its colour: a taxi's yellow whatever number it carries. */
	private static painted(car: TrafficCar): boolean
	{
		let model = findVehicleModel(car.model);
		return model === undefined || model.paintable;
	}

	/**
	 * The colour a taken car was painted, from its name, or -1 if it isn't a
	 * taken car. One from the dealership has papers, and a taxi or a police
	 * car is its livery whatever its name says, so none of those will do.
	 */
	private takenColor(vehicle: Vehicle): number
	{
		if (vehicle === undefined) return -1;
		if (this.world.dealership !== undefined && this.world.dealership.sold(vehicle)) return -1;
		// Sold once already: climbing back in doesn't make it anybody's to sell again
		if (ChopShopJob.sold.has(vehicle)) return -1;
		let name = vehicle.getNetworkId();
		if (typeof name !== 'string') return -1;
		let parts = name.split(':');
		// 'stolen', whose, which, colour, and the model after it on newer names
		if (parts.length < 4 || parts[0] !== 'stolen') return -1;
		let model = findVehicleModel(parts[4]);
		if (model !== undefined && !model.paintable) return -1;
		let color = Number(parts[3]);
		return isFinite(color) && color >= 0 ? Math.round(color) % TrafficCar.COLORS.length : -1;
	}
}
