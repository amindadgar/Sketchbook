import * as THREE from 'three';

import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';

interface Effect
{
	object: THREE.Object3D;
	life: number;
	total: number;
	/** Metres a second the puff drifts upward, for smoke. */
	rise: number;
	/** How much the puff grows over its life, 0 for things that hold their size. */
	spread: number;
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

	/** A puff of exhaust smoke, drifting up and thinning as it goes. */
	public addSmoke(position: THREE.Vector3, scale: number, darkness: number): void
	{
		let sprite = new THREE.Sprite(new THREE.SpriteMaterial({
			map: Effects.getSmokeTexture(),
			color: new THREE.Color(darkness, darkness, darkness),
			transparent: true,
			depthWrite: false,
			opacity: 0.85
		}));

		sprite.position.copy(position);
		sprite.scale.setScalar(scale);

		// Rises and thins, but slowly enough to stay legible against the bright
		// concrete this world is mostly made of
		this.add(sprite, 1.8, 1.0, scale * 0.9);
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

			// Lights carry their brightness in a different property to everything else
			if (object.isPointLight === true) object.intensity = object.userData.peak * remaining;
			else if (object.material !== undefined) object.material.opacity = object.userData.peak * remaining;
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
