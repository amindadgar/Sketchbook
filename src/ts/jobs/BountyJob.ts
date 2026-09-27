import * as THREE from 'three';
import { Job } from './Job';
import { JobSystem, JobMarker } from './JobSystem';
import { Gunman, Walker, Runner, Driver, nearestLane, laneRoute, clearLine } from './JobAI';
import { Character } from '../characters/Character';
import { Vehicle } from '../vehicles/Vehicle';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { SeatType } from '../enums/SeatType';
import { CityPlan } from '../city/CityPlan';
import { City } from '../city/City';
import { Blip } from '../core/Minimap';
import { Wallet } from '../progress/Wallet';

type Stage = 'waiting' | 'startled' | 'running' | 'driving' | 'bailing' | 'fleeing' | 'fighting';
type Lot = { minX: number, maxX: number, minZ: number, maxZ: number };

/**
 * A price on a man's head.
 *
 * He hangs about in a parking lot across town beside his car, with two or
 * three bodyguards, and the lot's marked on the map with him on it. Walk up,
 * point a gun his way or let one off nearby, and the guards open up while he
 * makes for the car and drives off through the streets. Wreck the car and he
 * runs for it on foot; if the car's no use to him at all he stands and fights.
 * He pays out dead, with a bit more for every bodyguard dropped on the way.
 * Let him get far enough off, or run out the clock, and the bounty's gone.
 */
export class BountyJob extends Job
{
	public readonly id: string = 'bounty';
	public readonly title: string = 'Bounty';
	public readonly description: string = 'A wanted man is waiting in a parking lot with his bodyguards. Take him out before he drives off.';
	public readonly pays: string = '$900 - $1,600';

	private static readonly AREA_COLOR: string = '#ff8a3d';
	private static readonly TARGET_COLOR: string = '#e8323c';
	private static readonly NAMES: string[] = [
		'Vinnie "Two Tabs" Russo', 'Dmitri Kask', 'Lefty Moreau', 'Sal Brannigan',
		'Marco "The Weasel" Duarte', 'Earl Pettibone', 'Nicky Szabo', 'Ray "Dimes" Holloway'
	];
	private static readonly GUARD_WEAPONS: string[] = ['smg', 'shotgun', 'automatic'];
	private static readonly CAR_COLORS: number[] = [1, 2, 3, 4, 8];
	private static readonly TIME_LIMIT: number = 300;
	/** How far off the lot can be. */
	private static readonly NEAREST: number = 250;
	private static readonly FURTHEST: number = 700;
	/** Close enough for them to notice the player. */
	private static readonly NOTICE: number = 18;
	/** A gun pointed at them from this close, in plain view, gives the game away. */
	private static readonly AIM_NOTICE: number = 30;
	/** A shot heard from this close does too. */
	private static readonly SHOT_NOTICE: number = 50;
	private static readonly GOT_AWAY: number = 450;
	private static readonly GUARD_BONUS: number = 50;
	private static readonly DRIVE_SPEED: number = 11;
	/** Below this the car's no good to him. */
	private static readonly WRECKED: number = 20;

	private stage: Stage;
	private name: string;
	private bounty: number = 0;
	private elapsed: number = 0;
	/** Time in the current stage. */
	private timer: number = 0;
	private area: JobMarker;
	private blip: Blip;

	private carSpot: THREE.Vector3;
	private carHeading: number = 0;
	private car: Vehicle;
	private targetSpot: THREE.Vector3;
	private targetFacing: THREE.Vector3;
	private target: Gunman;
	/** Bodyguards still to be made, while the bodies load. */
	private guardSpots: { position: THREE.Vector3, facing: THREE.Vector3, weapon: string }[] = [];
	private guards: Gunman[] = [];

	private walker: Walker;
	private driver: Driver;
	private stuckFor: number = 0;
	/** The player's gun last frame, to tell a shot from the magazine going down. */
	private lastWeapon: string;
	private lastAmmo: number = 0;

