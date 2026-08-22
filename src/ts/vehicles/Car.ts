import * as CANNON from 'cannon';

import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { KeyBinding } from '../core/KeyBinding';
import * as THREE from 'three';
import * as Utils from '../core/FunctionLibrary';
import { SpringSimulator } from '../physics/spring_simulation/SpringSimulator';
import { World } from '../world/World';
import { EntityType } from '../enums/EntityType';

export class Car extends Vehicle implements IControllable
{
	public entityType: EntityType = EntityType.Car;
	public drive: string = 'awd';

	protected engineSoundPath: string = 'build/assets/car.wav';

	// Top gear's max speed, what the speedometer fills up to
	public topSpeed: number = 22;

	get speed(): number {
		return this._speed;
	}
	private _speed: number = 0;

	// private wheelsDebug: THREE.Mesh[] = [];
	private steeringWheel: THREE.Object3D;
	private airSpinTimer: number = 0;

	private steeringSimulator: SpringSimulator;
	private gear: number = 1;

	// Transmission
	private shiftTimer: number;
	private timeToShift: number = 0.2;

	private canTiltForwards: boolean = false;
	private characterWantsToExit: boolean = false;

	/** What the tyres grip at normally, and what the handbrake drops them to. */
	private static readonly GRIP: number = 0.8;
	private static readonly HANDBRAKE_GRIP: number = 0.28;
	/**
	 * Downforce as a share of the car's own weight at top speed. Applied down
	 * the body's own up axis rather than the world's, so it presses the car into
	 * the loop ramp on the way round instead of pulling it off.
	 */
	private static readonly DOWNFORCE: number = 0.55;

	/** Seconds of boost from full, and seconds to fill again from empty. */
	private static readonly BOOST_SECONDS: number = 3.5;
	private static readonly BOOST_RECHARGE: number = 9;
	/** Newtons at a standstill, tapering to nothing at the boosted top speed. */
	private static readonly BOOST_FORCE: number = 1900;
	private static readonly BOOST_TOP: number = 36;

	/** How much is left, nought to one. Read by the HUD. */
	public boostLeft: number = 1;
	public boosting: boolean = false;
	private boostPuff: number = 0;

	constructor(gltf: any)
	{
		super(gltf, {
			radius: 0.25,
			suspensionStiffness: 20,
			suspensionRestLength: 0.35,
			maxSuspensionTravel: 1,
			frictionSlip: 0.8,
			dampingRelaxation: 2,
			dampingCompression: 2,
			rollInfluence: 0.8
		});

		this.readCarData(gltf);

		this.collision.preStep = (body: CANNON.Body) => { this.physicsPreStep(body, this); };

		this.actions = {
			'throttle': new KeyBinding('KeyW'),
			'reverse': new KeyBinding('KeyS'),
			'brake': new KeyBinding('Space'),
			'left': new KeyBinding('KeyA'),
			'right': new KeyBinding('KeyD'),
			'exitVehicle': new KeyBinding('KeyF'),
			'seat_switch': new KeyBinding('KeyX'),
			'view': new KeyBinding('KeyV'),
			'boost': new KeyBinding('ShiftLeft'),
			'recover': new KeyBinding('KeyR'),
		};

		this.steeringSimulator = new SpringSimulator(60, 10, 0.6);
	}

	public noDirectionPressed(): boolean
	{
		let result = 
		!this.actions.throttle.isPressed &&
		!this.actions.reverse.isPressed &&
		!this.actions.left.isPressed &&
		!this.actions.right.isPressed;

		return result;
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		const tiresHaveContact = this.rayCastVehicle.numWheelsOnGround > 0;

		// Air spin
		if (!tiresHaveContact)
		{
			// Timer grows when car is off ground, resets once you touch the ground again
			this.airSpinTimer += timeStep;
			if (!this.actions.throttle.isPressed) this.canTiltForwards = true;
		}
		else
		{
			this.canTiltForwards = false;
			this.airSpinTimer = 0;
		}

		// Engine
		const engineForce = 500;
		const maxGears = 5;
		const gearsMaxSpeeds = {
			'R': -4,
			'0': 0,
			'1': 5,
			'2': 9,
			'3': 13,
			'4': 17,
			'5': 22,
		};

		if (this.shiftTimer > 0)
		{
			this.shiftTimer -= timeStep;
			if (this.shiftTimer < 0) this.shiftTimer = 0;
		}
		else
		{
			// Transmission 
			if (this.actions.reverse.isPressed)
			{
				const powerFactor = (gearsMaxSpeeds['R'] - this.speed) / Math.abs(gearsMaxSpeeds['R']);
				const force = (engineForce / this.gear) * (Math.abs(powerFactor) ** 1);

				this.applyEngineForce(force);
			}
			else
			{
				const powerFactor = (gearsMaxSpeeds[this.gear] - this.speed) / (gearsMaxSpeeds[this.gear] - gearsMaxSpeeds[this.gear - 1]);

				if (powerFactor < 0.1 && this.gear < maxGears) this.shiftUp();
				else if (this.gear > 1 && powerFactor > 1.2) this.shiftDown();
				else if (this.actions.throttle.isPressed)
				{
					const force = (engineForce / this.gear) * (powerFactor ** 1);
					this.applyEngineForce(-force);
				}
			}
		}

		this.updateBoost(timeStep);

		// Engine sound
		// Revs are measured against the current gear, so the pitch drops on every shift up
		const gearTopSpeed = this.actions.reverse.isPressed ? Math.abs(gearsMaxSpeeds['R']) : gearsMaxSpeeds[this.gear];
		const revs = THREE.MathUtils.clamp(Math.abs(this.speed) / gearTopSpeed, 0, 1);
		const throttling = this.actions.throttle.isPressed || this.actions.reverse.isPressed;

		this.updateEngineSound(
			0.6 + revs * 1.2,
			this.controllingCharacter === undefined ? 0 : (0.25 + revs * 0.75) * (throttling ? 1 : 0.4)
		);

		// Steering
		this.steeringSimulator.simulate(timeStep);
		this.setSteeringValue(this.steeringSimulator.position);
		if (this.steeringWheel !== undefined) this.steeringWheel.rotation.z = -this.steeringSimulator.position * 2;

		if (this.rayCastVehicle.numWheelsOnGround < 3 && Math.abs(this.collision.velocity.length()) < 0.5)	
		{	
			this.collision.quaternion.copy(this.collision.initQuaternion);	
		}

		// Getting out
		if (this.characterWantsToExit && this.controllingCharacter !== undefined && this.controllingCharacter.charState.canLeaveVehicles)
		{
			let speed = this.collision.velocity.length();

			if (speed > 0.1 && speed < 4)
			{
				this.triggerAction('brake', true);
			}
			else
			{
				this.forceCharacterOut();
			}
		}
	}

