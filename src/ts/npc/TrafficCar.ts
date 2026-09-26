import * as THREE from 'three';
import * as CANNON from 'cannon';
import { Lane } from './Navigation';
import { CollisionGroups } from '../enums/CollisionGroups';
import { SkidMarks } from '../vehicles/SkidMarks';

/**
 * A car in the city's traffic.
 *
 * Driven along the lane graph rather than simulated: a real car per bit of
 * background traffic would cost the physics engine a wheeled vehicle each and
 * drive about as badly as the race drivers do in a city. Instead it follows
 * its lane at a speed worked out from the car in front, the lights, and
 * anyone in the road, carrying a moving body shaped like the car.
 *
 * That body can't be pushed while it's driving. When something is about to
 * hit it, it's knocked: it becomes an ordinary body with the weight of a car,
 * so a hit shoves it, spins it and slides it along on its tyres, and once it
 * has come to rest it pulls back into a lane and drives on. Roll it and it
 * stays where it lies.
 */
export class TrafficCar
{
	public static readonly COLORS: number[] = [0xf2f2f0, 0x1c1d20, 0xa9adb3, 0x5d6168, 0x1f3a66, 0x8c1c1c, 0xcbbd9c, 0x2f4a3a, 0x6b2f4a, 0x3d5f8c];
	/** How far above the road the model's origin sits, from the size of its wheels. */
	private static readonly RIDE: number = 0.36;
	private static readonly WHEEL_RADIUS: number = 0.235;
	/** The same as a player's car, so the two push each other about evenly. */
	public static readonly MASS: number = 50;
	/**
	 * How fast tyres slow a knocked car, per second: rolling along it doesn't
	 * lose much, sliding sideways stops it short, and on its side or roof it
	 * scrapes to a halt whichever way. The physics engine's own friction is
	 * all but off for it, since it takes the full grip at every point touching
	 * the ground, which on four wheels stopped a shoved car almost dead.
	 */
	private static readonly ROLLING: number = 2.4;
	private static readonly SLIDING: number = 13;
	private static readonly SCRAPING: number = 8;
	/** How quickly a car that's pulled back into its lane eases across, per second. */
	private static readonly BLEND_RATE: number = 2.2;
	private static readonly TURNING: number = 3.5;
	private static material: CANNON.Material;

	public id: number;
	public color: number;
	public object: THREE.Object3D;
	public body: CANNON.Body;

	// Driving, on the simulating client
	public lane: Lane;
	public nextLane: Lane;
	public distance: number = 0;
	public speed: number = 0;
	/** Seconds stopped at a junction without lights, before going. */
	public waited: number = 0;
	/** Set after a knock, when it sits there for a bit before driving on. */
	public stunned: number = 0;

	// Knocked about
	/** Free in the physics world rather than driven along its lane. */
	public knocked: boolean = false;
	/** On its side or roof, or nowhere near a lane, so it isn't going anywhere. */
	public wrecked: boolean = false;
	/**
	 * What the client simulating the city says: 0 driving, 1 an upright wreck,
	 * 2 on its roof. Kept apart from wrecked, which this client's own physics
	 * sets and clears while it has the car.
	 */
	public reportedWreck: number = 0;
	/** How long it has been at rest since it was knocked. */
	public still: number = 0;
	/** How long since it was knocked. */
	public knockedFor: number = 0;
	/** Its outline from above, for working out what's about to hit it. */
	public halfWidth: number = 0.61;
	public halfLength: number = 1.21;
	/** Where each tyre meets the road, in the car's own frame, and the ball that stands for it. */
	private tyreSpots: CANNON.Vec3[] = [];
	private tyreBalls: CANNON.Sphere[] = [];
	/** Where it came to rest, drawn eased back into its lane as it pulls away. */
	private blendOffset: THREE.Vector3 = new THREE.Vector3();
	private blendHeading: number = 0;

	// Where it is
	public position: THREE.Vector3 = new THREE.Vector3();
	public heading: number = 0;
	public forward: THREE.Vector3 = new THREE.Vector3(0, 0, 1);

	// Playback on everyone else's client
	public target: THREE.Vector3 = new THREE.Vector3();
	public targetHeading: number = 0;
	public fresh: boolean = true;

	private wheels: THREE.Object3D[] = [];
	private lamps: THREE.Object3D;

