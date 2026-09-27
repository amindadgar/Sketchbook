import * as THREE from 'three';
import { Job } from './Job';
import { JobSystem, JobMarker } from './JobSystem';
import { Character } from '../characters/Character';
import { Vehicle } from '../vehicles/Vehicle';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { SeatType } from '../enums/SeatType';
import { CityPlan } from '../city/CityPlan';

type Stage = 'waiting' | 'boarding' | 'riding' | 'leaving';

/**
 * Fares, one after another, in whatever car the player's driving.
 *
 * Somebody waits at the kerb, marked on the map; stop beside them and they
 * climb in and say where they're going, and there's a clock on it. Pull up
 * there and they pay: more for a longer trip, more for time to spare, and
 * less for every knock the car took with them in it. Run out the clock and
 * they get out in a huff without paying. The next fare is already waiting.
 */
export class TaxiJob extends Job
{
	public readonly id: string = 'taxi';
	public readonly title: string = 'Taxi';
	public readonly description: string = 'Drive fares across town. Stop by the one waiting, get them there in time, and go easy on the car.';
	public readonly pays: string = '$60 - $400 a fare';

	private static readonly COLOR: string = '#f5c518';

	private stage: Stage;
	private fare: Character;
	private marker: JobMarker;
	private seat: VehicleSeat;
	private destination: THREE.Vector3;
	private tripLength: number = 0;
	private timeLeft: number = 0;
	private timer: number = 0;
	private integrityAtPickup: number = 100;
	private fares: number = 0;
	private awayFromCar: number = 0;
	/** The last fare, walking off after being dropped, and how long they have left in view. */
	private leaving: Character;
	private leavingFor: number = 0;

	constructor(system: JobSystem)
	{
		super(system);
	}

	public start(): string
	{
		let car = this.system.drivenVehicle();
		if (car === undefined) return 'get behind the wheel of a car first';
		if (TaxiJob.passengerSeat(car) === undefined) return 'this one has no room for a fare';
		this.fares = 0;
		this.awayFromCar = 0;
		this.nextFare();
		return undefined;
	}

	public update(timeStep: number): void
	{
		this.timer += timeStep;
		this.walkOffLastFare(timeStep);

		let car = this.system.drivenVehicle();
		if (car === undefined && this.stage !== 'boarding')
		{
			// Out of the car: a little while to get back in before the job's off
			this.awayFromCar += timeStep;
			if (this.stage === 'riding' && this.fare !== undefined && this.fare.occupyingSeat !== null)
			{
				this.system.setHud('Get back in the taxi', 'your fare is waiting', 20 - this.awayFromCar);
			}
			else this.system.setHud('Get back in a car', 'taxis need a car', 20 - this.awayFromCar);
			if (this.awayFromCar > 20) this.system.fail('you left the taxi');
			return;
		}
		this.awayFromCar = 0;

		switch (this.stage)
		{
			case 'waiting': this.waitForPickup(car); break;
			case 'boarding': this.board(car); break;
			case 'riding': this.ride(car, timeStep); break;
		}
	}

	public cleanup(): void
	{
		if (this.leaving !== undefined) this.system.removePerson(this.leaving);
		this.leaving = undefined;
		this.fare = undefined;
		this.marker = undefined;
	}

	// The stages

	private nextFare(): void
	{
		let from = this.system.playerPosition();
		let spot = this.system.pavementSpot(from, 80, 320);
		if (spot === undefined)
		{
			this.system.fail('nobody wants a ride out here');
			return;
		}
		let toRoad = this.system.kerbside(spot).sub(spot.position).setY(0);
		this.fare = this.system.addPerson(spot.position, toRoad);
		if (this.fare === undefined)
		{
			// The people are still loading: try again in a moment
			this.stage = 'waiting';
			this.timer = -1;
			return;
		}
		this.marker = this.system.addMarker(this.system.kerbside(spot), TaxiJob.COLOR, 4.5, 'Fare');
		this.stage = 'waiting';
		this.timer = 0;
	}

	private waitForPickup(car: Vehicle): void
	{
		if (this.fare === undefined)
		{
			if (this.timer >= 0) this.nextFare();
			this.system.setHud('Finding a fare', undefined);
			return;
		}
		if (this.fare.health <= 0)
		{
			// Somebody shot the fare. Not a fare any more
			// The body stays until the job's over, when it's tidied with the rest
			this.world.notices.say('No fare', 'bad', 'someone else will do');
			this.system.removeMarker(this.marker);
			this.fare = undefined;
			this.marker = undefined;
			this.nextFare();
			return;
		}
		this.system.setHud('Pick up the fare', this.fares > 0 ? this.fares + ' done so far' : 'marked on the map');

		// Waving at the car once it's close
		let here = this.fare.getWorldPosition(new THREE.Vector3());
		let carAt = car.position;
		if (here.distanceTo(carAt) < 30) this.fare.setOrientation(carAt.clone().sub(here).setY(0).normalize());

		let slow = car.collision.velocity.length() < 2.5;
		if (!this.marker.contains(carAt, 2) || !slow) return;

		this.seat = TaxiJob.passengerSeat(car);
		if (this.seat === undefined)
		{
			this.system.setHud('No room for the fare', 'the seats are full');
			return;
		}
		this.stage = 'boarding';
		this.timer = 0;
	}