	constructor(system: JobSystem)
	{
		super(system);
	}

	public start(): string
	{
		let player = this.world.localCharacter;
		if (this.world.combat.carriedIds().length === 0 && (player === undefined || player.weapon === undefined))
		{
			return 'you need a gun for this: try Bullseye Guns';
		}
		if (this.world.shops === undefined || this.world.npcs === undefined) return 'nobody has a price on their head just now';
		let lot = this.findLot(this.system.playerPosition());
		if (lot === undefined) return 'nobody wanted round here: try nearer town';

		this.name = BountyJob.NAMES[Math.floor(Math.random() * BountyJob.NAMES.length)];
		this.bounty = Math.round((900 + Math.random() * 700) / 10) * 10;
		this.elapsed = 0;
		this.timer = 0;
		this.stuckFor = 0;
		this.car = undefined;
		this.target = undefined;
		this.guards = [];
		this.guardSpots = [];
		this.walker = undefined;
		this.driver = undefined;
		this.lastWeapon = undefined;
		this.lastAmmo = 0;
		this.plan(lot);

		let middle = new THREE.Vector3((lot.minX + lot.maxX) / 2, CityPlan.GROUND + CityPlan.CURB, (lot.minZ + lot.maxZ) / 2);
		this.area = this.system.addMarker(middle, BountyJob.AREA_COLOR, 20, 'Target area');
		this.blip = { position: this.targetSpot.clone(), color: BountyJob.TARGET_COLOR, label: this.name, pin: true, shape: 'diamond' };
		this.world.blips.push(this.blip);

		let color = BountyJob.CAR_COLORS[Math.floor(Math.random() * BountyJob.CAR_COLORS.length)];
		this.system.addVehicle(this.carSpot, this.carHeading, color, (vehicle) => this.car = vehicle, 'sedan');
		// Before the crew are made, who'd otherwise take it that the fight had started
		this.stage = 'waiting';
		this.spawnCrew();
		return undefined;
	}

	public update(timeStep: number): void
	{
		this.elapsed += timeStep;
		this.timer += timeStep;
		let fired = this.playerFired();
		if (this.target === undefined || this.guardSpots.length > 0) this.spawnCrew();

		if (this.target === undefined)
		{
			// The bodies are still loading
			if (this.timeLeft() <= 0)
			{
				this.system.fail('the bounty ran out');
				return;
			}
			this.system.setHud('Take out ' + this.name, 'bounty $' + Wallet.format(this.bounty) + ', lot marked on the map', this.timeLeft());
			return;
		}

		let me = this.target.character;
		if (me.world === undefined)
		{
			this.system.fail('he got away');
			return;
		}
		let here = me.getWorldPosition(new THREE.Vector3());
		this.blip.position.copy(here);

		if (me.health <= 0)
		{
			this.collect();
			return;
		}
		let player = this.system.playerPosition();
		let distance = Math.hypot(here.x - player.x, here.z - player.z);
		if (this.stage !== 'waiting' && this.stage !== 'startled' && distance > BountyJob.GOT_AWAY)
		{
			this.system.fail('he got away');
			return;
		}
		if (this.timeLeft() <= 0)
		{
			this.system.fail('the bounty ran out');
			return;
		}

		switch (this.stage)
		{
			case 'waiting': if (this.alerted(here, player, fired)) this.startle(); break;
			case 'startled': if (this.timer > 2) this.getAway(); break;
			case 'running': this.runToCar(here); break;
			case 'driving': this.drive(timeStep); break;
			case 'bailing': this.getOut(); break;
		}
		this.hud(distance);
	}

	public cleanup(): void
	{
		if (this.blip !== undefined)
		{
			let i = this.world.blips.indexOf(this.blip);
			if (i >= 0) this.world.blips.splice(i, 1);
		}
		this.blip = undefined;
		this.area = undefined;
		this.car = undefined;
		this.target = undefined;
		this.guards = [];
		this.guardSpots = [];
		this.walker = undefined;
		this.driver = undefined;
	}