	constructor(id: number, color: number, template: THREE.Object3D, lampTexture: THREE.Texture)
	{
		this.id = id;
		this.color = color;
		this.object = template.clone(true);
		this.object.name = 'traffic ' + id;

		let paint = new THREE.Color(TrafficCar.COLORS[color % TrafficCar.COLORS.length]);
		let painted: { [uuid: string]: THREE.Material } = {};
		this.object.traverse((child: any) =>
		{
			let data = child.userData !== undefined ? child.userData.data : undefined;
			if (data === 'collision' || data === 'navmesh' || data === 'seat' || data === 'entry_point') child.visible = false;
			if (data === 'wheel') this.wheels.push(child);
			if (child.isMesh && child.visible)
			{
				child.castShadow = true;
				child.receiveShadow = true;
				let material = child.material;
				if (material !== undefined && material.name === 'Car')
				{
					if (painted[material.uuid] === undefined)
					{
						let copy = new THREE.MeshPhysicalMaterial({
							name: 'Car', map: material.map, color: paint,
							roughness: 0.38, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06
						});
						painted[material.uuid] = copy;
					}
					child.material = painted[material.uuid];
				}
			}
		});

		// Glowing headlamps for after dark
		this.lamps = new THREE.Group();
		for (const side of [-0.52, 0.52])
		{
			let lamp = new THREE.Sprite(new THREE.SpriteMaterial({
				map: lampTexture, color: 0xfff3d0, blending: THREE.AdditiveBlending,
				transparent: true, depthWrite: false, opacity: 0.75
			}));
			lamp.position.set(side, 0.32, 1.32);
			lamp.scale.setScalar(0.45);
			this.lamps.add(lamp);
		}
		this.lamps.visible = false;
		this.object.add(this.lamps);

		this.body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
		// Moved by hand every frame, so never asleep: a sleeping body is skipped
		// by the broadphase against anything else asleep, and cars pass through
		this.body.allowSleep = false;
		this.buildShapes(template);
	}

	/**
	 * The model's own collision boxes, the ones the player's car of the same
	 * model has, and a ball at each wheel for it to stand and slide on once
	 * it's knocked loose, since there are no real wheels under it.
	 */
	private buildShapes(template: THREE.Object3D): void
	{
		let boxes = 0;
		let wheels: THREE.Vector3[] = [];
		template.traverse((child: any) =>
		{
			let data = child.userData !== undefined ? child.userData.data : undefined;
			if (data === 'collision' && child.userData.shape === 'box')
			{
				let box = new CANNON.Box(new CANNON.Vec3(child.scale.x, child.scale.y, child.scale.z));
				box.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
				this.body.addShape(box, new CANNON.Vec3(child.position.x, child.position.y, child.position.z));
				if (boxes++ === 0)
				{
					this.halfWidth = child.scale.x;
					this.halfLength = child.scale.z;
				}
			}
			if (data === 'wheel') wheels.push(child.position.clone());
		});

		if (boxes === 0)
		{
			let box = new CANNON.Box(new CANNON.Vec3(0.6, 0.42, 1.24));
			box.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
			this.body.addShape(box, new CANNON.Vec3(0, 0.3, 0));
		}

		for (const wheel of wheels)
		{
			this.tyreSpots.push(new CANNON.Vec3(wheel.x, -TrafficCar.RIDE, wheel.z));
			let ball = new CANNON.Sphere(TrafficCar.WHEEL_RADIUS);
			this.tyreBalls.push(ball);
			ball.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
			this.body.addShape(ball, new CANNON.Vec3(wheel.x, TrafficCar.WHEEL_RADIUS - TrafficCar.RIDE, wheel.z));
		}

		if (TrafficCar.material === undefined)
		{
			// Next to no grip of its own: the tyres below do the gripping
			TrafficCar.material = new CANNON.Material('trafficCar');
			TrafficCar.material.friction = 0.02;
		}
	}

	/** Lets go of the lane: from now on the physics world moves it. */
	public knock(): void
	{
		if (this.knocked) return;
		this.knocked = true;
		this.wrecked = false;
		this.still = 0;
		this.knockedFor = 0;
		this.blendOffset.set(0, 0, 0);
		this.blendHeading = 0;

		let body = this.body;
		body.type = CANNON.Body.DYNAMIC;
		body.mass = TrafficCar.MASS;
		body.material = TrafficCar.material;
		body.linearDamping = 0.25;
		body.angularDamping = 0.5;
		body.allowSleep = true;
		// Worked out square to the car: cannon measures the shape along the
		// world's axes, which for a car pointing east swaps its length and width
		let turned = body.quaternion.clone();
		body.quaternion.set(0, 0, 0, 1);
		body.updateMassProperties();
		body.quaternion.copy(turned);
		(body as any).updateInertiaWorld(true);
		// Carrying on the way it was going, at the speed it was doing
		body.velocity.set(this.forward.x * this.speed, 0, this.forward.z * this.speed);
		body.angularVelocity.set(0, 0, 0);
		body.previousPosition.copy(body.position);
		(body as any).previousQuaternion.copy(body.quaternion);
		body.interpolatedPosition.copy(body.position);
		body.interpolatedQuaternion.copy(body.quaternion);
		body.aabbNeedsUpdate = true;
		body.preStep = () => this.tyres();
		body.wakeUp();
		this.speed = 0;
	}

