import * as THREE from 'three';

import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Car } from '../vehicles/Car';
import { UIManager } from '../core/UIManager';

/**
 * Points for driving badly on purpose.
 *
 * This map is a stunt park. It has a mega ramp, a loop, and half the scenery is
 * something to jump off, and until now none of it counted for anything. Airtime
 * and rotation are measured off the physics body while the wheels are off the
 * ground, and paid out on a clean landing.
 *
 * Rotation comes from integrating angular velocity along the car's own axes
 * rather than comparing quaternions: the axes turn with the car, which is what
 * makes a barrel roll a barrel roll no matter which way the car is pointing.
 */
export class StuntSystem implements IUpdatable
{
	public updateOrder: number = 18;

	/** Below this an air is a bump in the road, not a jump. */
	private static readonly MIN_AIRTIME: number = 0.45;
	private static readonly POINTS_PER_SECOND: number = 60;
	private static readonly POINTS_PER_FLIP: number = 300;
	private static readonly POINTS_PER_ROLL: number = 300;
	private static readonly POINTS_PER_SPIN: number = 150;
	/** How long a landing keeps the chain alive for the next one. */
	private static readonly COMBO_WINDOW: number = 4.5;
	private static readonly MAX_COMBO: number = 5;
	private static readonly BEST_KEY: string = 'sketchbook.beststunt';

	private world: World;

	private airborne: boolean = false;
	private airtime: number = 0;
	private launchHeight: number = 0;
	private peakHeight: number = 0;
	private flipSpin: number = 0;
	private rollSpin: number = 0;
	private yawSpin: number = 0;

	private combo: number = 0;
	private comboTimer: number = 0;
	private session: number = 0;
	private best: number = 0;

	private static forward: THREE.Vector3 = new THREE.Vector3();
	private static right: THREE.Vector3 = new THREE.Vector3();
	private static up: THREE.Vector3 = new THREE.Vector3();

	constructor(world: World)
	{
		this.world = world;
		this.world.registerUpdatable(this);
		this.best = this.loadBest();
	}

	public get sessionScore(): number
	{
		return this.session;
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		if (this.comboTimer > 0)
		{
			this.comboTimer -= unscaledTimeStep;
			if (this.comboTimer <= 0) this.combo = 0;
		}

		let car = this.drivenCar();
		if (car === undefined)
		{
			if (this.airborne) this.reset();
			UIManager.setStuntLive(undefined);
			return;
		}

		let flying = car.rayCastVehicle.numWheelsOnGround === 0;

		if (flying) this.stayUp(car, unscaledTimeStep);
		else if (this.airborne) this.land(car);
	}

	private drivenCar(): Car
	{
		let character = this.world.localCharacter;
		if (character === undefined) return undefined;

		let driven = character.controlledObject as any;
		if (driven === undefined || !(driven instanceof Car)) return undefined;

		return driven;
	}

	private stayUp(car: Car, unscaledTimeStep: number): void
	{
		if (!this.airborne)
		{
			this.airborne = true;
			this.airtime = 0;
			this.flipSpin = 0;
			this.rollSpin = 0;
			this.yawSpin = 0;
			this.launchHeight = car.position.y;
			this.peakHeight = car.position.y;
		}

		this.airtime += unscaledTimeStep;
		this.peakHeight = Math.max(this.peakHeight, car.position.y);

		// The car's own axes, so the sums mean the same thing whichever way it
		// happens to be pointing when it leaves the ground
		StuntSystem.forward.set(0, 0, 1).applyQuaternion(car.quaternion);
		StuntSystem.right.set(1, 0, 0).applyQuaternion(car.quaternion);
		StuntSystem.up.set(0, 1, 0).applyQuaternion(car.quaternion);

		let spin = car.collision.angularVelocity;
		this.rollSpin += (spin.x * StuntSystem.forward.x + spin.y * StuntSystem.forward.y
			+ spin.z * StuntSystem.forward.z) * unscaledTimeStep;
		this.flipSpin += (spin.x * StuntSystem.right.x + spin.y * StuntSystem.right.y
			+ spin.z * StuntSystem.right.z) * unscaledTimeStep;
		this.yawSpin += (spin.x * StuntSystem.up.x + spin.y * StuntSystem.up.y
			+ spin.z * StuntSystem.up.z) * unscaledTimeStep;

		if (this.airtime < StuntSystem.MIN_AIRTIME)
		{
			UIManager.setStuntLive(undefined);
			return;
		}

		UIManager.setStuntLive(this.describe(), this.airtime.toFixed(1) + 's');
	}

	private land(car: Car): void
	{
		let airtime = this.airtime;
		let clean = new THREE.Vector3(0, 1, 0).applyQuaternion(car.quaternion).y > 0.4;

		this.airborne = false;

		if (airtime < StuntSystem.MIN_AIRTIME)
		{
			UIManager.setStuntLive(undefined);
			return;
		}

		UIManager.setStuntLive(undefined);

		if (!clean)
		{
			this.combo = 0;
			this.comboTimer = 0;
			this.world.notices.say('Bailed', 'bad', this.describe());
			return;
		}

		let score = Math.round(
			(airtime - StuntSystem.MIN_AIRTIME) * StuntSystem.POINTS_PER_SECOND
			+ this.turns(this.flipSpin) * StuntSystem.POINTS_PER_FLIP
			+ this.turns(this.rollSpin) * StuntSystem.POINTS_PER_ROLL
			+ this.turns(this.yawSpin) * StuntSystem.POINTS_PER_SPIN
			+ Math.max(0, this.peakHeight - this.launchHeight) * 12);

		if (score <= 0) return;

		this.combo = Math.min(StuntSystem.MAX_COMBO, this.combo + 1);
		this.comboTimer = StuntSystem.COMBO_WINDOW;

		let total = score * this.combo;
		this.session += total;

		this.world.notices.say(this.describe() + '  +' + total, 'good',
			this.combo > 1 ? 'x' + this.combo + ' chain' : undefined);

		this.world.progress.addStuntPoints(total);

		if (this.session > this.best)
		{
			let beaten = this.best > 0;
			this.best = this.session;
			this.saveBest(this.best);

			// Only worth saying once a run, not on every landing that extends it
			if (beaten && this.combo === 1) this.world.notices.say('New stunt record', 'good', String(this.best));
		}
	}

	/** What the car just did, in words, for the toast and the live readout. */
	private describe(): string
	{
		let parts: string[] = [];

		let flips = this.turns(this.flipSpin);
		let rolls = this.turns(this.rollSpin);
		let spins = this.turns(this.yawSpin);

		if (flips > 0) parts.push(flips > 1 ? flips + ' flips' : 'Flip');
		if (rolls > 0) parts.push(rolls > 1 ? rolls + ' rolls' : 'Barrel roll');
		if (spins > 0) parts.push(spins > 1 ? spins + ' spins' : '360');

		if (parts.length === 0) parts.push(this.airtime > 2.2 ? 'Huge air' : 'Air');

		return parts.join(' + ');
	}

	private turns(radians: number): number
	{
		return Math.floor(Math.abs(radians) / (Math.PI * 2));
	}

	private reset(): void
	{
		this.airborne = false;
		this.airtime = 0;
	}

	private loadBest(): number
	{
		try
		{
			return Number(window.localStorage.getItem(StuntSystem.BEST_KEY)) || 0;
		}
		catch (error)
		{
			return 0;
		}
	}

	private saveBest(score: number): void
	{
		try
		{
			window.localStorage.setItem(StuntSystem.BEST_KEY, String(score));
		}
		catch (error)
		{
			// It lives as long as the tab does
		}
	}
}
