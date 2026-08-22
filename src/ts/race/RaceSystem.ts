import * as THREE from 'three';

import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Scenario } from '../world/Scenario';
import { PathNode } from '../world/PathNode';
import { FollowPath } from '../characters/character_ai/FollowPath';
import { UIManager } from '../core/UIManager';
import { Account } from '../party/Account';
import { NetworkClient } from '../party/NetworkClient';

/** Where a racer has got to: which lap, and how far round it. */
interface Progress
{
	lap: number;
	gate: number;
	local: boolean;
}

/**
 * Laps, times and running order for the race scenarios.
 *
 * The world file has shipped the tracks all along: each race parks a grid of
 * cars and points the computer drivers at a ring of path nodes, and the
 * scenario blurbs say outright that there is no lap or position tracking yet.
 * That ring is the track, so it is what the gates are made of, rather than a
 * second set of coordinates written down somewhere that could drift from it.
 */
export class RaceSystem implements IUpdatable
{
	public updateOrder: number = 16;

	private static readonly LAPS: number = 3;
	private static readonly COUNTDOWN: number = 3.2;
	/** How near a gate counts as through it. The drivers use ten for the same ring. */
	private static readonly GATE_RADIUS: number = 11;
	private static readonly BEST_KEY: string = 'sketchbook.bestlap.';

	private static scratch: THREE.Vector3 = new THREE.Vector3();

	private world: World;
	private gates: THREE.Vector3[] = [];
	private marker: THREE.Mesh;

	private track: string;
	private armed: boolean = false;
	private countdown: number = 0;
	private running: boolean = false;

	private lap: number = 0;
	private gate: number = 0;
	private lapTime: number = 0;
	private bestLap: number;
	private totalTime: number = 0;
	private place: number = 1;
	private field: number = 1;

	constructor(world: World)
	{
		this.world = world;
		this.world.registerUpdatable(this);
	}

	/** True while the lights are still on, which is what holds the grid. */
	public get holding(): boolean
	{
		return this.countdown > 0;
	}

	public get active(): boolean
	{
		return this.track !== undefined;
	}

	/** Which circuit is being driven, for the board that goes with it. */
	public get trackId(): string
	{
		return this.track;
	}

	/**
	 * A scenario is a race when it hands a computer driver a path to follow.
	 * Nothing is matched on names, so a new race added to the world file gets
	 * timed without anything here being told about it.
	 */
	public begin(scenario: Scenario): void
	{
		this.stop();

		if (scenario.racePath === undefined) return;

		this.gates = this.readTrack(scenario.racePath);
		if (this.gates.length < 3)
		{
			console.warn('Race scenario ' + scenario.id + ' has no usable path, so it goes untimed.');
			return;
		}

		this.track = scenario.id;
		this.bestLap = this.loadBest();
		this.lap = 1;
		this.gate = 0;
		this.lapTime = 0;
		this.totalTime = 0;
		this.running = false;
		this.countdown = 0;
		this.armed = true;

		this.buildMarker();
		UIManager.setRaceVisible(true);
		this.draw();
	}

	public stop(): void
	{
		if (this.active) this.setFieldPaused(false);

		this.track = undefined;
		this.armed = false;
		this.running = false;
		this.countdown = 0;
		this.gates = [];

		this.disposeMarker();
		UIManager.setRaceVisible(false);
		UIManager.setRaceCountdown(undefined);
		UIManager.setRaceResult(undefined);
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		if (!this.active) return;

		if (this.armed)
		{
			// The scenario briefing holds the world at a standstill while it's on
			// screen, and the grid isn't real until the models arrive
			if (this.world.localCharacter === undefined) return;
			if (this.world.timeScaleTarget < 0.5) return;

			this.armed = false;
			this.countdown = RaceSystem.COUNTDOWN;
		}

		if (this.countdown > 0)
		{
			this.countdown -= unscaledTimeStep;
			this.setFieldPaused(true);
			this.holdGrid();
			UIManager.setRaceCountdown(this.countdown > 0.2 ? String(Math.ceil(this.countdown - 0.2)) : 'GO');

			if (this.countdown <= 0)
			{
				this.setFieldPaused(false);
				this.releaseGrid();
				this.running = true;
				window.setTimeout(() => UIManager.setRaceCountdown(undefined), 700);
			}

			return;
		}

		if (!this.running) return;

		this.lapTime += unscaledTimeStep;
		this.totalTime += unscaledTimeStep;

		this.checkGate();
		this.rank();
		this.draw();
	}

	// ------------------------------------------------------------------ track

	/** Walks the ring of path nodes from the one the drivers are given. */
	private readTrack(firstNode: string): THREE.Vector3[]
	{
		let start = this.findNode(firstNode);
		if (start === undefined) return [];

		let ring: THREE.Vector3[] = [];
		let node = start;

		do
		{
			ring.push(node.object.getWorldPosition(new THREE.Vector3()));
			node = node.nextNode;
		}
		while (node !== undefined && node !== start && ring.length < 200);

		return ring;
	}

	private findNode(name: string): PathNode
	{
		for (const path of this.world.paths)
		{
			for (const key in path.nodes)
			{
				if (!path.nodes.hasOwnProperty(key)) continue;
				if (path.nodes[key].object.name === name) return path.nodes[key];
			}
		}

		return undefined;
	}

	// ------------------------------------------------------------------ gates

	private checkGate(): void
	{
		let character = this.world.localCharacter;
		if (character === undefined) return;

		// The world position, not the local one: a seated character is parented
		// into the car and its own position is an offset from the seat
		let at = character.getWorldPosition(RaceSystem.scratch);
		if (at.distanceTo(this.gates[this.gate]) > RaceSystem.GATE_RADIUS) return;

		this.gate++;

		if (this.gate < this.gates.length)
		{
			this.moveMarker();
			return;
		}

		// Back where it started, so that's a lap
		this.gate = 0;
		this.completeLap();
	}