	/**
	 * Spends the boost while it's held and refills it when it isn't. Only the
	 * meter and the flames are here; the push itself belongs in the physics
	 * step, where it can be applied every substep rather than once a frame.
	 */
	private updateBoost(timeStep: number): void
	{
		let wanted = this.actions.boost.isPressed && this.boostLeft > 0
			&& this.controllingCharacter !== undefined;

		if (wanted && !this.boosting && this.world !== undefined) this.world.sfx.whoosh();
		this.boosting = wanted;

		if (wanted)
		{
			this.boostLeft = Math.max(0, this.boostLeft - timeStep / Car.BOOST_SECONDS);
			this.trailFlames(timeStep);
			return;
		}

		this.boostLeft = Math.min(1, this.boostLeft + timeStep / Car.BOOST_RECHARGE);
	}

	/** A flame out of the back, roughly where an exhaust would be. */
	private trailFlames(timeStep: number): void
	{
		this.boostPuff -= timeStep;
		if (this.boostPuff > 0 || this.world === undefined) return;
		this.boostPuff = 0.045;

		let back = new THREE.Vector3(0, 0.1, -1.35).applyQuaternion(this.quaternion).add(this.position);
		this.world.effects.addFlame(back, 0.28 + Math.random() * 0.14);
	}

	public shiftUp(): void
	{
		this.gear++;
		this.shiftTimer = this.timeToShift;

		this.applyEngineForce(0);
	}

	public shiftDown(): void
	{
		this.gear--;
		this.shiftTimer = this.timeToShift;

		this.applyEngineForce(0);
	}

	public physicsPreStep(body: CANNON.Body, car: Car): void
	{
		// Constants
		const quat = Utils.threeQuat(body.quaternion);
		const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
		const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
		const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);

		// Measure speed
		this._speed = this.collision.velocity.dot(Utils.cannonVector(forward));

		// Boost, tapering to nothing as it approaches its own top speed. Without
		// the taper there's no air resistance in the simulation to stop it, and
		// three seconds of a constant shove would put the car into orbit.
		if (this.boosting)
		{
			let room = THREE.MathUtils.clamp(1 - Math.abs(this.speed) / Car.BOOST_TOP, 0, 1);
			let shove = Utils.cannonVector(forward.clone().multiplyScalar(Car.BOOST_FORCE * room));

			this.collision.applyForce(shove, new CANNON.Vec3());
		}

		// Downforce, squared with speed the way real aerodynamic load is, so it's
		// absent at a crawl and only firms the car up once it's actually moving
		if (this.rayCastVehicle.numWheelsOnGround > 0)
		{
			let load = (this.speed / this.topSpeed) ** 2 * Car.DOWNFORCE;
			let weight = this.collision.mass * Math.abs(this.world.physicsWorld.gravity.y);
			let push = Utils.cannonVector(up.clone().multiplyScalar(-load * weight));

			// The point is relative to the centre of mass, and it belongs at the
			// centre: anywhere else and the load pitches the car instead of
			// pressing it down
			this.collision.applyForce(push, new CANNON.Vec3());
		}

		// Air spin
		// It takes 2 seconds until you have max spin air control since you leave the ground
		let airSpinInfluence = THREE.MathUtils.clamp(this.airSpinTimer / 2, 0, 1);
		airSpinInfluence *= THREE.MathUtils.clamp(this.speed, 0, 1);
		
