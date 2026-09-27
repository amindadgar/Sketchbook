import * as THREE from 'three';
import { Job } from './Job';
import { JobSystem } from './JobSystem';
import { Gunman, Runner, Walker } from './JobAI';
import { Character } from '../characters/Character';
import { Blip } from '../core/Minimap';

type MarkState = 'strolling' | 'held' | 'running' | 'done';

interface Mark
{
	person: Character;
	blip: Blip;
	state: MarkState;
	/** What they carry. */
	wallet: number;
	/** Some of them don't hand it over quietly. */
	armed: boolean;
	/** How long a gun's been held on them, this time. */
	held: number;
	walker: Walker;
	/** Where they stroll about. */
	home: THREE.Vector3;
}

/**
 * Three well-off people out on the town, marked on the map, and their money.
 *
 * Get behind one on foot and E lifts their wallet without a word, most of
 * the time: get caught and they run. Or hold them up: keep a gun on them from
 * close by and they drop it and run. Shooting them works too, but only half
 * of it survives, and it's a lot louder. Some carry a gun of their own and use
 * it once they've been robbed. Done when all three have been dealt with,
 * with a bonus for a job done without a body.
 */
export class StickUpJob extends Job
{
	public readonly id: string = 'stickup';
	public readonly title: string = 'Stick-ups';
	public readonly description: string = 'Rob three well-off marks: lift their wallets from behind, or hold them up at gunpoint. Some fight back.';
	public readonly pays: string = '$300 - $1,100';

	private static readonly COLOR: string = '#f5c542';
	private static readonly MARKS: number = 3;
	private static readonly TIME: number = 360;
	/** Close enough to put your hand in their pocket. */
	private static readonly REACH: number = 1.5;
	private static readonly HOLD_RANGE: number = 10;
	private static readonly HOLD_TIME: number = 1.5;

	private marks: Mark[] = [];
	private timeLeft: number = 0;
	private robbed: number = 0;
	private killed: number = 0;
	private waiting: number = 0;

	constructor(system: JobSystem)
	{
		super(system);
	}

	public start(): string
	{
		this.marks = [];
		this.robbed = 0;
		this.killed = 0;
		this.timeLeft = StickUpJob.TIME;
		this.waiting = 0;
		return undefined;
	}

	public update(timeStep: number): void
	{
		// The people are made as soon as their bodies are there to be made from
		if (this.marks.length < StickUpJob.MARKS)
		{
			this.placeMarks();
			this.waiting += timeStep;
			if (this.marks.length === 0)
			{
				this.system.setHud('Finding marks', undefined);
				if (this.waiting > 20) this.system.fail('nobody worth robbing is out');
				return;
			}
		}

		this.timeLeft -= timeStep;
		for (const mark of this.marks) this.updateMark(mark, timeStep);

		let left = this.marks.filter((mark) => mark.state !== 'done').length;
		if (left === 0 && this.marks.length === StickUpJob.MARKS)
		{
			this.wrapUp();
			return;
		}
		if (this.timeLeft <= 0)
		{
			if (this.robbed > 0) this.wrapUp();
			else this.system.fail('the marks went home');
			return;
		}

		let hint = this.world.combat.isAiming ? 'keep the gun on them' : 'lift a wallet from behind, or hold them up';
		this.system.setHud('Rob the marks', (StickUpJob.MARKS - left) + ' of ' + StickUpJob.MARKS + ' done, ' + hint, this.timeLeft);
	}

	public cleanup(): void
	{
		for (const mark of this.marks) this.removeBlip(mark);
		this.marks = [];
	}

	// The marks

	private placeMarks(): void
	{
		let from = this.system.playerPosition();
		let spot = this.system.pavementSpot(from, 80, 420, ['downtown', 'midtown', 'plaza']);
		if (spot === undefined) spot = this.system.pavementSpot(from, 80, 420);
		if (spot === undefined) return;
		// Not on top of another one
		if (this.marks.some((mark) => mark.home.distanceTo(spot.position) < 60)) return;

		let person = this.system.addPerson(spot.position, spot.facing);
		if (person === undefined) return;
		let blip: Blip = { position: spot.position.clone(), color: StickUpJob.COLOR, label: 'Mark', pin: true, shape: 'diamond' };
		this.world.blips.push(blip);
		let mark: Mark = {
			person: person, blip: blip, state: 'strolling', held: 0, walker: undefined,
			wallet: Math.round(Math.random() < 0.2 ? 300 + Math.random() * 150 : 110 + Math.random() * 170),
			armed: Math.random() < 0.3,
			home: spot.position.clone()
		};
		this.stroll(mark);
		this.marks.push(mark);
	}

	/** Up and down their bit of pavement, not in a hurry. */
	private stroll(mark: Mark): void
	{
		let spot = this.system.pavementSpot(mark.home, 8, 30);
		let goal = spot !== undefined ? spot.position : mark.home;
		mark.walker = new Walker(goal, false);
		this.system.setMind(mark.person, mark.walker);
	}