	private completeLap(): void
	{
		this.world.progress.addLap();

		if (this.bestLap === undefined || this.lapTime < this.bestLap)
		{
			this.bestLap = this.lapTime;
			this.saveBest(this.lapTime);
			this.world.notices.say('Best lap', 'good', RaceSystem.clock(this.lapTime));
		}

		if (this.lap >= RaceSystem.LAPS)
		{
			this.finish();
			return;
		}

		this.lap++;
		this.lapTime = 0;
		this.moveMarker();
	}

	private finish(): void
	{
		this.running = false;
		this.world.progress.addRaceFinish(this.place);

		this.disposeMarker();
		UIManager.setRaceResult(this.place, this.field,
			RaceSystem.clock(this.totalTime), RaceSystem.clock(this.bestLap));
	}

	// ------------------------------------------------------------- the others

	/** Everyone on track, the player and the computer drivers, in running order. */
	private rank(): void
	{
		let order: Progress[] = [{ lap: this.lap, gate: this.gate, local: true }];

		this.eachDriver((driver) =>
		{
			order.push({ lap: driver.lapsDone + 1, gate: this.gateIndexOf(driver.targetNode), local: false });
		});

		order.sort((a, b) => (b.lap * 1000 + b.gate) - (a.lap * 1000 + a.gate));

		this.field = order.length;

		for (let i = 0; i < order.length; i++)
		{
			if (order[i].local) this.place = i + 1;
		}
	}

	private gateIndexOf(node: PathNode): number
	{
		let at = node.object.getWorldPosition(new THREE.Vector3());

		for (let i = 0; i < this.gates.length; i++)
		{
			if (this.gates[i].distanceToSquared(at) < 0.01) return i;
		}

		return 0;
	}

	/**
	 * Holds the grid with the brakes rather than by ignoring the controls.
	 * Swallowing the keys would mean a driver already on the throttle when the
	 * lights went out sat there until they let go and pressed it again.
	 *
	 * The cars update before this does, so whatever the last frame asked the
	 * engine for is overwritten here and never reaches the solver.
	 */
	private holdGrid(): void
	{
		for (const vehicle of this.world.vehicles)
		{
			vehicle.applyEngineForce(0);
			vehicle.setBrake(1000000);
		}
	}

	private releaseGrid(): void
	{
		for (const vehicle of this.world.vehicles)
		{
			vehicle.setBrake(0);
		}
	}

	/** Holds the computer drivers on the grid until the lights go out. */
	private setFieldPaused(paused: boolean): void
	{
		this.eachDriver((driver) => { driver.paused = paused; });
	}

	private eachDriver(visit: (driver: FollowPath) => void): void
	{
		for (const character of this.world.characters)
		{
			let driver = character.behaviour as FollowPath;
			if (driver === undefined || driver.targetNode === undefined) continue;

			visit(driver);
		}
	}

	// ----------------------------------------------------------------- marker

	/**
	 * One ring, moved to whichever gate is next, rather than a fence of thirty
	 * of them. It's there to say which way to go, and the way to go is next.
	 */
	private buildMarker(): void
	{
		let geometry = new THREE.TorusGeometry(2.6, 0.22, 8, 28);
		let material = new THREE.MeshBasicMaterial({
			color: 0xffb900,
			transparent: true,
			opacity: 0.75,
			depthWrite: false
		});

		this.marker = new THREE.Mesh(geometry, material);
		this.marker.rotation.x = Math.PI / 2;
		this.world.graphicsWorld.add(this.marker);
		this.moveMarker();
	}

	private moveMarker(): void
	{
		if (this.marker === undefined) return;

		let at = this.gates[this.gate];
		this.marker.position.set(at.x, at.y + 2.4, at.z);
	}

	private disposeMarker(): void
	{
		if (this.marker === undefined) return;

		this.world.graphicsWorld.remove(this.marker);
		this.marker.geometry.dispose();
		(this.marker.material as THREE.Material).dispose();
		this.marker = undefined;
	}

	// -------------------------------------------------------------------- HUD

	private draw(): void
	{
		UIManager.setRaceHud(
			this.lap, RaceSystem.LAPS,
			this.place, this.field,
			RaceSystem.clock(this.lapTime),
			RaceSystem.clock(this.bestLap));
	}

	public static clock(seconds: number): string
	{
		if (seconds === undefined) return '--:--';

		let whole = Math.floor(seconds);
		let hundredths = Math.floor((seconds - whole) * 100);

		return Math.floor(whole / 60) + ':'
			+ RaceSystem.pad(whole % 60) + '.' + RaceSystem.pad(hundredths);
	}

	private static pad(value: number): string
	{
		return (value < 10 ? '0' : '') + value;
	}

	// --------------------------------------------------------------- the best

	/**
	 * Kept in the browser either way, and sent up to the account as well when
	 * there is one, so a signed out lap still counts for something.
	 */
	private loadBest(): number
	{
		try
		{
			let stored = window.localStorage.getItem(RaceSystem.BEST_KEY + this.track);
			return stored === null ? undefined : Number(stored);
		}
		catch (error)
		{
			return undefined;
		}
	}

	private saveBest(seconds: number): void
	{
		try
		{
			window.localStorage.setItem(RaceSystem.BEST_KEY + this.track, String(seconds));
		}
		catch (error)
		{
			// Private browsing, so the best lap lives as long as the tab does
		}

		if (!Account.signedIn) return;

		Account.submitLap(NetworkClient.loadUrl(), this.track, Math.round(seconds * 1000))
			.catch(() => undefined);
	}
}
