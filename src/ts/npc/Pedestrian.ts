import * as THREE from 'three';
import * as CANNON from 'cannon';
import { Route, Crossing } from './Navigation';
import { CollisionGroups } from '../enums/CollisionGroups';

export type PedestrianState = 'walk' | 'wait' | 'idle' | 'flee' | 'dead';

/** The animation set a pedestrian uses, built once per body type. */
export interface PedestrianClips
{
	idle: THREE.AnimationClip;
	walk: THREE.AnimationClip;
	run: THREE.AnimationClip;
}

/**
 * Someone walking the pavements.
 *
 * On whichever client simulates the city, a pedestrian walks the loop of
 * pavement round a block, sometimes stops, sometimes crosses at the lights to
 * the next block, runs from gunfire and falls when shot or run over. Everyone
 * else is shown where they are and what they're doing, a few times a second.
 *
 * There's no skeleton physics: the body is a skinned mesh walked along a
 * route, with a small sphere in the physics world so a player can't walk
 * straight through them.
 */
export class Pedestrian
{
	public static readonly WALK_SPEED: number = 0.78;
	public static readonly RUN_SPEED: number = 3.1;
	/** The walk clip covers this much ground per second at normal speed. */
	private static readonly WALK_STRIDE: number = 0.74;
	public static readonly COLLISION_GROUP: number = CollisionGroups.Pedestrians;

	public id: number;
	public variant: number;
	public object: THREE.Group;
	public model: THREE.Object3D;
	public body: CANNON.Body;
	public health: number = 25;
	public state: PedestrianState = 'walk';

	// Movement, on the simulating client
	public route: Route;
	public distance: number = 0;
	public direction: number = 1;
	public speed: number = Pedestrian.WALK_SPEED;
	public timer: number = 0;
	public fleeFrom: THREE.Vector3 = new THREE.Vector3();
	public pendingCrossing: Crossing;
	public lastCorner: number = -1;

	// Where it is, whichever client is simulating
	public position: THREE.Vector3 = new THREE.Vector3();
	public heading: number = 0;

	// Playback from snapshots, on everyone else's
	public target: THREE.Vector3 = new THREE.Vector3();
	public targetHeading: number = 0;
	public fresh: boolean = true;

	private mixer: THREE.AnimationMixer;
	private actions: { [name: string]: THREE.AnimationAction } = {};
	private current: string;
	private fall: number = 0;
	private animationSkip: number = 0;

	constructor(id: number, variant: number, model: THREE.Object3D, clips: PedestrianClips)
	{
		this.id = id;
		this.variant = variant;
		this.object = new THREE.Group();
		this.object.name = 'pedestrian ' + id;
		this.model = model;
		this.object.add(model);
		model.traverse((child: any) =>
		{
			if (child.isMesh)
			{
				child.castShadow = true;
				child.receiveShadow = true;
				// Bounds that hold the body whatever the animation does with it,
				// rather than working them out from bones every frame
				child.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.3);
				this.meshes.push(child);
			}
		});

		this.mixer = new THREE.AnimationMixer(model);
		this.actions.idle = this.mixer.clipAction(clips.idle);
		this.actions.walk = this.mixer.clipAction(clips.walk);
		this.actions.run = this.mixer.clipAction(clips.run);
		// Everyone out of step with everyone else
		this.actions.walk.time = Math.random() * clips.walk.duration;
		this.play('walk', 0);

		this.body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
		let sphere = new CANNON.Sphere(0.26);
		sphere.collisionFilterGroup = Pedestrian.COLLISION_GROUP;
		sphere.collisionFilterMask = CollisionGroups.Characters;
		this.body.addShape(sphere);
		this.body.collisionFilterGroup = Pedestrian.COLLISION_GROUP;
		this.body.collisionFilterMask = CollisionGroups.Characters;
	}

	public get alive(): boolean
	{
		return this.state !== 'dead';
	}

	private play(name: string, fade: number = 0.25): void
	{
		if (this.current === name) return;
		let next = this.actions[name];
		next.enabled = true;
		next.setEffectiveWeight(1);
		next.play();
		if (this.current !== undefined && fade > 0) next.crossFadeFrom(this.actions[this.current], fade, false);
		else if (this.current !== undefined) this.actions[this.current].stop();
		this.current = name;
	}

	/** Pose, place and animate, from wherever the position came from. */
	public updateVisual(timeStep: number, cameraDistance: number): void
	{
		// Shadows only close up, and nobody drawn past where they'd be a few pixels
		this.object.visible = cameraDistance < 120;
		let shadows = cameraDistance < 45;
		if (shadows !== this.meshes[0]?.castShadow) this.meshes.forEach((mesh) => mesh.castShadow = shadows);

		this.object.position.copy(this.position);
		this.object.rotation.y = this.heading;

		switch (this.state)
		{
			case 'walk':
				this.play('walk');
				this.actions.walk.timeScale = this.speed / Pedestrian.WALK_STRIDE;
				break;
			case 'flee':
				this.play('run');
				this.actions.run.timeScale = 1.1;
				break;
			default:
				this.play('idle');
		}

		// Falling over when dead: tipped backwards about the feet
		let fallen = this.state === 'dead' ? 1 : 0;
		this.fall += (fallen - this.fall) * Math.min(1, timeStep * 6);
		this.model.rotation.x = -this.fall * Math.PI / 2;
		this.model.position.y = this.fall * 0.12;

		// Far away, the animation doesn't need every frame
		let every = cameraDistance > 70 ? 4 : cameraDistance > 35 ? 2 : 1;
		this.animationSkip += timeStep;
		if (--this.skipCounter <= 0 && this.state !== 'dead')
		{
			this.mixer.update(this.animationSkip);
			this.animationSkip = 0;
			this.skipCounter = every;
		}

		this.body.position.set(this.position.x, this.position.y + 0.55, this.position.z);
		this.body.aabbNeedsUpdate = true;
	}

	private skipCounter: number = 0;
	private meshes: THREE.Mesh[] = [];

	/** Eases toward a position from a snapshot, for clients that don't simulate. */
	public follow(timeStep: number): void
	{
		if (this.fresh)
		{
			this.position.copy(this.target);
			this.heading = this.targetHeading;
			this.fresh = false;
			return;
		}
		let rate = Math.min(1, timeStep * 6);
		this.position.lerp(this.target, rate);
		let delta = Math.atan2(Math.sin(this.targetHeading - this.heading), Math.cos(this.targetHeading - this.heading));
		this.heading += delta * rate;
	}

	public dispose(): void
	{
		this.mixer.stopAllAction();
		this.mixer.uncacheRoot(this.model);
	}
}