	/** Walks to the car and gets in. Straight in if the walk takes too long. */
	private board(car: Vehicle): void
	{
		if (this.fare.health <= 0)
		{
			this.stage = 'waiting';
			return;
		}
		this.system.setHud('Wait for them to get in', undefined);
		let vehicle = this.seat.vehicle as unknown as Vehicle;
		let here = this.fare.getWorldPosition(new THREE.Vector3());
		let door = vehicle.position.clone();
		let close = Math.hypot(here.x - door.x, here.z - door.z) < 2.4;

		if (!close && this.timer < 3)
		{
			this.fare.setViewVector(door.clone().sub(here).setY(0).normalize());
			this.fare.triggerAction('up', true);
			return;
		}
		this.fare.triggerAction('up', false);

		if (this.seat.occupiedBy !== null)
		{
			this.seat = TaxiJob.passengerSeat(vehicle);
			if (this.seat === undefined)
			{
				this.system.fail('there was no room for the fare');
				return;
			}
		}
		this.fare.teleportToVehicle(vehicle, this.seat);

		// Where to, and how long there is
		let from = this.fare.getWorldPosition(new THREE.Vector3());
		let spot = this.system.pavementSpot(from, 220, 650);
		if (spot === undefined)
		{
			this.system.fail('the fare changed their mind');
			return;
		}
		this.destination = this.system.kerbside(spot);
		this.tripLength = from.distanceTo(this.destination);
		this.timeLeft = Math.round(this.tripLength / 8.5 + 25);
		this.integrityAtPickup = vehicle.integrity;
		this.system.removeMarker(this.marker);
		this.marker = this.system.addMarker(this.destination, TaxiJob.COLOR, 6, 'Drop off');
		this.stage = 'riding';
		this.timer = 0;
		this.world.notices.say('Fare on board', 'good', Math.round(this.tripLength / CityPlan.METRE) + ' m to go');
	}

	private ride(car: Vehicle, timeStep: number): void
	{
		if (this.fare.health <= 0)
		{
			this.system.fail('your fare didn\'t make it');
			return;
		}
		// Not in this car any more: they've gone
		if (this.fare.occupyingSeat === null || (this.fare.occupyingSeat.vehicle as unknown as Vehicle) !== car)
		{
			this.system.fail('you lost your fare');
			return;
		}

		this.timeLeft -= timeStep;
		let knocks = Math.max(0, this.integrityAtPickup - car.integrity);
		let fare = this.fareFor(knocks);
		this.system.setHud('Drive to the drop off', 'fare $' + fare + (knocks > 0 ? ', less for the knocks' : ''), this.timeLeft);

		if (this.timeLeft <= 0)
		{
			this.world.notices.say('Out of time', 'bad', 'the fare got out without paying');
			this.dropOff(false);
			return;
		}

		let slow = car.collision.velocity.length() < 2.5;
		if (this.marker.contains(car.position, 2) && slow)
		{
			this.fares++;
			this.system.pay(fare, 'fare ' + this.fares);
			this.dropOff(true);
		}
	}

	private fareFor(knocks: number): number
	{
		let distance = 30 + this.tripLength * 0.35;
		let spare = Math.max(0, this.timeLeft) * 1.2;
		return Math.max(15, Math.round(distance + spare - knocks * 2.5));
	}

	/** Out of the car and off up the pavement, and the next one's waiting. */
	private dropOff(paid: boolean): void
	{
		if (this.leaving !== undefined) this.system.removePerson(this.leaving);
		this.leaving = this.fare;
		this.leavingFor = 6;
		if (this.fare.occupyingSeat !== null) this.fare.exitVehicle();
		this.fare = undefined;
		this.system.removeMarker(this.marker);
		this.marker = undefined;
		this.nextFare();
	}

	private walkOffLastFare(timeStep: number): void
	{
		if (this.leaving === undefined) return;
		this.leavingFor -= timeStep;
		if (this.leavingFor < 4 && this.leaving.occupyingSeat === null && !this.leaving.isBusyWithVehicle())
		{
			// Away from the road
			let from = this.leaving.getWorldPosition(new THREE.Vector3());
			let car = this.system.drivenVehicle();
			if (car !== undefined) this.leaving.setViewVector(from.clone().sub(car.position).setY(0).normalize());
			this.leaving.triggerAction('up', true);
		}
		if (this.leavingFor <= 0)
		{
			this.system.removePerson(this.leaving);
			this.leaving = undefined;
		}
	}

	private static passengerSeat(vehicle: Vehicle): VehicleSeat
	{
		// A back seat if there is one, for the look of it
		let seats = vehicle.seats.filter((seat) => seat.type === SeatType.Passenger && seat.occupiedBy === null);
		return seats.length > 0 ? seats[seats.length - 1] : undefined;
	}
}
