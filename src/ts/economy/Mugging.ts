import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Pedestrian } from '../npc/Pedestrian';

/**
 * Holding people up in the street, whenever, job or no job.
 *
 * Aim a gun at somebody on the pavement from close by and keep it on them:
 * they stop with the gun on them, and after a moment they drop what they're
 * carrying and run. Everybody carries something, a few carry a lot, and
 * nobody can be robbed twice. Looking away lets them go.
 */
export class Mugging implements IUpdatable
{
	public updateOrder: number = 22;

	/** Near enough to be threatening. */
	private static readonly REACH: number = 11;
	/** How long the gun has to stay on them. */
	private static readonly HOLD: number = 1.3;

	private world: World;
	private target: Pedestrian;
	private held: number = 0;
	private robbed: Set<number> = new Set();
	private announced: boolean = false;
	private prompt: HTMLElement;
	private external: number;

	constructor(world: World)
	{
		this.world = world;
		world.registerUpdatable(this);
	}

	/** A job holding somebody up of its own shows how far along it is on the same ring, for this frame. */
	public showHoldUp(fraction: number): void
	{
		this.external = fraction;
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		let external = this.external;
		this.external = undefined;

		let pedestrian = this.aimedAt();
		if (pedestrian === undefined || pedestrian !== this.target)
		{
			this.target = pedestrian;
			this.held = 0;
			this.announced = false;
			this.showProgress(external);
			if (pedestrian === undefined) return;
		}

		this.world.npcs.holdUp(pedestrian);
		this.held += timeStep;
		if (!this.announced && this.held > 0.25)
		{
			this.announced = true;
			this.world.notices.say('Hands up!', undefined, 'keep the gun on them');
		}
		this.showProgress(Math.min(1, this.held / Mugging.HOLD));
		if (this.held < Mugging.HOLD) return;

		// A few carry a lot more than the rest
		let amount = Math.random() < 0.08 ? 180 + Math.random() * 260 : 20 + Math.random() * 100;
		let character = this.world.localCharacter;
		let from = character.getWorldPosition(new THREE.Vector3());
		let at = pedestrian.position.clone();
		// At their feet, toward the player
		at.add(new THREE.Vector3(from.x - at.x, 0, from.z - at.z).setLength(0.5));
		at.y = pedestrian.position.y + 0.1;
		this.world.cashDrops.drop(at, amount, 'held up');
		this.world.npcs.scare(pedestrian, from);
		this.world.progress.addMugging();
		this.robbed.add(pedestrian.id);
		this.target = undefined;
		this.held = 0;
		this.showProgress(undefined);
	}

	/** Who's under the crosshair, if a gun's up and they can still be robbed. */
	private aimedAt(): Pedestrian
	{
		let character = this.world.localCharacter;
		let npcs = this.world.npcs;
		if (npcs === undefined || character === undefined || character.health <= 0) return undefined;
		if (character.weapon === undefined || character.isBusyWithVehicle() || !this.world.combat.isAiming) return undefined;

		let camera = this.world.camera;
		let from = camera.getWorldPosition(new THREE.Vector3());
		let forward = camera.getWorldDirection(new THREE.Vector3());
		let hit = npcs.rayHitsPedestrian(from, forward, 60);
		if (hit === undefined) return undefined;
		let pedestrian = hit.pedestrian;
		if (!pedestrian.alive || pedestrian.state === 'flee' || this.robbed.has(pedestrian.id)) return undefined;

		let here = character.getWorldPosition(new THREE.Vector3());
		if (here.distanceTo(pedestrian.position) > Mugging.REACH) return undefined;
		return pedestrian;
	}

	/** A ring filling round the crosshair while they hand it over. */
	private showProgress(fraction: number): void
	{
		if (this.prompt === undefined) this.prompt = document.getElementById('holdup-ring');
		if (this.prompt === null) return;
		if (fraction === undefined)
		{
			this.prompt.style.display = 'none';
			return;
		}
		this.prompt.style.display = '';
		this.prompt.style.setProperty('--fill', String(Math.round(fraction * 100)));
	}
}
