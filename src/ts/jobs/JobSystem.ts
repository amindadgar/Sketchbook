import * as THREE from 'three';
import { World } from '../world/World';
import { City } from '../city/City';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Job } from './Job';
import { Panel, PanelRow } from '../core/Panel';
import { Blip } from '../core/Minimap';
import { Character } from '../characters/Character';
import { Vehicle } from '../vehicles/Vehicle';
import { EntityType } from '../enums/EntityType';
import { UIManager } from '../core/UIManager';
import { Wallet } from '../progress/Wallet';
import { CityPlan } from '../city/CityPlan';
import { Gunman, GunmanOptions } from './JobAI';
import { ICharacterAI } from '../interfaces/ICharacterAI';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { SeatType } from '../enums/SeatType';

/** A place a job wants the player: a glowing ring and column, and a mark on the map pointing the way. */
export class JobMarker
{
	public position: THREE.Vector3;
	public radius: number;
	public object: THREE.Group;
	public blip: Blip;

	private world: World;
	private materials: THREE.MeshBasicMaterial[] = [];

	constructor(world: World, position: THREE.Vector3, color: string, radius: number, label?: string)
	{
		this.world = world;
		this.position = position.clone();
		this.radius = radius;
		this.object = new THREE.Group();
		this.object.name = 'job marker';

		let tint = new THREE.Color(color);
		let ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.86, radius, 48), new THREE.MeshBasicMaterial({
			color: tint.clone().multiplyScalar(1.7), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide
		}));
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.05;
		let column = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, 3, 40, 1, true), new THREE.MeshBasicMaterial({
			color: tint, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
		}));
		column.position.y = 1.5;
		for (const mesh of [ring, column])
		{
			mesh.userData.noOcclusion = true;
			this.materials.push(mesh.material as THREE.MeshBasicMaterial);
			this.object.add(mesh);
		}
		this.object.position.copy(this.position);
		world.graphicsWorld.add(this.object);

		this.blip = { position: this.position, color: color, label: label, pin: true, shape: 'diamond' };
		world.blips.push(this.blip);
	}

	public moveTo(position: THREE.Vector3): void
	{
		this.position.copy(position);
		this.object.position.copy(position);
	}

	/** Within the ring, and not far above or below it. */
	public contains(point: THREE.Vector3, slack: number = 0): boolean
	{
		let dx = point.x - this.position.x;
		let dz = point.z - this.position.z;
		return dx * dx + dz * dz < (this.radius + slack) * (this.radius + slack) && Math.abs(point.y - this.position.y) < 4;
	}

	public pulse(time: number): void
	{
		let glow = 0.5 + 0.5 * Math.sin(time * 4);
		this.materials[0].opacity = 0.55 + glow * 0.35;
		this.materials[1].opacity = 0.1 + glow * 0.12;
	}

	public dispose(): void
	{
		this.world.graphicsWorld.remove(this.object);
		this.object.traverse((child: any) =>
		{
			if (child.isMesh)
			{
				child.geometry.dispose();
				child.material.dispose();
			}
		});
		let i = this.world.blips.indexOf(this.blip);
		if (i >= 0) this.world.blips.splice(i, 1);
	}
}

/**
 * Work for money, from the job board on J.
 *
 * One job runs at a time, alongside free roam: nothing is relaunched, the
 * traffic and the people carry on, and so does everyone else in a party.
 * The system holds what every job needs: the markers, the people it puts
 * in the city, where the player is and what they're driving, the panel
 * saying what to do next and how long is left, and paying out. A job ends
 * by paying, by failing, or by being walked away from on the board, and it
 * also ends if the player dies or the world is relaunched under it.
 */
export class JobSystem implements IUpdatable
{
	public updateOrder: number = 19;

	public world: World;
	public city: City;
	public jobs: Job[] = [];
	public active: Job;
	public time: number = 0;

	private markers: JobMarker[] = [];
	private people: Character[] = [];
	private vehicles: Vehicle[] = [];
	private arrivals: (() => void)[] = [];
	/** Bumped at every job's end, so a car still loading for the last one isn't handed to the next. */
	private run: number = 0;
	private generation: number = -1;
	private character: Character;
	private boardOpen: boolean = false;
	private shownHud: string = '';

	constructor(world: World, city: City)
	{
		this.world = world;
		this.city = city;
		world.registerUpdatable(this);
	}

	public register(job: Job): void
	{
		this.jobs.push(job);
	}

	// The board

	public toggleBoard(): void
	{
		if (this.boardOpen && Panel.isOpen)
		{
			Panel.close();
			return;
		}
		this.showBoard();
	}

