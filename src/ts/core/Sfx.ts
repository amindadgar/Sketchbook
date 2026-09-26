import * as THREE from 'three';

import { World } from '../world/World';

/**
 * Sounds the game makes that nobody had to record.
 *
 * A crash and a burst of nitro are both noise with an envelope on it, which is
 * a strange thing to ship as a file when the browser can build one in a
 * millisecond. Buffers are made once and played through a small pool, so a
 * pile-up doesn't allocate an audio node per impact.
 */
export class Sfx
{
	private world: World;
	private thudBuffer: AudioBuffer;
	private whooshBuffer: AudioBuffer;
	private screechBuffer: AudioBuffer;
	private screechLoading: boolean = false;
	private pool: THREE.PositionalAudio[] = [];
	private cursor: number = 0;
	private flat: THREE.Audio;

	constructor(world: World)
	{
		this.world = world;
	}

	/** @param strength 0 to 1, how hard the hit was. */
	public thud(position: THREE.Vector3, strength: number): void
	{
		if (this.thudBuffer === undefined) this.thudBuffer = this.buildThud();

		let sound = this.take();
		if (sound === undefined) return;

		sound.position.copy(position);
		sound.setBuffer(this.thudBuffer);
		sound.setVolume(0.25 + strength * 0.55);
		sound.setPlaybackRate(1.15 - strength * 0.35);
		sound.play();
		sound.updateMatrixWorld(true);
	}

	public whoosh(): void
	{
		if (this.whooshBuffer === undefined) this.whooshBuffer = this.buildWhoosh();

		if (this.flat === undefined)
		{
			this.flat = new THREE.Audio(this.world.audioListener);
			this.flat.setVolume(0.3);
		}

		if (this.flat.isPlaying) this.flat.stop();

		this.flat.setBuffer(this.whooshBuffer);
		this.flat.play();
	}

	/**
	 * Fetches the recorded sounds, while the world loads. The tyre squeal is a
	 * real car's, cut into a seamless loop; if it can't be had, the one made
	 * here stands in for it.
	 */
	public load(): void
	{
		if (this.world.audioListener === undefined || this.screechLoading) return;
		this.screechLoading = true;

		new THREE.AudioLoader().load('build/assets/tyre_squeal.wav',
			(buffer: AudioBuffer) => this.screechBuffer = buffer,
			undefined,
			() =>
			{
				console.warn('Couldn\'t load the tyre squeal, making one instead.');
				this.screechBuffer = this.buildScreech();
			});
	}

	/** A loop of tyre squeal, for vehicles to play as loud as their tyres are sliding. Undefined until it has loaded. */
	public screech(): AudioBuffer
	{
		return this.screechBuffer;
	}

	private take(): THREE.PositionalAudio
	{
		if (this.pool.length === 0)
		{
			if (this.world.audioListener === undefined) return undefined;

			for (let i = 0; i < 4; i++)
			{
				let sound = new THREE.PositionalAudio(this.world.audioListener);
				sound.setRefDistance(12);
				sound.setRolloffFactor(1.5);
				this.world.graphicsWorld.add(sound);
				this.pool.push(sound);
			}
		}

		let sound = this.pool[this.cursor];
		this.cursor = (this.cursor + 1) % this.pool.length;

		if (sound.isPlaying) sound.stop();
		return sound;
	}

	/** Noise through a falling envelope, with a low tone under it for the weight. */
	private buildThud(): AudioBuffer
	{
		let context = this.world.audioListener.context;
		let length = Math.floor(context.sampleRate * 0.4);
		let buffer = context.createBuffer(1, length, context.sampleRate);
		let samples = buffer.getChannelData(0);

		let rolling = 0;

		for (let i = 0; i < length; i++)
		{
			let t = i / context.sampleRate;
			let decay = Math.exp(-t * 16);

			// A running average of white noise, which is a cheap way to take the
			// hiss off it and leave something that sounds like impact
			rolling = rolling * 0.72 + (Math.random() * 2 - 1) * 0.28;

			samples[i] = (rolling * 1.6 + Math.sin(2 * Math.PI * 70 * t) * 0.5) * decay;
		}

		return buffer;
	}

	/**
	 * Standing in for the recording: a wavering tone a little over a kilohertz
	 * with its overtones, fluttering in strength, roughened with hiss, over a
	 * low scrub of the tyre dragging. Two seconds, looped, with the end faded
	 * into the start so the join doesn't click.
	 */
	private buildScreech(): AudioBuffer
	{
		let context = this.world.audioListener.context;
		let rate = context.sampleRate;
		let length = Math.floor(rate * 2);
		let overlap = Math.floor(rate * 0.12);
		let raw = new Float32Array(length + overlap);

		let phase = 0;
		let rough = 0;
		let scrub = 0;
		for (let i = 0; i < raw.length; i++)
		{
			let t = i / rate;
			// Whole numbers of wobbles in the two seconds, so they meet at the join
			let frequency = 1080 + 80 * Math.sin(2 * Math.PI * 3 * t) + 40 * Math.sin(2 * Math.PI * 7.5 * t + 1.3);
			phase += 2 * Math.PI * frequency / rate;
			let tone = Math.sin(phase) + 0.45 * Math.sin(2 * phase + 0.5) + 0.22 * Math.sin(3 * phase + 1.1);
			let flutter = 0.62 + 0.24 * Math.sin(2 * Math.PI * 11 * t) + 0.14 * Math.sin(2 * Math.PI * 17 * t + 0.7);

			rough = rough * 0.55 + (Math.random() * 2 - 1) * 0.45;
			scrub = scrub * 0.965 + (Math.random() * 2 - 1) * 0.035;

			raw[i] = tone * flutter * 0.3 + rough * flutter * 0.12 + scrub * 2.2;
		}

		let buffer = context.createBuffer(1, length, rate);
		let samples = buffer.getChannelData(0);
		for (let i = 0; i < length; i++)
		{
			if (i < overlap)
			{
				let blend = i / overlap;
				samples[i] = raw[i] * blend + raw[length + i] * (1 - blend);
			}
			else samples[i] = raw[i];
		}
		return buffer;
	}

	/** Noise that opens up and closes again, which is what a boost sounds like. */
	private buildWhoosh(): AudioBuffer
	{
		let context = this.world.audioListener.context;
		let length = Math.floor(context.sampleRate * 0.7);
		let buffer = context.createBuffer(1, length, context.sampleRate);
		let samples = buffer.getChannelData(0);

		let rolling = 0;

		for (let i = 0; i < length; i++)
		{
			let t = i / context.sampleRate;
			let shape = Math.sin(Math.PI * Math.min(1, t / 0.7));

			// The smoothing eases off over the burst, so it brightens as it swells
			let smooth = 0.86 - shape * 0.35;
			rolling = rolling * smooth + (Math.random() * 2 - 1) * (1 - smooth);

			samples[i] = rolling * shape * 2.2;
		}

		return buffer;
	}
}