	// Setting up

	/** An open lot a fair way off: not the dealership's, not the garage's, and not one of the corners the ring road cuts through. */
	private findLot(from: THREE.Vector3): Lot
	{
		let shops = this.world.shops;
		let dealer = shops.dealerLot;
		let land = CityPlan.LAND;
		let found: Lot[] = [];
		for (let i = 0; i < 48; i++)
		{
			let angle = Math.random() * Math.PI * 2;
			let reach = BountyJob.NEAREST + Math.random() * (BountyJob.FURTHEST - BountyJob.NEAREST);
			let x = THREE.MathUtils.clamp(from.x + Math.cos(angle) * reach, land.minX, land.maxX);
			let z = THREE.MathUtils.clamp(from.z + Math.sin(angle) * reach, land.minZ, land.maxZ);
			let lot = shops.lotNear(new THREE.Vector2(x, z));
			if (lot === undefined || found.some((other) => other.minX === lot.minX && other.minZ === lot.minZ)) continue;

			let cx = (lot.minX + lot.maxX) / 2;
			let cz = (lot.minZ + lot.maxZ) / 2;
			let d = Math.hypot(cx - from.x, cz - from.z);
			if (d < BountyJob.NEAREST || d > BountyJob.FURTHEST || !City.onLand(cx, cz)) continue;
			if (dealer !== undefined && BountyJob.gap(lot, dealer) < 60) continue;
			if (shops.sites.some((site) => site.position.x > lot.minX - 4 && site.position.x < lot.maxX + 4
				&& site.position.z > lot.minZ - 4 && site.position.z < lot.maxZ + 4)) continue;
			if (BountyJob.cutByRing(lot)) continue;
			found.push(lot);
		}
		return found.length > 0 ? found[Math.floor(Math.random() * found.length)] : undefined;
	}

	/** Where the car, the man and his bodyguards go in the lot. */
	private plan(lot: Lot): void
	{
		let y = CityPlan.GROUND + CityPlan.CURB + 0.02;
		let cx = (lot.minX + lot.maxX) / 2;
		let cz = (lot.minZ + lot.maxZ) / 2;
		let width = lot.maxX - lot.minX;
		let depth = lot.maxZ - lot.minZ;

		// Clear of the planters down the middle, nose out to the nearer street for a quick getaway
		let side = Math.random() < 0.5 ? -1 : 1;
		this.carSpot = new THREE.Vector3(cx + (Math.random() - 0.5) * width * 0.4, y, cz + side * depth * 0.3);
		this.carHeading = side > 0 ? 0 : Math.PI;

		// Leaning about beside it, a short dash from the door
		let inward = this.carSpot.x < cx ? 1 : -1;
		this.targetSpot = this.carSpot.clone().add(new THREE.Vector3(inward * 3.2, 0, -side * 1.2));
		this.targetFacing = new THREE.Vector3(0, 0, side);

		let count = 2 + (Math.random() < 0.5 ? 1 : 0);
		let start = Math.random() * Math.PI * 2;
		for (let i = 0; i < count; i++)
		{
			for (let attempt = 0; attempt < 8; attempt++)
			{
				let angle = start + i * Math.PI * 2 / count + attempt * 0.5;
				let reach = 3.5 + Math.random() * 2.5;
				let spot = this.targetSpot.clone().add(new THREE.Vector3(Math.cos(angle) * reach, 0, Math.sin(angle) * reach));
				spot.x = THREE.MathUtils.clamp(spot.x, lot.minX + 1.5, lot.maxX - 1.5);
				spot.z = THREE.MathUtils.clamp(spot.z, lot.minZ + 1.5, lot.maxZ - 1.5);
				let fromMan = Math.hypot(spot.x - this.targetSpot.x, spot.z - this.targetSpot.z);
				let fromCar = Math.hypot(spot.x - this.carSpot.x, spot.z - this.carSpot.z);
				if (fromMan < 2 || fromMan > 6 || fromCar < 2.8 || Math.abs(spot.z - cz) < 1.5) continue;
				// Looking out, as a bodyguard does
				let facing = spot.clone().sub(this.targetSpot).setY(0).normalize();
				let weapon = BountyJob.GUARD_WEAPONS[Math.floor(Math.random() * BountyJob.GUARD_WEAPONS.length)];
				this.guardSpots.push({ position: spot, facing: facing, weapon: weapon });
				break;
			}
		}
	}