	private showBoard(): void
	{
		let rows: PanelRow[] = this.jobs.map((job) =>
		{
			let running = this.active === job;
			return {
				title: job.title,
				detail: job.description,
				aside: job.pays,
				button: running ? 'Quit' : 'Start',
				highlight: running,
				onClick: () =>
				{
					Panel.close();
					if (running) this.quit();
					else this.start(job);
				}
			};
		});
		let subtitle = this.active !== undefined
			? 'Working: ' + this.active.title + '.  Starting another quits it.'
			: 'Pick something to do for money. You have $' + Wallet.format(this.world.wallet.cash) + '.';
		this.boardOpen = true;
		Panel.open('Jobs', subtitle, rows, () => this.boardOpen = false);
	}

	// Running a job

	public start(job: Job): void
	{
		if (this.active !== undefined) this.end();
		let character = this.world.localCharacter;
		if (character === undefined || character.health <= 0)
		{
			this.world.notices.say('Not now', 'bad', 'come back to life first');
			return;
		}
		this.active = job;
		this.generation = this.world.scenarioGeneration;
		this.character = character;
		let reason = job.start();
		if (reason !== undefined)
		{
			this.end();
			this.world.notices.say(job.title, 'bad', reason);
			return;
		}
		// Unless it went wrong inside its own start, which has said so already
		if (this.active === job) this.world.notices.say(job.title, 'good', 'started');
	}

	/** Walked away from on the board. */
	public quit(): void
	{
		if (this.active === undefined) return;
		let title = this.active.title;
		this.end();
		this.world.notices.say(title, undefined, 'quit');
	}

	/** Went wrong: no pay, and the job's over. */
	public fail(reason: string): void
	{
		if (this.active === undefined) return;
		let title = this.active.title;
		this.end();
		this.world.notices.say(title + ' failed', 'bad', reason);
	}

	/** Paid, for a part of a job or the whole of it. Experience comes with the money. */
	public pay(amount: number, reason: string): void
	{
		amount = Math.round(amount);
		if (amount <= 0) return;
		this.world.wallet.add(amount, reason);
		this.world.progress.addJob(this.active !== undefined ? this.active.id : 'job', Math.round(10 + amount / 12));
	}

	/** Done, and nothing more to it. Pay first if it paid. */
	public finish(message?: string): void
	{
		if (this.active === undefined) return;
		let title = this.active.title;
		this.end();
		if (message !== undefined) this.world.notices.say(title, 'good', message);
	}

	private end(): void
	{
		let job = this.active;
		this.active = undefined;
		this.run++;
		this.arrivals = [];
		if (job !== undefined) job.cleanup();
		for (const marker of this.markers.slice()) this.removeMarker(marker);
		for (const person of this.people.slice()) this.removePerson(person);
		for (const vehicle of this.vehicles.slice()) this.removeVehicle(vehicle);
		this.setHud(undefined);
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		this.time += unscaledTimeStep;
		for (const marker of this.markers) marker.pulse(this.time);

		if (this.boardOpen && !Panel.isOpen) this.boardOpen = false;
		if (this.active === undefined) return;

		// The world went out from under it
		let character = this.world.localCharacter;
		if (this.world.scenarioGeneration !== this.generation || character !== this.character)
		{
			this.fail('interrupted');
			return;
		}
		if (character.health <= 0)
		{
			this.fail('you died');
			return;
		}

		// Cars that have loaded since the last frame
		let run = this.run;
		for (const arrival of this.arrivals.splice(0))
		{
			arrival();
			if (this.run !== run) return;
		}

		// Paused on a briefing or in slow motion, the clock is the game's
		this.active.update(timeStep, timeStep);
		if (this.active !== undefined) this.pointTheWay();
	}

	/**
	 * An arrow in the panel toward the nearest place the job is marking, turned
	 * to the way the camera faces, and how far it is. A phone keeps its map
	 * folded away, so the minimap's arrows round its edge are no help there.
	 */
	private pointTheWay(): void
	{
		let way = document.getElementById('job-way');
		if (way === null) return;
		let here = this.playerPosition();
		let nearest: Blip;
		let best = Infinity;
		for (const blip of this.world.blips)
		{
			if (blip.pin !== true) continue;
			let d = Math.hypot(blip.position.x - here.x, blip.position.z - here.z);
			if (d < best)
			{
				best = d;
				nearest = blip;
			}
		}
		// Nothing to point at, or already there
		if (nearest === undefined || best < 6)
		{
			if (way.style.display !== 'none') way.style.display = 'none';
			return;
		}
		if (way.style.display === 'none') way.style.display = '';

		let forward = this.world.camera.getWorldDirection(new THREE.Vector3());
		let facing = Math.atan2(forward.x, forward.z);
		let bearing = Math.atan2(nearest.position.x - here.x, nearest.position.z - here.z);
		// Clockwise on screen is to the right, which is the negative way round from above
		let turn = (facing - bearing) * 180 / Math.PI;
		document.getElementById('job-arrow').style.transform = 'rotate(' + (turn - 90).toFixed(1) + 'deg)';

		let metres = Math.round(best / CityPlan.METRE / 10) * 10;
		let text = metres >= 1000 ? (metres / 1000).toFixed(1) + ' km' : metres + ' m';
		let distance = document.getElementById('job-distance');
		if (distance.textContent !== text) distance.textContent = text;
	}