	/** Grip, once a physics step, while it's loose. */
	private tyres(): void
	{
		let body = this.body;
		let dt = body.world !== null && body.world !== undefined ? body.world.dt : 1 / 60;
		// Only on the ground: in the air there's nothing to grip
		if (Math.abs(body.velocity.y) > 2.5) return;

		let approach = (value: number, by: number) => value > 0 ? Math.max(0, value - by) : Math.min(0, value + by);
		let v = body.velocity;
		let up = body.quaternion.vmult(new CANNON.Vec3(0, 1, 0));

		if (up.y > 0.8)
		{
			let ahead = body.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
			let length = Math.hypot(ahead.x, ahead.z) || 1;
			let fx = ahead.x / length, fz = ahead.z / length;
			let along = approach(v.x * fx + v.z * fz, TrafficCar.ROLLING * dt);
			let across = approach(v.x * fz - v.z * fx, TrafficCar.SLIDING * dt);
			v.x = fx * along + fz * across;
			v.z = fz * along - fx * across;
			body.angularVelocity.y = approach(body.angularVelocity.y, TrafficCar.TURNING * dt);
		}
		else
		{
			let speed = Math.hypot(v.x, v.z);
			if (speed > 1e-4)
			{
				let scale = Math.max(0, speed - TrafficCar.SCRAPING * dt) / speed;
				v.x *= scale;
				v.z *= scale;
			}
		}
	}

	/** Back on the lane graph, driven again. */
	public unknock(): void
	{
		if (!this.knocked) return;
		this.knocked = false;
		this.wrecked = false;

		let body = this.body;
		body.preStep = null;
		body.type = CANNON.Body.KINEMATIC;
		body.mass = 0;
		body.updateMassProperties();
		body.velocity.set(0, 0, 0);
		body.angularVelocity.set(0, 0, 0);
		body.allowSleep = false;
		body.wakeUp();
		this.speed = 0;
	}

	/** Where the physics world has put it, while it's knocked. */
	public readBody(): void
	{
		let p = this.body.position;
		this.position.set(p.x, p.y - TrafficCar.RIDE, p.z);
		let q = this.body.quaternion;
		let ahead = new CANNON.Vec3(0, 0, 1);
		q.vmult(ahead, ahead);
		if (Math.hypot(ahead.x, ahead.z) > 0.2) this.heading = Math.atan2(ahead.x, ahead.z);
		this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
	}

	/** Rubber on the road from tyres dragged sideways, while it's knocked about. */
	public leaveMarks(marks: SkidMarks): void
	{
		if (!this.knocked || !this.upright || this.body.world === null || this.body.world === undefined) return;
		let body = this.body;

		// Only tyres on the ground, by what the physics found them resting on
		let grounded = new Set<CANNON.Shape>();
		for (const contact of body.world.contacts as any[])
		{
			// The normal points from the first body to the second
			if (contact.bi === body && contact.ni.y < -0.5) grounded.add(contact.si);
			else if (contact.bj === body && contact.ni.y > 0.5) grounded.add(contact.sj);
		}

		let right = body.quaternion.vmult(new CANNON.Vec3(1, 0, 0));
		let up = new THREE.Vector3(0, 1, 0);
		this.tyreSpots.forEach((spot, i) =>
		{
			if (!grounded.has(this.tyreBalls[i])) return;
			let point = body.pointToWorldFrame(spot);
			let velocity = body.getVelocityAtWorldPoint(point, new CANNON.Vec3());
			let sideways = Math.abs(velocity.x * right.x + velocity.z * right.z);
			let strength = THREE.MathUtils.smoothstep(sideways, 1.1, 4.5);
			if (strength < 0.15) return;
			marks.mark(this.object.uuid + i, new THREE.Vector3(point.x, point.y, point.z), up,
				new THREE.Vector3(velocity.x, 0, velocity.z), strength);
		});
	}