	/** Makes whoever isn't made yet. Called again next frame while the bodies are loading. */
	private spawnCrew(): void
	{
		if (this.target === undefined)
		{
			this.target = this.system.addGunman(this.targetSpot, this.targetFacing, { weapon: 'heavy_pistol', accuracy: 0.5, hostile: false });
			if (this.target === undefined) return;
		}
		for (let i = this.guardSpots.length - 1; i >= 0; i--)
		{
			let spot = this.guardSpots[i];
			let guard = this.system.addGunman(spot.position, spot.facing, { weapon: spot.weapon, accuracy: 0.35 });
			if (guard === undefined) return;
			this.guardSpots.splice(i, 1);
			// Late to a fight that's already started
			if (this.stage !== 'waiting') guard.hostile = true;
			this.guards.push(guard);
		}
	}

	// The stages

	/** Too close, shot at, a shot nearby, or a gun pointed their way where they can see it. */
	private alerted(here: THREE.Vector3, player: THREE.Vector3, fired: boolean): boolean
	{
		let crew = [this.target, ...this.guards];
		if (crew.some((member) => member.hostile || member.character.health < Character.MAX_HEALTH)) return true;
		if (fired && here.distanceTo(player) < BountyJob.SHOT_NOTICE) return true;

		let eye = player.clone();
		eye.y += 0.6;
		for (const member of crew)
		{
			let at = member.character.getWorldPosition(new THREE.Vector3());
			let d = Math.hypot(at.x - player.x, at.z - player.z);
			if (d < BountyJob.NOTICE) return true;
			if (this.world.combat.isAiming && d < BountyJob.AIM_NOTICE && clearLine(this.world, eye, at.setY(at.y + 0.6))) return true;
		}
		return false;
	}

	/** The guards open up and he's off in a moment. The lot's found, so its ring goes. */
	private startle(): void
	{
		this.stage = 'startled';
		this.timer = 0;
		this.target.hostile = true;
		for (const guard of this.guards) guard.hostile = true;
		this.system.removeMarker(this.area);
		this.area = undefined;
		this.world.notices.say(this.name, 'bad', 'he\'s seen you');
	}

	/** For the car if it'll still take him anywhere, otherwise he makes a stand. */
	private getAway(): void
	{
		if (this.carUsable()) this.run();
		else this.fight();
	}

	private run(): void
	{
		let me = this.target.character;
		me.resetControls();
		this.walker = new Walker(this.doorOf(this.car), true);
		this.system.setMind(me, this.walker);
		this.stage = 'running';
		this.timer = 0;
	}

	/** To the driver's door, following the car if it's been shoved, and in. */
	private runToCar(here: THREE.Vector3): void
	{
		if (!this.carUsable())
		{
			this.fight();
			return;
		}
		let door = this.doorOf(this.car);
		this.walker.goal.copy(door);
		let toCar = Math.hypot(here.x - this.car.position.x, here.z - this.car.position.z);
		let toDoor = Math.hypot(here.x - door.x, here.z - door.z);
		// Snagged on the bodywork a while counts as there
		if (toCar < 2 || toDoor < 1.2 || (this.timer > 6 && toCar < 4))
		{
			this.board();
			return;
		}
		if (this.timer > 12) this.fight();
	}