	// What a job shows

	/**
	 * The panel at the top left: what to do now, a line under it, and how long
	 * is left if the clock's running. Undefined hides it.
	 */
	public setHud(objective: string, detail?: string, secondsLeft?: number): void
	{
		let hud = document.getElementById('job-hud');
		if (hud === null) return;
		if (objective === undefined || this.active === undefined)
		{
			hud.style.display = 'none';
			this.shownHud = '';
			return;
		}
		let timer = secondsLeft !== undefined ? JobSystem.clock(secondsLeft) : '';
		let key = objective + '|' + (detail || '') + '|' + timer;
		if (key === this.shownHud) return;
		this.shownHud = key;
		hud.style.display = '';
		document.getElementById('job-title').textContent = this.active.title;
		document.getElementById('job-objective').textContent = objective;
		document.getElementById('job-detail').textContent = detail || '';
		let clock = document.getElementById('job-timer');
		clock.textContent = timer;
		clock.classList.toggle('urgent', secondsLeft !== undefined && secondsLeft < 10);
	}

	public static clock(seconds: number): string
	{
		let s = Math.max(0, Math.ceil(seconds));
		return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
	}

	// Markers and people

	public addMarker(position: THREE.Vector3, color: string, radius: number, label?: string): JobMarker
	{
		let marker = new JobMarker(this.world, position, color, radius, label);
		this.markers.push(marker);
		return marker;
	}

	public removeMarker(marker: JobMarker): void
	{
		if (marker === undefined) return;
		let i = this.markers.indexOf(marker);
		if (i < 0) return;
		this.markers.splice(i, 1);
		marker.dispose();
	}

	/**
	 * Somebody in the city for the job: one of the pedestrians' bodies as a full
	 * character, standing where it's put, facing along a direction. Undefined
	 * while the bodies are still loading.
	 */
	public addPerson(position: THREE.Vector3, facing?: THREE.Vector3, variant?: number): Character
	{
		let model = this.world.npcs !== undefined
			? this.world.npcs.personModel(variant !== undefined ? variant : Math.floor(Math.random() * 9))
			: undefined;
		if (model === undefined) return undefined;
		let person = new Character(model);
		this.world.add(person);
		person.setPosition(position.x, position.y + 0.6, position.z);
		if (facing !== undefined) person.setOrientation(facing.clone().setY(0).normalize(), true);
		this.people.push(person);
		return person;
	}

	public removePerson(person: Character): void
	{
		if (person === undefined) return;
		let i = this.people.indexOf(person);
		if (i >= 0) this.people.splice(i, 1);
		if (person.world === undefined) return;
		if (person.isBusyWithVehicle()) person.forceLeaveVehicle();
		this.world.remove(person);
	}

	/**
	 * Somebody with a gun, posted here: a guard, a bodyguard. Calm until the
	 * job makes them hostile or somebody shoots them. Undefined while the
	 * bodies are still loading.
	 */
	public addGunman(position: THREE.Vector3, facing: THREE.Vector3, options: GunmanOptions, variant?: number): Gunman
	{
		let person = this.addPerson(position, facing, variant);
		if (person === undefined) return undefined;
		let ai = new Gunman(this.world, Object.assign({ home: position }, options));
		person.setBehaviour(ai);
		ai.arm();
		return ai;
	}

	/** Gives somebody a mind of their own: running, driving, walking somewhere. */
	public setMind(person: Character, ai: ICharacterAI): void
	{
		if (person !== undefined && person.world !== undefined) person.setBehaviour(ai);
	}

	/**
	 * A car for the job, parked on a heading (radians about the vertical, 0
	 * facing +z), in one of the traffic's colours by number. It arrives a
	 * moment later, once loaded; ready is called on a later frame, and only if
	 * the job is still the one that asked. Taken away when the job ends, unless the player is in it.
	 */
	public addVehicle(position: THREE.Vector3, heading: number, color: number, ready: (vehicle: Vehicle) => void, model?: string): void
	{
		if (this.world.npcs === undefined) return;
		let run = this.run;
		this.world.npcs.spawnJobCar(position, heading, color, (vehicle) =>
		{
			if (run !== this.run || this.active === undefined)
			{
				this.world.npcs.letGo(vehicle);
				this.world.remove(vehicle);
				return;
			}
			this.vehicles.push(vehicle);
			// Handed over on the job's next frame, never in the middle of its start()
			this.arrivals.push(() => ready(vehicle));
		}, model);
	}

