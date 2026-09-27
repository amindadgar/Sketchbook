import * as CANNON from 'cannon';
import * as THREE from 'three';
import { Car } from './Car';
import { Character } from '../characters/Character';

/**
 * Two wheels, driven like a car.
 *
 * Underneath it is one: four raycast wheels set a hand's width apart, which
 * is what keeps the physics sane, and the two wheels you see are turned by
 * hand, the front one on its fork with the steering. What makes it a bike is
 * the lean. Nothing that narrow stays up by itself, so it's held upright the
 * way a rider would, and into a turn it leans over, further the faster it's
 * going. Stopped, it stands as if it had a foot down.
 */
export class Motorbike extends Car
{
	/** Most it leans, radians, at speed with the bars hard over. */
	private static readonly MAX_LEAN: number = 0.5;
	/** How hard it's held at its lean, and how much the wobble is damped. */
	private static readonly STIFFNESS: number = 260;
	private static readonly DAMPING: number = 38;
	private static readonly WHEEL_RADIUS: number = 0.19;

	private frontWheel: THREE.Object3D;
	private rearWheel: THREE.Object3D;
	private fork: THREE.Object3D;
	/** On the fork, where the front wheel's hub is. */
	private axle: THREE.Object3D;
	private forkRest: THREE.Quaternion;
	private frontRest: THREE.Quaternion;
	private rearRest: THREE.Quaternion;
	private spin: number = 0;
	private steer: number = 0;
	/** Where the rider's asking it to go, eased: leaning follows the bars being pushed, not how far the front wheel turns. */
	private leanInput: number = 0;

	constructor(gltf: any)
	{
		// Its wheels are smaller than a car's, and the rays reach the road at their rims
		super(gltf, { radius: Motorbike.WHEEL_RADIUS });

		this.frontWheel = this.getObjectByName('bike_wheel_front');
		this.rearWheel = this.getObjectByName('bike_wheel_rear');
		this.fork = this.getObjectByName('bike_fork');
		this.axle = this.getObjectByName('bike_axle_front');
		if (this.fork !== undefined) this.forkRest = this.fork.quaternion.clone();
		if (this.frontWheel !== undefined) this.frontRest = this.frontWheel.quaternion.clone();
		if (this.rearWheel !== undefined) this.rearRest = this.rearWheel.quaternion.clone();

		// Lighter than a car, so the same engine pulls it harder
		this.collision.mass = 30;
		this.collision.updateMassProperties();

		let carStep = this.collision.preStep;
		this.collision.preStep = (body: CANNON.Body) =>
		{
			carStep.call(body, body);
			this.keepUpright(body);
		};
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		// The wheels you see roll with the road, and the front one steers
		this.spin -= this.speed / Motorbike.WHEEL_RADIUS * timeStep;
		this.spin %= Math.PI * 2;
		let roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.spin);
		if (this.rearWheel !== undefined) this.rearWheel.quaternion.copy(this.rearRest).multiply(roll);

		this.steer = THREE.MathUtils.lerp(this.steer, this.steeringValue() * 0.8, 1 - Math.exp(-12 * timeStep));
		let asked = (this.actions.left.isPressed ? 1 : 0) - (this.actions.right.isPressed ? 1 : 0);
		this.leanInput = THREE.MathUtils.lerp(this.leanInput, asked, 1 - Math.exp(-4 * timeStep));

		if (this.fork !== undefined)
		{
			// About the fork's own axis, which leans back
			this.fork.quaternion.copy(this.forkRest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.steer));
			this.fork.updateMatrix();
			if (this.frontWheel !== undefined)
			{
				// The wheel isn't on the fork, so it's put where the fork's hub is and turned as far
				if (this.axle !== undefined) this.frontWheel.position.copy(this.axle.position).applyMatrix4(this.fork.matrix);
				let turn = this.fork.quaternion.clone().multiply(this.forkRest.clone().invert());
				this.frontWheel.quaternion.copy(turn).multiply(this.frontRest).multiply(roll);
			}
		}
	}

	/**
	 * Legs astride the tank rather than out in front the way a car seat has
	 * them: thighs down and forward, shins back to the pegs. Over whatever the
	 * sitting animation did, every frame someone's on it.
	 */
	public poseRider(rider: Character): void
	{
		let q = this.getWorldQuaternion(new THREE.Quaternion());
		let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
		let up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
		let left = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
		for (const side of ['Left', 'Right'])
		{
			let out = left.clone().multiplyScalar(side === 'Left' ? 1 : -1);
			let thigh = forward.clone().multiplyScalar(0.62).addScaledVector(up, -0.62).addScaledVector(out, 0.28).normalize();
			let shin = forward.clone().multiplyScalar(-0.3).addScaledVector(up, -0.92).addScaledVector(out, 0.12).normalize();
			let foot = forward.clone().multiplyScalar(0.85).addScaledVector(up, -0.4).addScaledVector(out, 0.1).normalize();
			rider.pointBoneAlong('mixamorig' + side + 'UpLeg', thigh);
			rider.pointBoneAlong('mixamorig' + side + 'Leg', shin);
			rider.pointBoneAlong('mixamorig' + side + 'Foot', foot);
		}
	}

	/** One lamp, on the fork. */
	protected lampSpots(): THREE.Vector3[]
	{
		let lamp = this.getObjectByName('headlight');
		return [lamp !== undefined ? lamp.position.clone() : new THREE.Vector3(0, 0.2, 0.37)];
	}

	/**
	 * A roll toward the lean it should have: none standing still, into the
	 * turn at speed. Applied about the bike's own length, so it doesn't fight
	 * the wheels over which way it points.
	 */
	private keepUpright(body: CANNON.Body): void
	{
		let q = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
		let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
		// A vehicle's +x is its left, as it faces +z
		let left = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
		let up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

		// Upside down or on its side in a crash: R puts it back, like a car
		if (up.y < 0.2) return;

		// Left side down is a negative roll, and a left turn wants just that
		let roll = Math.asin(THREE.MathUtils.clamp(left.y, -1, 1));
		let pace = THREE.MathUtils.clamp(Math.abs(this.speed) / 14, 0, 1);
		let lean = -this.leanInput * Motorbike.MAX_LEAN * pace;

		let spinAlong = body.angularVelocity.x * forward.x + body.angularVelocity.y * forward.y + body.angularVelocity.z * forward.z;
		let strength = (Motorbike.STIFFNESS * (lean - roll) - Motorbike.DAMPING * spinAlong) * body.mass / 30;
		body.torque.x += forward.x * strength;
		body.torque.y += forward.y * strength;
		body.torque.z += forward.z * strength;
	}

	/** Where the bars are, from hard left at 1 to hard right at -1, as the physics steers the front wheels. */
	private steeringValue(): number
	{
		let info = this.rayCastVehicle.wheelInfos.find((wheel) => wheel.steering !== 0);
		return info !== undefined ? THREE.MathUtils.clamp(info.steering / 0.8, -1, 1) : 0;
	}
}