	private updateMark(mark: Mark, timeStep: number): void
	{
		let person = mark.person;
		if (mark.state === 'done') return;
		let here = person.getWorldPosition(new THREE.Vector3());
		mark.blip.position.copy(here);

		// Shot: half of it's still in one piece
		if (person.health <= 0)
		{
			this.killed++;
			this.world.cashDrops.drop(here.clone().setY(here.y - 0.55), Math.round(mark.wallet / 2), 'off a body', 60, () => this.pickedUp(mark.wallet / 2));
			this.finishWith(mark);
			return;
		}

		if (mark.state === 'strolling' && mark.walker !== undefined && mark.walker.arrived) this.stroll(mark);

		// Running for it and far enough away: gone
		let player = this.world.localCharacter;
		let from = player.getWorldPosition(new THREE.Vector3());
		let distance = here.distanceTo(from);
		if (mark.state === 'running' && distance > 90)
		{
			this.world.notices.say('A mark got away', 'bad');
			this.finishWith(mark);
			return;
		}

		// At gunpoint
		if (this.aimedAt(person, distance))
		{
			if (mark.state !== 'held')
			{
				mark.state = 'held';
				mark.held = 0;
				this.system.setMind(person, new Walker(here, false));
			}
			person.setOrientation(from.clone().sub(here).setY(0).normalize());
			mark.held += timeStep;
			this.world.mugging.showHoldUp(Math.min(1, mark.held / StickUpJob.HOLD_TIME));
			if (mark.held >= StickUpJob.HOLD_TIME) this.handOver(mark, here, from);
			return;
		}
		if (mark.state === 'held')
		{
			// Let go of too soon: they're off
			this.flee(mark);
			return;
		}

		// A hand in the pocket, from behind and on foot
		if (!player.isBusyWithVehicle() && !this.world.combat.isAiming && distance < StickUpJob.REACH && mark.state === 'strolling')
		{
			let facing = new THREE.Vector3(0, 0, 1).applyQuaternion(person.quaternion).setY(0).normalize();
			let toPlayer = from.clone().sub(here).setY(0).normalize();
			if (facing.dot(toPlayer) < -0.2)
			{
				this.world.interactions.offer({ text: 'Lift their wallet', action: () => this.pickpocket(mark), priority: 3 });
			}
		}
	}

	private pickpocket(mark: Mark): void
	{
		if (mark.state !== 'strolling') return;
		// Harder at a run
		let player = this.world.localCharacter;
		let velocity = player.characterCapsule.body.velocity;
		let chance = Math.hypot(velocity.x, velocity.z) > 2.5 ? 0.45 : 0.78;
		if (Math.random() < chance)
		{
			this.robbed++;
			this.system.pay(mark.wallet, 'lifted a wallet');
			this.finishWith(mark);
			// Walks on none the wiser
			this.stroll(mark);
			return;
		}
		this.world.notices.say('Caught!', 'bad', 'they felt that');
		this.flee(mark);
	}

	private handOver(mark: Mark, here: THREE.Vector3, from: THREE.Vector3): void
	{
		this.robbed++;
		let at = here.clone().add(from.clone().sub(here).setY(0).setLength(0.6));
		at.y = here.y - 0.55;
		this.world.cashDrops.drop(at, mark.wallet, 'held up', 90, () => this.pickedUp(mark.wallet));
		this.world.notices.say('They dropped it', 'good', 'pick it up');
		if (mark.armed) this.fightBack(mark);
		else this.flee(mark, true);
		this.finishWith(mark);
	}

	/** Experience for money off the floor, which the wallet has already counted. */
	private pickedUp(amount: number): void
	{
		this.world.progress.addJob(this.id, Math.round(10 + amount / 12));
	}

	/** Running, and marked as running away unless they've already been dealt with. */
	private flee(mark: Mark, robbed: boolean = false): void
	{
		if (mark.armed && !robbed)
		{
			this.fightBack(mark);
			return;
		}
		this.system.setMind(mark.person, new Runner(this.world));
		if (!robbed) mark.state = 'running';
	}

	/** Out comes a gun of their own. */
	private fightBack(mark: Mark): void
	{
		let gunman = new Gunman(this.world, { weapon: 'handgun', accuracy: 0.35, damageScale: 0.4, hostile: true, leash: 40 });
		this.system.setMind(mark.person, gunman);
		gunman.arm();
		this.world.notices.say('This one\'s armed', 'bad');
		if (mark.state !== 'done') mark.state = 'running';
	}

	private finishWith(mark: Mark): void
	{
		mark.state = 'done';
		this.removeBlip(mark);
		// Left in the city until the job's over, then tidied away with the rest
	}

	private wrapUp(): void
	{
		if (this.robbed > 0 && this.killed === 0) this.system.pay(100, 'nobody got hurt');
		this.system.finish(this.robbed + ' robbed');
	}

	private removeBlip(mark: Mark): void
	{
		let i = this.world.blips.indexOf(mark.blip);
		if (i >= 0) this.world.blips.splice(i, 1);
	}

	/** Whether the player's gun is up and the crosshair is on this person, near enough to count. */
	private aimedAt(person: Character, distance: number): boolean
	{
		if (!this.world.combat.isAiming || distance > StickUpJob.HOLD_RANGE) return false;
		let camera = this.world.camera;
		let origin = camera.getWorldPosition(new THREE.Vector3());
		let direction = camera.getWorldDirection(new THREE.Vector3());
		return StickUpJob.rayHits(origin, direction, person.getWorldPosition(new THREE.Vector3()));
	}

	/** Ray against an upright cylinder where somebody stands, as the guns test it. */
	private static rayHits(origin: THREE.Vector3, direction: THREE.Vector3, at: THREE.Vector3): boolean
	{
		const radius = 0.5;
		let dx = origin.x - at.x;
		let dz = origin.z - at.z;
		let a = direction.x * direction.x + direction.z * direction.z;
		if (a < 0.000001) return false;
		let b = 2 * (dx * direction.x + dz * direction.z);
		let c = dx * dx + dz * dz - radius * radius;
		let discriminant = b * b - 4 * a * c;
		if (discriminant < 0) return false;
		let root = Math.sqrt(discriminant);
		let t = (-b - root) / (2 * a);
		if (t < 0) t = (-b + root) / (2 * a);
		if (t < 0) return false;
		let y = origin.y + direction.y * t;
		return y > at.y - 0.75 && y < at.y + 0.85;
	}
}