	/**
	 * Done with a car: whoever the job sat in it is taken out, and the car goes
	 * too, unless the player's in it or getting in, in which case it's theirs.
	 */
	public removeVehicle(vehicle: Vehicle): void
	{
		if (vehicle === undefined) return;
		let i = this.vehicles.indexOf(vehicle);
		if (i >= 0) this.vehicles.splice(i, 1);
		for (const seat of vehicle.seats)
		{
			let occupant = seat.occupiedBy;
			if (occupant !== null && this.people.indexOf(occupant) >= 0) this.removePerson(occupant);
		}
		if (this.world.npcs !== undefined) this.world.npcs.letGo(vehicle);
		let player = this.world.localCharacter;
		let players = player !== undefined && (player.occupyingSeat !== null && (player.occupyingSeat.vehicle as unknown as Vehicle) === vehicle
			|| (player.getSeatOfInterest() !== null && (player.getSeatOfInterest().vehicle as unknown as Vehicle) === vehicle));
		if (!players && vehicle.world !== undefined && vehicle.seats.every((seat) => seat.occupiedBy === null)) this.world.remove(vehicle);
	}

	/**
	 * Somebody made for the job, straight into a seat: the driver's, if it's
	 * free and nothing else is asked for. Undefined if there's nobody to make
	 * yet, or no such seat free.
	 */
	public seatPerson(vehicle: Vehicle, driver: boolean, variant?: number): Character
	{
		let seat: VehicleSeat = vehicle.seats.find((candidate) => candidate.occupiedBy === null
			&& (driver ? candidate.type === SeatType.Driver : candidate.type === SeatType.Passenger));
		if (seat === undefined) return undefined;
		let person = this.addPerson(vehicle.position.clone().add(new THREE.Vector3(0, 1.5, 0)), undefined, variant);
		if (person === undefined) return undefined;
		person.teleportToVehicle(vehicle, seat);
		return person;
	}

	/** Lets go of a person without removing them: they stay in the world as scenery, for someone else to clear. */
	public releasePerson(person: Character): void
	{
		let i = this.people.indexOf(person);
		if (i >= 0) this.people.splice(i, 1);
	}

	// Where things are

	public playerPosition(): THREE.Vector3
	{
		let character = this.world.localCharacter;
		return character !== undefined ? character.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
	}

	/** The car or bike the player is driving, if they are. */
	public drivenVehicle(): Vehicle
	{
		let character = this.world.localCharacter;
		if (character === undefined || character.controlledObject === undefined) return undefined;
		let vehicle = character.controlledObject as unknown as Vehicle;
		return vehicle.entityType === EntityType.Car ? vehicle : undefined;
	}

	/**
	 * A spot on the pavement somewhere between two distances from a point,
	 * in the city rather than on the island, and not over water.
	 */
	public pavementSpot(from: THREE.Vector3, min: number, max: number, zones?: string[]): { position: THREE.Vector3, facing: THREE.Vector3 }
	{
		let candidates = this.city.spawnSpots.filter((spot) =>
		{
			let d = Math.hypot(spot.position.x - from.x, spot.position.z - from.z);
			if (d < min || d > max || !City.onLand(spot.position.x, spot.position.z)) return false;
			if (zones === undefined) return true;
			let block = this.city.plan.blocks.find((b) => spot.position.x >= b.minX - 0.5 && spot.position.x <= b.maxX + 0.5
				&& spot.position.z >= b.minZ - 0.5 && spot.position.z <= b.maxZ + 0.5);
			return block !== undefined && zones.indexOf(block.zone) >= 0;
		});
		if (candidates.length === 0) return undefined;
		let spot = candidates[Math.floor(Math.random() * candidates.length)];
		return { position: spot.position.clone(), facing: spot.facing.clone() };
	}

	/** Out from the pavement to the kerbside lane, where a car stops for someone on it. */
	public kerbside(spot: { position: THREE.Vector3, facing: THREE.Vector3 }): THREE.Vector3
	{
		let block = this.city.plan.blocks.find((b) => spot.position.x >= b.minX - 0.5 && spot.position.x <= b.maxX + 0.5
			&& spot.position.z >= b.minZ - 0.5 && spot.position.z <= b.maxZ + 0.5);
		let out = new THREE.Vector3(-spot.facing.z, 0, spot.facing.x);
		if (block !== undefined)
		{
			let toMiddle = new THREE.Vector3((block.minX + block.maxX) / 2 - spot.position.x, 0, (block.minZ + block.maxZ) / 2 - spot.position.z);
			if (out.dot(toMiddle) > 0) out.negate();
		}
		return spot.position.clone().addScaledVector(out.normalize(), 3.4).setY(spot.position.y - 0.15);
	}
}