	/** Right way up, more or less. */
	public get upright(): boolean
	{
		let up = new CANNON.Vec3(0, 1, 0);
		this.body.quaternion.vmult(up, up);
		return up.y > 0.8;
	}

	/**
	 * Driving on from where it came to rest: the body goes straight to its
	 * lane, and the model is drawn easing across to it.
	 */
	public resumeFrom(rest: THREE.Vector3, restHeading: number): void
	{
		this.blendOffset.set(rest.x - this.position.x, 0, rest.z - this.position.z);
		this.blendHeading = Math.atan2(Math.sin(restHeading - this.heading), Math.cos(restHeading - this.heading));
	}

	public setLights(on: boolean): void
	{
		this.lamps.visible = on;
	}

	/** Places the model and its collider, and turns the wheels. */
	public updateVisual(timeStep: number): void
	{
		if (this.knocked)
		{
			// Wherever the physics has it, tipped however it's tipped
			let p = this.body.interpolatedPosition;
			let q = this.body.interpolatedQuaternion;
			this.object.position.set(p.x, p.y, p.z);
			this.object.quaternion.set(q.x, q.y, q.z, q.w);
			let rolling = this.body.velocity.x * this.forward.x + this.body.velocity.z * this.forward.z;
			for (const wheel of this.wheels) wheel.rotateX((rolling * timeStep) / TrafficCar.WHEEL_RADIUS);
			return;
		}

		// Easing out of wherever a knock left it
		let ease = Math.exp(-timeStep * TrafficCar.BLEND_RATE);
		this.blendOffset.multiplyScalar(ease);
		this.blendHeading *= ease;

		this.object.position.set(this.position.x + this.blendOffset.x, this.position.y + TrafficCar.RIDE, this.position.z + this.blendOffset.z);
		this.object.rotation.set(0, this.heading + this.blendHeading, 0);
		// Reported lying on its roof by whoever simulates it
		if (this.reportedWreck === 2) this.object.rotateZ(Math.PI);

		let spin = (this.speed * timeStep) / TrafficCar.WHEEL_RADIUS;
		for (const wheel of this.wheels) wheel.rotateX(spin);

		this.body.position.set(this.object.position.x, this.object.position.y, this.object.position.z);
		this.body.quaternion.set(this.object.quaternion.x, this.object.quaternion.y, this.object.quaternion.z, this.object.quaternion.w);
		// Moving as it's drawn moving, the easing included, so whatever it
		// touches is pushed aside at that speed rather than overlapped
		this.body.velocity.set(
			this.forward.x * this.speed - TrafficCar.BLEND_RATE * this.blendOffset.x, 0,
			this.forward.z * this.speed - TrafficCar.BLEND_RATE * this.blendOffset.z);
		this.body.aabbNeedsUpdate = true;
	}

	/** Places the car on its lane, pointed along it. */
	public placeOnLane(): void
	{
		let ahead = new THREE.Vector3();
		let behind = new THREE.Vector3();
		this.lane.sample(this.distance, this.position);
		// Heading from a little ahead and behind, so it turns smoothly through bends
		this.sampleAlong(this.distance + 1.1, ahead);
		this.sampleAlong(this.distance - 1.1, behind);
		this.forward.subVectors(ahead, behind).setY(0);
		if (this.forward.lengthSq() > 0.0001)
		{
			this.forward.normalize();
			this.heading = Math.atan2(this.forward.x, this.forward.z);
		}
	}

	private sampleAlong(distance: number, out: THREE.Vector3): void
	{
		if (distance > this.lane.length && this.nextLane !== undefined)
		{
			this.nextLane.sample(distance - this.lane.length, out);
		}
		else this.lane.sample(distance, out);
	}

	public follow(timeStep: number): void
	{
		if (this.fresh)
		{
			this.position.copy(this.target);
			this.heading = this.targetHeading;
			this.fresh = false;
		}
		else
		{
			// Where it was at the last snapshot, carried on at the speed it was
			// doing, and eased toward so a correction never jumps
			this.target.addScaledVector(this.forward, this.speed * timeStep);
			this.position.lerp(this.target, Math.min(1, timeStep * 5));
			let delta = Math.atan2(Math.sin(this.targetHeading - this.heading), Math.cos(this.targetHeading - this.heading));
			this.heading += delta * Math.min(1, timeStep * 8);
		}
		this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
	}
}
