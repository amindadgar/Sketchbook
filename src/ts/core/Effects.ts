import * as THREE from 'three';

import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { DeviceProfile } from './DeviceProfile';

interface Effect
{
	object: THREE.Object3D;
	life: number;
	total: number;
	/** Metres a second the puff drifts upward, for smoke. */
	rise: number;
	/** How much the puff grows over its life, 0 for things that hold their size. */
	spread: number;
	/** Smoke: thinned out as it fills more of the view, so it's seen rather than seen through. */
	smoke?: boolean;
}

/**
 * Short lived visuals: muzzle flashes, tracers, smoke.
 *
 * They all want the same thing, to appear, fade over a fraction of a second and
 * take themselves away again, so they share one list rather than each system
 * keeping its own and its own disposal.
 */
export class Effects implements IUpdatable
{
	public updateOrder: number = 15;

	private static smokeTexture: THREE.Texture;
	/**
	 * How much of the view a puff may fill, as its width over its distance,
	 * before it starts to thin, and where it's gone. Smoke drifts behind a car
	 * and the chase camera drives straight through it: without this the screen
	 * filled with it. A phone's smaller screen has less to spare.
	 */
	private static readonly SMOKE_COVER_FULL: number = DeviceProfile.isTouch() ? 0.14 : 0.2;
	private static readonly SMOKE_COVER_GONE: number = DeviceProfile.isTouch() ? 0.38 : 0.5;
	/** Puffs in the air at once, however many battered cars there are. */
	private static readonly SMOKE_LIMIT: number = DeviceProfile.isTouch() ? 10 : 18;
	private smokeCount: number = 0;

	private world: World;
	private live: Effect[] = [];

	constructor(world: World)
	{
		this.world = world;
		this.world.registerUpdatable(this);
	}

	public add(object: THREE.Object3D, life: number, rise: number = 0, spread: number = 0): void
	{
		// Whatever it starts at is what it fades from, so callers set the look and
		// nothing here needs to know what a muzzle flash is supposed to look like
		let any = object as any;
		any.userData.peak = any.isPointLight === true ? any.intensity
			: (any.material !== undefined ? any.material.opacity : 1);

		this.world.graphicsWorld.add(object);
		this.live.push({ object: object, life: life, total: life, rise: rise, spread: spread });
	}

	/** A puff of smoke from a battered engine, drifting up and thinning as it goes. */
	public addSmoke(position: THREE.Vector3, scale: number, darkness: number): void
	{
		if (this.smokeCount >= Effects.SMOKE_LIMIT) return;

		let sprite = new THREE.Sprite(new THREE.SpriteMaterial({
			map: Effects.getSmokeTexture(),
			color: new THREE.Color(darkness, darkness, darkness),
			transparent: true,
			depthWrite: false,
			opacity: DeviceProfile.isTouch() ? 0.42 : 0.5
		}));

		sprite.position.copy(position);
		sprite.scale.setScalar(scale);

		// Rises and thins, enough to read against the bright concrete this
		// world is mostly made of, not so much that it hides the road
		this.add(sprite, 1.5, 1.0, scale * 0.6);
		this.live[this.live.length - 1].smoke = true;
		this.smokeCount++;
	}

	/** A short lick of flame, for whatever is burning fuel to go faster. */
	public addFlame(position: THREE.Vector3, scale: number): void
	{
		let sprite = new THREE.Sprite(new THREE.SpriteMaterial({
			map: Effects.getSmokeTexture(),
			color: new THREE.Color(1, 0.55, 0.12),
			blending: THREE.AdditiveBlending,
			transparent: true,
			depthWrite: false,
			opacity: 0.9
		}));

		sprite.position.copy(position);
		sprite.scale.setScalar(scale);

		this.add(sprite, 0.28, 0.4, scale * 1.6);
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		let eye = this.world.camera.position;

		for (let i = this.live.length - 1; i >= 0; i--)
		{
			let effect = this.live[i];
			effect.life -= unscaledTimeStep;

			if (effect.life <= 0)
			{
				this.world.graphicsWorld.remove(effect.object);

				let mesh = effect.object as any;
				if (mesh.geometry !== undefined) mesh.geometry.dispose();
				if (mesh.material !== undefined) mesh.material.dispose();

				if (effect.smoke) this.smokeCount--;
				this.live.splice(i, 1);
				continue;
			}

			let remaining = effect.life / effect.total;
			let object = effect.object as any;

			if (effect.rise !== 0) effect.object.position.y += effect.rise * unscaledTimeStep;
			if (effect.spread !== 0)
			{
				effect.object.scale.setScalar(effect.object.scale.x + effect.spread * unscaledTimeStep);
			}

			// Smoke close enough to fill the view thins out, so driving through
			// what the car left behind doesn't blind whoever's at the wheel
			let clear = 1;
			if (effect.smoke)
			{
				let cover = effect.object.scale.x / Math.max(0.05, effect.object.position.distanceTo(eye));
				clear = THREE.MathUtils.clamp((Effects.SMOKE_COVER_GONE - cover) / (Effects.SMOKE_COVER_GONE - Effects.SMOKE_COVER_FULL), 0, 1);
			}

			// Lights carry their brightness in a different property to everything else
			if (object.isPointLight === true) object.intensity = object.userData.peak * remaining;
			else if (object.material !== undefined) object.material.opacity = object.userData.peak * remaining * clear;
		}
	}

	private static getSmokeTexture(): THREE.Texture
	{
		if (Effects.smokeTexture !== undefined) return Effects.smokeTexture;

		let canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 64;

		let context = canvas.getContext('2d');
		let gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0.0, 'rgba(255, 255, 255, 0.9)');
		gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.45)');
		gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0)');

		context.fillStyle = gradient;
		context.fillRect(0, 0, 64, 64);

		Effects.smokeTexture = new THREE.CanvasTexture(canvas);
		return Effects.smokeTexture;
	}
}