	private board(): void
	{
		let me = this.target.character;
		let seat = BountyJob.driverSeat(this.car);
		me.resetControls();
		me.teleportToVehicle(this.car, seat);
		if (me.occupyingSeat !== seat)
		{
			// Somebody beat him to it
			if (me.occupyingSeat !== null) me.forceLeaveVehicle();
			this.fight();
			return;
		}
		let route = this.routeFrom(this.car.position);
		if (route.length < 2)
		{
			me.forceLeaveVehicle();
			this.flee();
			return;
		}
		this.driver = new Driver(route, BountyJob.DRIVE_SPEED, () => this.moreRoad());
		this.system.setMind(me, this.driver);
		this.stage = 'driving';
		this.timer = 0;
		this.stuckFor = 0;
		this.world.notices.say(this.name, 'bad', 'he\'s in his car: don\'t let him get away');
	}

	/** Off through the streets until the car gives out, or he's stuck, or it's on its roof. */
	private drive(timeStep: number): void
	{
		let me = this.target.character;
		let car = this.car;
		if (me.occupyingSeat === null && !me.isBusyWithVehicle())
		{
			this.flee();
			return;
		}
		if (car === undefined || car.world === undefined)
		{
			this.bail();
			return;
		}
		let velocity = car.collision.velocity;
		let still = Math.hypot(velocity.x, velocity.z) < 1;
		this.stuckFor = still ? this.stuckFor + timeStep : 0;
		if (car.integrity < BountyJob.WRECKED || this.stuckFor > 8 || (still && BountyJob.upturned(car)) || this.driver.done)
		{
			this.bail();
		}
	}

	private bail(): void
	{
		this.target.character.exitVehicle();
		this.stage = 'bailing';
		this.timer = 0;
	}

	/** Out of the door, then off on foot. Pulled out if the door won't let him. */
	private getOut(): void
	{
		let me = this.target.character;
		if (me.occupyingSeat === null && !me.isBusyWithVehicle())
		{
			this.flee();
			return;
		}
		if (this.timer > 3)
		{
			me.forceLeaveVehicle();
			this.flee();
		}
	}

	private flee(): void
	{
		let me = this.target.character;
		me.resetControls();
		this.system.setMind(me, new Runner(this.world));
		this.stage = 'fleeing';
		this.timer = 0;
		this.world.notices.say(this.name, undefined, 'he\'s running for it on foot');
	}

	/** No way out: he turns and shoots it out where he stands. */
	private fight(): void
	{
		let me = this.target.character;
		me.resetControls();
		this.target.hostile = true;
		this.system.setMind(me, this.target);
		this.stage = 'fighting';
		this.timer = 0;
	}

	private collect(): void
	{
		let dropped = this.guards.filter((guard) => !guard.alive).length;
		this.system.pay(this.bounty, 'bounty on ' + this.name);
		if (dropped > 0) this.system.pay(dropped * BountyJob.GUARD_BONUS, dropped === 1 ? 'a bodyguard' : dropped + ' bodyguards');
		this.system.finish('bounty collected');
	}

	private hud(distance: number): void
	{
		let line: string;
		switch (this.stage)
		{
			case 'waiting': line = (this.guards.length + this.guardSpots.length) + ' bodyguards with him, lot marked on the map'; break;
			case 'startled': line = 'he\'s seen you'; break;
			case 'running': line = 'he\'s making for his car'; break;
			case 'driving': line = 'he\'s driving off, ' + Math.round(distance / CityPlan.METRE / 10) * 10 + ' m ahead'; break;
			case 'fighting': line = 'he\'s standing his ground'; break;
			default: line = 'he\'s running for it on foot'; break;
		}
		this.system.setHud('Take out ' + this.name, 'bounty $' + Wallet.format(this.bounty) + ', ' + line, this.timeLeft());
	}

	// Helpers

	private timeLeft(): number
	{
		return BountyJob.TIME_LIMIT - this.elapsed;
	}

	/** Whether the player let one off since last frame: the round in the chamber went, on the same gun. */
	private playerFired(): boolean
	{
		let player = this.world.localCharacter;
		let weapon = player !== undefined && player.weapon !== undefined ? player.weapon.id : undefined;
		let ammo = player !== undefined ? player.ammo : 0;
		let fired = weapon !== undefined && weapon === this.lastWeapon && ammo < this.lastAmmo;
		this.lastWeapon = weapon;
		this.lastAmmo = ammo;
		return fired;
	}