		const flipSpeedFactor = THREE.MathUtils.clamp(1 - this.speed, 0, 1);
		const upFactor = (up.dot(new THREE.Vector3(0, -1, 0)) / 2) + 0.5;
		const flipOverInfluence = flipSpeedFactor * upFactor * 3;

		const maxAirSpinMagnitude = 2.0;
		const airSpinAcceleration = 0.15;
		const angVel = this.collision.angularVelocity;

		const spinVectorForward = Utils.cannonVector(forward.clone());
		const spinVectorRight = Utils.cannonVector(right.clone());

		const effectiveSpinVectorForward = Utils.cannonVector(forward.clone().multiplyScalar(airSpinAcceleration * (airSpinInfluence + flipOverInfluence)));
		const effectiveSpinVectorRight = Utils.cannonVector(right.clone().multiplyScalar(airSpinAcceleration * (airSpinInfluence)));

		// Right
		if (this.actions.right.isPressed && !this.actions.left.isPressed) {
			if (angVel.dot(spinVectorForward) < maxAirSpinMagnitude) {
				angVel.vadd(effectiveSpinVectorForward, angVel);
			}
		} else
		// Left
		if (this.actions.left.isPressed && !this.actions.right.isPressed) {
			if (angVel.dot(spinVectorForward) > -maxAirSpinMagnitude) {
				angVel.vsub(effectiveSpinVectorForward, angVel);
			}
		}

		// Forwards
		if (this.canTiltForwards && this.actions.throttle.isPressed && !this.actions.reverse.isPressed) {
			if (angVel.dot(spinVectorRight) < maxAirSpinMagnitude) {
				angVel.vadd(effectiveSpinVectorRight, angVel);
			}
		} else
		// Backwards
		if (this.actions.reverse.isPressed && !this.actions.throttle.isPressed) {
			if (angVel.dot(spinVectorRight) > -maxAirSpinMagnitude) {
				angVel.vsub(effectiveSpinVectorRight, angVel);
			}
		}

		// Steering
		const velocity = new CANNON.Vec3().copy(this.collision.velocity);
		velocity.normalize();
		let driftCorrection = Utils.getSignedAngleBetweenVectors(Utils.threeVector(velocity), forward);

		const maxSteerVal = 0.8;
		let speedFactor = THREE.MathUtils.clamp(this.speed * 0.3, 1, Number.MAX_VALUE);

		if (this.actions.right.isPressed)
		{
			let steering = Math.min(-maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = THREE.MathUtils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else if (this.actions.left.isPressed)
		{
			let steering = Math.max(maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = THREE.MathUtils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else this.steeringSimulator.target = 0;

		// Update doors
		this.seats.forEach((seat) => {
			seat.door?.preStepCallback();
		});
	}

	public onInputChange(): void {
		super.onInputChange();

		const brakeForce = 1000000;

		if (this.actions.exitVehicle.justPressed)
		{
			this.characterWantsToExit = true;
		}
		if (this.actions.exitVehicle.justReleased)
		{
			this.characterWantsToExit = false;
			this.triggerAction('brake', false);
		}
		if (this.actions.throttle.justReleased || this.actions.reverse.justReleased)
		{
			this.applyEngineForce(0);
		}
		if (this.actions.brake.justPressed)
		{
			this.setBrake(brakeForce, 'rwd');
			// Locking the back wheels is only half a handbrake. The other half is
			// letting them go sideways, which is the difference between stopping
			// dead and coming round
			this.setFrictionSlip(Car.HANDBRAKE_GRIP, 'rwd');
		}
		if (this.actions.brake.justReleased)
		{
			this.setBrake(0, 'rwd');
			this.setFrictionSlip(Car.GRIP, 'rwd');
		}
		if (this.actions.view.justPressed)
		{
			this.toggleFirstPersonView();
		}
	}

	public inputReceiverInit(): void
	{
		super.inputReceiverInit();

		this.world.updateControls([
			{
				keys: ['W', 'S'],
				desc: 'Accelerate, Brake / Reverse'
			},
			{
				keys: ['A', 'D'],
				desc: 'Steering'
			},
			{
				keys: ['Shift'],
				desc: 'Boost'
			},
			{
				keys: ['Space'],
				desc: 'Handbrake'
			},
			{
				keys: ['R'],
				desc: 'Flip the car back over'
			},
			{
				keys: ['V'],
				desc: 'View select'
			},
			{
				keys: ['F'],
				desc: 'Exit vehicle'
			},
			{
				keys: ['Shift', '+', 'R'],
				desc: 'Respawn'
			},
			{
				keys: ['Shift', '+', 'C'],
				desc: 'Free camera'
			},
		]);
	}

	public readCarData(gltf: any): void
	{
		gltf.scene.traverse((child: THREE.Object3D) => {
			if (child.hasOwnProperty('userData'))
			{
				if (child.userData.hasOwnProperty('data'))
				{
					if (child.userData.data === 'steering_wheel')
					{
						this.steeringWheel = child;
					}
				}
			}
		});
	}
}