	/** There, whole, on its wheels, and nobody else in it or getting in, least of all the player. */
	private carUsable(): boolean
	{
		let car = this.car;
		if (car === undefined || car.world === undefined) return false;
		if (car.integrity < BountyJob.WRECKED || BountyJob.upturned(car)) return false;
		let seat = BountyJob.driverSeat(car);
		if (seat === undefined || (seat.occupiedBy !== null && seat.occupiedBy !== this.target.character)) return false;
		let player = this.world.localCharacter;
		let theirs = player !== undefined ? player.getSeatOfInterest() : null;
		return theirs === null || theirs === undefined || (theirs.vehicle as unknown as Vehicle) !== car;
	}

	private doorOf(car: Vehicle): THREE.Vector3
	{
		let seat = BountyJob.driverSeat(car);
		let door = new THREE.Vector3();
		if (seat !== undefined && seat.entryPoints.length > 0) seat.entryPoints[0].getWorldPosition(door);
		else door.copy(car.position);
		return door;
	}

	/** Onto the nearest lane and away along the streets. */
	private routeFrom(point: THREE.Vector3): THREE.Vector3[]
	{
		let near = nearestLane(this.world.npcs.navigation, point);
		if (near === undefined) return [];
		return laneRoute(near.lane, near.distance + 6, 400);
	}

	/** More road on from the end of the last, the same way, so he never runs out of city to drive. */
	private moreRoad(): THREE.Vector3[]
	{
		let points = this.driver !== undefined ? this.driver.points : [];
		if (points.length < 2) return undefined;
		let end = points[points.length - 1];
		let heading = end.clone().sub(points[points.length - 2]).setY(0).normalize();
		let near = nearestLane(this.world.npcs.navigation, end, heading);
		if (near === undefined) return undefined;
		return laneRoute(near.lane, near.distance + 4, 400);
	}

	private static driverSeat(car: Vehicle): VehicleSeat
	{
		return car.seats.find((seat) => seat.type === SeatType.Driver);
	}

	private static upturned(car: Vehicle): boolean
	{
		return new THREE.Vector3(0, 1, 0).applyQuaternion(car.quaternion).y < 0.3;
	}

	/** How far apart two lots are, edge to edge. */
	private static gap(a: Lot, b: Lot): number
	{
		let x = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
		let z = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
		return Math.hypot(x, z);
	}

	/**
	 * The corner blocks the ring road cuts through are zoned for parking but
	 * never built as lots, only left as ground with a road across; the same
	 * test the city's builder makes, on the block round the lot.
	 */
	private static cutByRing(lot: Lot): boolean
	{
		let s = CityPlan.SIDEWALK;
		let r = CityPlan.RING_RADIUS;
		let corners = [
			[CityPlan.RING_WEST + r, CityPlan.RING_NORTH + r], [CityPlan.RING_WEST + r, CityPlan.RING_SOUTH - r],
			[CityPlan.OCEAN_X - r, CityPlan.RING_NORTH + r], [CityPlan.OCEAN_X - r, CityPlan.RING_SOUTH - r]];
		for (const [x, z] of corners)
		{
			let nearX = THREE.MathUtils.clamp(x, lot.minX - s, lot.maxX + s);
			let nearZ = THREE.MathUtils.clamp(z, lot.minZ - s, lot.maxZ + s);
			let farX = Math.max(Math.abs(lot.minX - s - x), Math.abs(lot.maxX + s - x));
			let farZ = Math.max(Math.abs(lot.minZ - s - z), Math.abs(lot.maxZ + s - z));
			if (Math.hypot(nearX - x, nearZ - z) < r + 12 && Math.hypot(farX, farZ) > r - 12) return true;
		}
		return false;
	}
}
