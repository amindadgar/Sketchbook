import { Character } from '../characters/Character';
import * as THREE from 'three';
import * as CANNON from 'cannon';
import { World } from '../world/World';
import * as _ from 'lodash';
import { KeyBinding } from '../core/KeyBinding';
import { VehicleSeat } from './VehicleSeat';
import { Wheel } from './Wheel';
import { VehicleDoor } from './VehicleDoor';
import * as Utils from '../core/FunctionLibrary';
import { CollisionGroups } from '../enums/CollisionGroups';
import { SwitchingSeats } from '../characters/character_states/vehicles/SwitchingSeats';
import { EntityType } from '../enums/EntityType';
import { IWorldEntity } from '../interfaces/IWorldEntity';

export abstract class Vehicle extends THREE.Object3D implements IWorldEntity
{
	public updateOrder: number = 2;
	public abstract entityType: EntityType;
	
	public controllingCharacter: Character;
	public actions: { [action: string]: KeyBinding; } = {};
	public rayCastVehicle: CANNON.RaycastVehicle;
	public seats: VehicleSeat[] = [];
	public wheels: Wheel[] = [];
	public drive: string;
	public camera: any;
	public world: World;
	public help: THREE.AxesHelper;
	public collision: CANNON.Body;
	public materials: THREE.Material[] = [];
	public spawnPoint: THREE.Object3D;
	public engineSound: THREE.PositionalAudio;
	private modelContainer: THREE.Group;

	private firstPerson: boolean = false;

	// Engine audio. Subclasses opt in by setting 'engineSoundPath'.
	// Prefer wav or ogg over mp3, mp3 encoder padding leaves a gap at the loop point.
	protected engineSoundPath: string;
	protected engineSoundRefDistance: number = 6;
	private originalColors: { [uuid: string]: THREE.Color } = {};
	private static readonly UNPAINTED: string[] = [
		'wheel', 'tire', 'tyre', 'window', 'glass', 'headlight',
		'taillight', 'light', 'black', 'grey', 'gray', 'chrome'
	];
	private enginePitch: number = 1;
	private engineVolume: number = 0;

	/**
	 * Condition, 100 down to 0. Nothing about the handling depends on it: it
	 * decides how hard the wreck smokes, which is the whole point of it. A
	 * number the player can't see quietly throttling their engine would just
	 * feel like the car had gone wrong.
	 */
	public integrity: number = 100;
	/** Slower than this along the contact normal and it's a nudge, not a crash. */
	private static readonly IMPACT_FLOOR: number = 6;
	/** Health lost per metre a second over the floor. */
	private static readonly IMPACT_DAMAGE: number = 3.2;
	/** Condition lost per metre a second over the floor. */
	private static readonly IMPACT_WEAR: number = 5;
	private static readonly SMOKE_BELOW: number = 45;
	private impactCooldown: number = 0;
	private smokeTimer: number = 0;
	private headlights: THREE.Group;
	private static lampTexture: THREE.Texture;
	private boundOnCollide: (event: any) => void;

	/**
	 * Where the player driving this on another client last said it was. Only
	 * their client simulates it for real, so here the body is steered after
	 * those reports: velocity toward the pose rather than teleports with the
	 * velocity zeroed, so it collides like a moving car, sounds like one, and
	 * doesn't get argued with by everything that assumed a parked one.
	 */
	private remoteTarget: {
		position: THREE.Vector3, quaternion: THREE.Quaternion,
		velocity: THREE.Vector3, angularVelocity: THREE.Vector3,
		at: number, final: boolean
	};
	private remoteSteering: boolean = false;
	/** Reports older than this mean the driver has gone quiet, so it coasts. */
	private static readonly REMOTE_FRESH: number = 0.5;
	/** Further off than this and the body is put there rather than pulled. */
	private static readonly REMOTE_SNAP: number = 8;
	/** How hard the pose error is pulled in, per second. */
	private static readonly REMOTE_GAIN: number = 6;
	/** Reports are extrapolated at most this far, so a stall doesn't fling it. */
	private static readonly REMOTE_LEAD: number = 0.25;
	/** The same force the handbrake and the race grid use. */
	private static readonly PARKING_BRAKE: number = 1000000;
	private parked: boolean = false;

	// Tyres
	/** Squeal, as loud as the tyres are sliding. Made the first time they do. */
	private screech: THREE.PositionalAudio;
	private screechTone: BiquadFilterNode;
	private screechPitch: number = 1;
	private screechVolume: number = 0;
	/** For a car driven on another client: its speed along itself last frame, and how hard it's slowing. */
	private lastAlong: number = 0;
	private remoteBraking: number = 0;
	private static contactVelocity: CANNON.Vec3 = new CANNON.Vec3();
	private static axle: CANNON.Vec3 = new CANNON.Vec3();
	private static right: CANNON.Vec3 = new CANNON.Vec3(1, 0, 0);

	constructor(gltf: any, handlingSetup?: any)
	{
		super();

		if (handlingSetup === undefined) handlingSetup = {};
		handlingSetup.chassisConnectionPointLocal = new CANNON.Vec3(),
		handlingSetup.axleLocal = new CANNON.Vec3(-1, 0, 0);
		handlingSetup.directionLocal = new CANNON.Vec3(0, -1, 0);

		// Physics mat
		let mat = new CANNON.Material('Mat');
		mat.friction = 0.01;

		// Collision body
		this.collision = new CANNON.Body({ mass: 50 });
		this.collision.material = mat;

		// Read GLTF
		this.readVehicleData(gltf);

		this.modelContainer = new THREE.Group();
		this.add(this.modelContainer);
		this.modelContainer.add(gltf.scene);
		// this.setModel(gltf.scene);

		// Raycast vehicle component
		this.rayCastVehicle = new CANNON.RaycastVehicle({
			chassisBody: this.collision,
			indexUpAxis: 1,
			indexRightAxis: 0,
			indexForwardAxis: 2
		});

		this.wheels.forEach((wheel) =>
		{
			handlingSetup.chassisConnectionPointLocal.set(wheel.position.x, wheel.position.y + 0.2, wheel.position.z);
			const index = this.rayCastVehicle.addWheel(handlingSetup);
			wheel.rayCastWheelInfoIndex = index;
		});

		this.help = new THREE.AxesHelper(2);
	}

	public noDirectionPressed(): boolean
	{
		return true;
	}

	public update(timeStep: number): void
	{
		// Runs after the physics step, so the velocity set here is what the next
		// step integrates
		this.followRemoteTarget();
		this.updateParkingBrake();

		this.position.set(
			this.collision.interpolatedPosition.x,
			this.collision.interpolatedPosition.y,
			this.collision.interpolatedPosition.z
		);

		this.quaternion.set(
			this.collision.interpolatedQuaternion.x,
			this.collision.interpolatedQuaternion.y,
			this.collision.interpolatedQuaternion.z,
			this.collision.interpolatedQuaternion.w
		);

		this.seats.forEach((seat: VehicleSeat) => {
			seat.update(timeStep);
		});

		if (this.impactCooldown > 0) this.impactCooldown -= timeStep;
		this.updateSmoke(timeStep);

		// Before the wheels are placed: placing them clears whether they touch the ground
		this.updateTyres(timeStep);

		for (let i = 0; i < this.rayCastVehicle.wheelInfos.length; i++)
		{
			this.rayCastVehicle.updateWheelTransform(i);
			let transform = this.rayCastVehicle.wheelInfos[i].worldTransform;

			let wheelObject = this.wheels[i].wheelObject;
			wheelObject.position.copy(Utils.threeVector(transform.position));
			wheelObject.quaternion.copy(Utils.threeQuat(transform.quaternion));

			let upAxisWorld = new CANNON.Vec3();
			this.rayCastVehicle.getVehicleAxisWorld(this.rayCastVehicle.indexUpAxis, upAxisWorld);
		}

		this.updateMatrixWorld();
	}

	/** Braking with the pedal rather than a locked wheel, which only a car has. */
	protected isFootBraking(): boolean
	{
		return false;
	}

	/**
	 * Which tyres are sliding and how hard: skidding sideways, locked by a
	 * brake while the car moves, past their grip under power or braking, or
	 * braked hard with the pedal. Those leave rubber on the road, and between
	 * them set how loud the tyres squeal.
	 */
	private updateTyres(timeStep: number): void
	{
		if (this.world === undefined || this.world.skidMarks === undefined || this.wheels.length === 0) return;

		let body = this.collision;
		let footBraking = this.isFootBraking();
		let total = 0;
		let speed = 0;
		let smooth = THREE.MathUtils.smoothstep;

		// Driven on another client, this copy's wheels aren't steered or braked
		// here, and its tyres only fight the pose it's being pulled to. What it
		// can tell is how hard it's slowing, which is what braking looks like
		let remote = this.isRemoteDriven();
		let ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
		let along = body.velocity.x * ahead.x + body.velocity.y * ahead.y + body.velocity.z * ahead.z;
		if (remote && timeStep > 0)
		{
			let slowing = (Math.abs(this.lastAlong) - Math.abs(along)) / timeStep;
			let braking = Math.abs(along) > 3 ? THREE.MathUtils.clamp((slowing - 5) / 8, 0, 1) : 0;
			this.remoteBraking += (braking - this.remoteBraking) * Math.min(1, timeStep * 8);
		}
		else this.remoteBraking = 0;
		this.lastAlong = along;

		for (let i = 0; i < this.wheels.length; i++)
		{
			let info = this.rayCastVehicle.wheelInfos[this.wheels[i].rayCastWheelInfoIndex];
			// What the last physics step found under the wheel. Not isInContact,
			// which placing the wheels clears every frame, including frames with
			// no physics step in them
			if (info === undefined || info.raycastResult.body === null || info.raycastResult.body === undefined) continue;

			let hit = info.raycastResult.hitPointWorld;
			let normal = info.raycastResult.hitNormalWorld;
			let velocity = body.getVelocityAtWorldPoint(hit, Vehicle.contactVelocity);
			let across = normal.dot(velocity);
			let vx = velocity.x - normal.x * across, vy = velocity.y - normal.y * across, vz = velocity.z - normal.z * across;
			let moving = Math.sqrt(vx * vx + vy * vy + vz * vz);
			speed = Math.max(speed, moving);
			if (moving < 1.2) continue;

			let axle = info.worldTransform.quaternion.vmult(Vehicle.right, Vehicle.axle);
			let sideways = remote && this.wheels[i].steering ? 0 : Math.abs(vx * axle.x + vy * axle.y + vz * axle.z);

			// Past its grip. Under power that's only a skid on a hard launch:
			// the engine overdoes it after every gear change, which nobody hears
			// as a skid or expects to see on the road
			let saturated = !remote && info.sliding ? THREE.MathUtils.clamp((1 - info.skidInfo) * 1.8, 0, 1) : 0;
			if (info.engineForce !== 0) saturated = moving < 5 && info.skidInfo < 0.35 ? saturated * 0.6 : 0;

			let strength = Math.max(
				smooth(sideways, 1.1, 4.5),
				saturated,
				info.brake > 1000 ? Math.min(1, moving / 8) : 0,
				footBraking ? Math.min(1, moving / 14) * 0.85 : 0,
				this.remoteBraking * 0.85
			);
			if (strength < 0.15) continue;

			this.world.skidMarks.mark(this.wheels[i],
				new THREE.Vector3(hit.x, hit.y, hit.z),
				new THREE.Vector3(normal.x, normal.y, normal.z),
				new THREE.Vector3(vx, vy, vz), strength);
			total += strength;
		}

		this.updateScreech(total / this.wheels.length, speed, timeStep);
	}

	private updateScreech(sliding: number, speed: number, timeStep: number): void
	{
		let target = THREE.MathUtils.clamp(sliding * 1.6, 0, 1) * THREE.MathUtils.clamp(speed / 5, 0, 1);
		// Comes in quickly and tails off, the way a skid does
		let rate = target > this.screechVolume ? 12 : 5;
		this.screechVolume += (target - this.screechVolume) * Math.min(1, timeStep * rate);

		if (this.screech === undefined)
		{
			if (this.screechVolume < 0.02 || this.world.audioListener === undefined) return;
			let buffer = this.world.sfx.screech();
			if (buffer === undefined) return;
			this.screech = new THREE.PositionalAudio(this.world.audioListener);
			// Silent to start with: the gain begins at full, and the first setVolume
			// only ramps it down, so the first skid would open with a pop
			this.screech.gain.gain.setValueAtTime(0, this.screech.context.currentTime);
			this.screech.setBuffer(buffer);
			this.screech.setLoop(true);
			this.screech.setRefDistance(9);
			this.screech.setRolloffFactor(1.6);
			this.screech.position.set(0, -0.2, 0);
			// A light slide is a muffled scrub, a hard one the full bright squeal
			this.screechTone = this.screech.context.createBiquadFilter();
			this.screechTone.type = 'lowpass';
			this.screechTone.Q.value = 0.7;
			this.screech.setFilter(this.screechTone);
			// Every car's tyres a little different
			this.screechPitch = 0.94 + Math.random() * 0.12;
			this.add(this.screech);
		}

		if (this.screechVolume < 0.01)
		{
			if (this.screech.isPlaying) this.screech.stop();
			return;
		}
		if (!this.screech.isPlaying)
		{
			// Somewhere new in the recording each time, so no two skids start the same
			let buffer = this.screech.buffer;
			if (buffer !== null) this.screech.offset = Math.random() * buffer.duration * 0.9;
			this.screech.play();
		}

		let now = this.screech.context.currentTime;
		this.screech.setVolume(Math.pow(this.screechVolume, 0.8) * 0.8);
		this.screechTone.frequency.setTargetAtTime(700 + 9000 * Math.pow(this.screechVolume, 1.5), now, 0.05);
		this.screech.setPlaybackRate(this.screechPitch * (0.9 + 0.18 * Math.min(1, speed / 25)) * this.world.params.Time_Scale);
	}

	/** Stops the tyre squeal at once, for when the frame loop that fades it is about to stop. */
	public silenceTyres(): void
	{
		if (this.screech !== undefined && this.screech.isPlaying) this.screech.stop();
		this.screechVolume = 0;
	}

	private disposeScreech(): void
	{
		if (this.screech === undefined) return;
		if (this.screech.isPlaying) this.screech.stop();
		this.remove(this.screech);
		this.screech = undefined;
		this.screechVolume = 0;
	}

	public forceCharacterOut(): void
	{
		this.controllingCharacter.modelContainer.visible = true;
		this.controllingCharacter.exitVehicle();
	}

	public onInputChange(): void
	{
		if (this.actions.recover !== undefined && this.actions.recover.justPressed) this.recover();

		if (this.actions.seat_switch.justPressed && this.controllingCharacter?.occupyingSeat?.connectedSeats.length > 0)
		{
			// Only into a seat nobody else has, here or on anyone else's screen
			let driver = this.controllingCharacter;
			let free = driver.occupyingSeat.connectedSeats.find((seat) => driver.canUseSeat(seat));

			if (free !== undefined)
			{
				driver.modelContainer.visible = true;
				driver.setState(new SwitchingSeats(driver, driver.occupyingSeat, free));
				driver.stopControllingVehicle();
			}
		}
	}

	public resetControls(): void
	{
		for (const action in this.actions) {
			if (this.actions.hasOwnProperty(action)) {
				this.triggerAction(action, false);
			}
		}
	}

	public allowSleep(value: boolean): void
	{
		this.collision.allowSleep = value;

		if (value === false)
		{
			this.collision.wakeUp();
		}
	}

	public handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void
	{
		// Free camera
		if (code === 'KeyC' && pressed === true && event.shiftKey === true)
		{
			this.resetControls();
			this.world.cameraOperator.characterCaller = this.controllingCharacter;
			this.world.inputManager.setInputReceiver(this.world.cameraOperator);
		}
		else if (code === 'KeyR' && pressed === true && event.shiftKey === true)
		{
			if (!event.repeat) this.world.requestRespawn();
		}
		else
		{
			for (const action in this.actions) {
				if (this.actions.hasOwnProperty(action)) {
					const binding = this.actions[action];

					if (_.includes(binding.eventCodes, code))
					{
						this.triggerAction(action, pressed);
					}
				}
			}
		}
	}

	public setFirstPersonView(value: boolean): void
	{
		this.firstPerson = value;
		if (this.controllingCharacter !== undefined) this.controllingCharacter.modelContainer.visible = !value;

		if (value)
		{
			this.world.cameraOperator.setRadius(0, true);
		}
		else
		{
			this.world.cameraOperator.setRadius(3, true);
		}
	}

	public toggleFirstPersonView(): void
	{
		this.setFirstPersonView(!this.firstPerson);
	}
	
	public triggerAction(actionName: string, value: boolean): void
	{
		// Get action and set it's parameters
		let action = this.actions[actionName];

		if (action.isPressed !== value)
		{
			// Set value
			action.isPressed = value;

			// Reset the 'just' attributes
			action.justPressed = false;
			action.justReleased = false;

			// Set the 'just' attributes
			if (value) action.justPressed = true;
			else action.justReleased = true;

			this.onInputChange();

			// Reset the 'just' attributes
			action.justPressed = false;
			action.justReleased = false;
		}
	}

	public handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void
	{
		return;
	}

	public handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void
	{
		this.world.cameraOperator.move(deltaX, deltaY);
	}

	public handleMouseWheel(event: WheelEvent, value: number): void
	{
		this.world.scrollTheTimeScale(value);
	}

	public inputReceiverInit(): void
	{
		this.collision.allowSleep = false;
		this.setFirstPersonView(false);
	}

	public inputReceiverUpdate(timeStep: number): void
	{
		if (this.firstPerson)
		{
			// this.world.cameraOperator.target.set(
			//     this.position.x + this.camera.position.x,
			//     this.position.y + this.camera.position.y,
			//     this.position.z + this.camera.position.z
			// );

			let temp = new THREE.Vector3().copy(this.camera.position);
			temp.applyQuaternion(this.quaternion);
			this.world.cameraOperator.target.copy(temp.add(this.position));
		}
		else
		{
			// Position camera
			this.world.cameraOperator.target.set(
				this.position.x,
				this.position.y + 0.5,
				this.position.z
			);
		}
	}

	public setPosition(x: number, y: number, z: number): void
	{
		this.collision.position.x = x;
		this.collision.position.y = y;
		this.collision.position.z = z;
	}

	public setSteeringValue(val: number): void
	{
		this.wheels.forEach((wheel) =>
		{
			if (wheel.steering) this.rayCastVehicle.setSteeringValue(val, wheel.rayCastWheelInfoIndex);
		});
	}

	public applyEngineForce(force: number): void
	{
		this.wheels.forEach((wheel) =>
		{
			if (this.drive === wheel.drive || this.drive === 'awd')
			{
				this.rayCastVehicle.applyEngineForce(force, wheel.rayCastWheelInfoIndex);
			}
		});
	}

	/**
	 * Sets a stuck vehicle back on its wheels where it stands.
	 *
	 * A car that stops upside down rights itself already, but one wedged nose
	 * first into a barrier is the right way up and going nowhere, and there was
	 * no way out of that short of restarting the whole scenario. The heading is
	 * kept and everything else about the rotation is thrown away.
	 */
	public recover(): void
	{
		let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
		let heading = Math.atan2(forward.x, forward.z);
		let upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, heading, 0));

		this.collision.quaternion.set(upright.x, upright.y, upright.z, upright.w);
		this.collision.position.y += 1.2;
		this.collision.velocity.set(0, 0, 0);
		this.collision.angularVelocity.set(0, 0, 0);

		// The visuals read the interpolated pair, so without these the car snaps
		// back to where it was for a frame before catching up
		this.collision.interpolatedQuaternion.copy(this.collision.quaternion);
		this.collision.interpolatedPosition.copy(this.collision.position);
		this.collision.aabbNeedsUpdate = true;
		this.collision.wakeUp();
	}

	/** The id vehicles are matched by across a party: the name of the spawn point. */
	public getNetworkId(): string
	{
		return this.spawnPoint !== undefined ? this.spawnPoint.name : undefined;
	}

	/**
	 * A pose report from whoever is driving this, or last drove it, on another
	 * client. 'final' means they've let go and this is where it ended up.
	 * Ignored while anyone local is at the wheel, whose simulation wins here.
	 */
	public setRemoteTarget(position: THREE.Vector3, quaternion: THREE.Quaternion,
		velocity: THREE.Vector3, angularVelocity: THREE.Vector3, final: boolean): void
	{
		if (this.controllingCharacter !== undefined) return;

		if (this.remoteTarget === undefined)
		{
			this.remoteTarget = {
				position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
				velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
				at: 0, final: false
			};
		}

		let target = this.remoteTarget;
		target.position.copy(position);
		target.quaternion.copy(quaternion).normalize();
		target.velocity.copy(velocity);
		target.angularVelocity.copy(angularVelocity);
		target.at = performance.now() / 1000;
		target.final = final;

		// Where it came to rest is where it is, no easing required
		if (final) this.placeBody(position, target.quaternion, velocity, angularVelocity);
	}

	/** A driver on another client is steering this right now. */
	public isRemoteDriven(): boolean
	{
		let target = this.remoteTarget;

		return this.controllingCharacter === undefined
			&& target !== undefined
			&& !target.final
			&& performance.now() / 1000 - target.at < Vehicle.REMOTE_FRESH;
	}

	/** Someone is at the wheel, here or on another client. For engines, rotors and lights. */
	public hasDriver(): boolean
	{
		return this.controllingCharacter !== undefined || this.isRemoteDriven();
	}

	/** Back to local physics alone, for a scenario change or leaving the party. */
	public clearRemoteTarget(): void
	{
		this.remoteTarget = undefined;
		if (this.remoteSteering) this.releaseRemoteSteering();
	}

	private followRemoteTarget(): void
	{
		if (!this.isRemoteDriven())
		{
			if (this.remoteSteering) this.releaseRemoteSteering();
			return;
		}

		let body = this.collision;
		let target = this.remoteTarget;

		if (!this.remoteSteering)
		{
			// Awake for as long as it's being steered: asleep, cannon skips it,
			// and its collision box stays wherever it dozed off
			this.remoteSteering = true;
			body.allowSleep = false;
			// Brakes left on here by a race countdown would drag against it
			this.setBrake(0);
		}
		body.wakeUp();

		let lead = Math.min(performance.now() / 1000 - target.at, Vehicle.REMOTE_LEAD);

		let predicted = new THREE.Vector3().copy(target.position).addScaledVector(target.velocity, lead);
		let predictedRotation = new THREE.Quaternion().copy(target.quaternion);
		let spin = target.angularVelocity.length();
		if (spin > 0.0001)
		{
			let turn = new THREE.Quaternion().setFromAxisAngle(
				new THREE.Vector3().copy(target.angularVelocity).divideScalar(spin), spin * lead);
			predictedRotation.premultiply(turn);
		}

		let current = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
		let error = predicted.clone().sub(current);

		let currentRotation = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
		// The rotation still to go, taken the short way round
		let delta = predictedRotation.clone().multiply(currentRotation.clone().invert());
		if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
		let angle = 2 * Math.acos(THREE.MathUtils.clamp(delta.w, -1, 1));

		if (error.length() > Vehicle.REMOTE_SNAP || angle > 1.2)
		{
			this.placeBody(predicted, predictedRotation, target.velocity, target.angularVelocity);
			return;
		}

		let velocity = target.velocity.clone().addScaledVector(error, Vehicle.REMOTE_GAIN);
		body.velocity.set(velocity.x, velocity.y, velocity.z);

		let angular = target.angularVelocity.clone();
		let sine = Math.sqrt(Math.max(0, 1 - delta.w * delta.w));
		if (sine > 0.0001)
		{
			angular.add(new THREE.Vector3(delta.x, delta.y, delta.z).divideScalar(sine).multiplyScalar(angle * Vehicle.REMOTE_GAIN));
		}
		if (angular.length() > 20) angular.setLength(20);
		body.angularVelocity.set(angular.x, angular.y, angular.z);
	}

	/** Puts the body exactly somewhere, for jumps too big to pull across. */
	private placeBody(position: THREE.Vector3, quaternion: THREE.Quaternion,
		velocity: THREE.Vector3, angularVelocity: THREE.Vector3): void
	{
		let body = this.collision;

		body.position.set(position.x, position.y, position.z);
		body.previousPosition.set(position.x, position.y, position.z);
		body.interpolatedPosition.set(position.x, position.y, position.z);
		body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
		// There at runtime, missing from the typings
		(body as any).previousQuaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
		body.interpolatedQuaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
		body.velocity.set(velocity.x, velocity.y, velocity.z);
		body.angularVelocity.set(angularVelocity.x, angularVelocity.y, angularVelocity.z);
		body.aabbNeedsUpdate = true;
		body.wakeUp();
	}

	/**
	 * A vehicle nobody is driving puts its brakes on once it has slowed right
	 * down. The tyres hold almost nothing by themselves, so a car left on a
	 * slope otherwise creeps downhill for ever, a car bumped into rolls off
	 * down the street, and in a party each client's copy creeps its own way
	 * until they're nowhere near each other. Whoever takes the wheel next,
	 * here or on another client, lets them off.
	 */
	private updateParkingBrake(): void
	{
		let unattended = this.controllingCharacter === undefined && !this.isRemoteDriven();

		if (!unattended)
		{
			if (this.parked)
			{
				this.parked = false;
				this.setBrake(0);
				// A handbrake held while climbing in still wants its brakes
				this.reapplyHeldBrakes();
			}
			return;
		}

		let body = this.collision;

		if (this.parked)
		{
			// Put back on if something else let it off, such as a race start
			// releasing every brake on the grid
			this.setBrake(Vehicle.PARKING_BRAKE);

			// Braked wheels still slide a few centimetres a second on this little
			// grip, just under what cannon counts as stopped. Once it's crawling on
			// its wheels it's put to sleep, which holds it exactly where it is on
			// every screen until something touches it or someone gets in.
			if (body.allowSleep && body.sleepState === CANNON.Body.AWAKE
				&& this.rayCastVehicle.numWheelsOnGround >= 3
				&& body.velocity.length() < 0.1 && body.angularVelocity.length() < 0.1)
			{
				body.sleep();
			}
			return;
		}

		if (this.wheels.length === 0 || this.rayCastVehicle.numWheelsOnGround === 0) return;
		if (this.world === undefined) return;
		if (body.velocity.length() > 1) return;

		this.parked = true;
		this.setBrake(Vehicle.PARKING_BRAKE);
	}

	/** For controls held down as a driver takes over, which the parking brake coming off would undo. */
	protected reapplyHeldBrakes(): void
	{
	}

	/** Local physics takes over from whatever velocity it last had, so it coasts. */
	private releaseRemoteSteering(): void
	{
		this.remoteSteering = false;

		// A local driver who got in meanwhile keeps it awake, or a car stopped
		// for a second would doze off and ignore the throttle
		if (this.controllingCharacter === undefined) this.collision.allowSleep = true;
		this.collision.wakeUp();
	}

	/**
	 * A pair of lamps at the front, lit after dark. Sprites rather than lights:
	 * they're parented to the vehicle so they follow it for nothing, and the
	 * point is that a car is visible in the dark, not that it lights the road.
	 */
	public setHeadlights(on: boolean): void
	{
		if (this.entityType !== EntityType.Car) return;

		if (this.headlights === undefined)
		{
			this.headlights = new THREE.Group();

			for (const side of [-0.52, 0.52])
			{
				let lamp = new THREE.Sprite(new THREE.SpriteMaterial({
					map: Vehicle.getLampTexture(),
					color: 0xfff3d0,
					blending: THREE.AdditiveBlending,
					transparent: true,
					depthWrite: false,
					opacity: 0.7
				}));

				lamp.position.set(side, 0.32, 1.32);
				lamp.scale.setScalar(0.42);
				this.headlights.add(lamp);
			}

			this.add(this.headlights);
		}

		this.headlights.visible = on;
	}

	private static getLampTexture(): THREE.Texture
	{
		if (Vehicle.lampTexture !== undefined) return Vehicle.lampTexture;

		let canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 64;

		let context = canvas.getContext('2d');
		let gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
		gradient.addColorStop(0.35, 'rgba(255, 240, 200, 0.5)');
		gradient.addColorStop(1.0, 'rgba(255, 220, 150, 0)');

		context.fillStyle = gradient;
		context.fillRect(0, 0, 64, 64);

		Vehicle.lampTexture = new THREE.CanvasTexture(canvas);
		return Vehicle.lampTexture;
	}

	/**
	 * Cannon reports a collision once, on the frame the two bodies first touch,
	 * to both of them. A crash is still several of those as the car tumbles, so
	 * there's a short cooldown to stop one accident being billed five times.
	 */
	private onCollide(event: any): void
	{
		if (event.contact === undefined) return;

		let impact = Math.abs(event.contact.getImpactVelocityAlongNormal());
		this.onShoved(event.body, impact);
		if (this.impactCooldown > 0) return;

		if (impact < Vehicle.IMPACT_FLOOR) return;

		this.impactCooldown = 0.5;

		let over = impact - Vehicle.IMPACT_FLOOR;
		this.integrity = Math.max(0, this.integrity - over * Vehicle.IMPACT_WEAR);

		this.world.sfx.thud(this.position, Math.min(1, over / 14));

		// Only the local player's own client decides what a crash did to them,
		// the same way it already owns everything else about their health
		if (this.controllingCharacter === undefined) return;
		if (this.controllingCharacter !== this.world.localCharacter) return;

		this.world.combat.applyCrashDamage(over * Vehicle.IMPACT_DAMAGE);
	}

	/**
	 * Hit by something while nobody is driving it. The parking brake stays on,
	 * which locks the wheels rather than the car: a hit shoves it along in a
	 * skid that its tyres soon stop. A shove from the local player's own car
	 * is reported to the party until the car comes to rest, the way a car
	 * someone has just got out of is.
	 */
	private onShoved(other: any, impact: number): void
	{
		if (this.world === undefined || this.controllingCharacter !== undefined || impact < 1) return;

		this.collision.wakeUp();

		let pusher = this.world.vehicles.find((vehicle) => vehicle.collision === other);
		if (pusher !== undefined && pusher.controllingCharacter !== undefined
			&& pusher.controllingCharacter === this.world.localCharacter && this.world.party !== undefined)
		{
			this.world.party.shoved(this);
		}
	}

	/** A battered vehicle smokes, harder the worse it is, and only while running. */
	private updateSmoke(timeStep: number): void
	{
		if (this.integrity >= Vehicle.SMOKE_BELOW || this.world === undefined) return;

		let hurt = 1 - this.integrity / Vehicle.SMOKE_BELOW;

		this.smokeTimer -= timeStep;
		if (this.smokeTimer > 0) return;
		this.smokeTimer = 0.22 - 0.14 * hurt;

		// Off the top of the body rather than its centre, so it rises out of the
		// bonnet instead of appearing inside the cabin
		let from = new THREE.Vector3(
			this.position.x + (Math.random() - 0.5) * 0.5,
			this.position.y + 0.45,
			this.position.z + (Math.random() - 0.5) * 0.5);

		this.world.effects.addSmoke(from, 0.6 + hurt * 0.5, 0.45 - hurt * 0.3);
	}

	/**
	 * How hard the tyres hold on sideways. Dropping it on the driven pair is
	 * what turns the handbrake from a full stop into a slide.
	 */
	public setFrictionSlip(value: number, driveFilter?: string): void
	{
		this.wheels.forEach((wheel) =>
		{
			if (driveFilter === undefined || driveFilter === wheel.drive)
			{
				this.rayCastVehicle.wheelInfos[wheel.rayCastWheelInfoIndex].frictionSlip = value;
			}
		});
	}

	public setBrake(brakeForce: number, driveFilter?: string): void
	{
		this.wheels.forEach((wheel) =>
		{
			if (driveFilter === undefined || driveFilter === wheel.drive)
			{
				this.rayCastVehicle.setBrake(brakeForce, wheel.rayCastWheelInfoIndex);
			}
		});
	}

	public addToWorld(world: World): void
	{
		if (_.includes(world.vehicles, this))
		{
			console.warn('Adding character to a world in which it already exists.');
		}
		else if (this.rayCastVehicle === undefined)
		{
			console.error('Trying to create vehicle without raycastVehicleComponent');
		}
		else
		{
			this.world = world;
			world.vehicles.push(this);
			world.graphicsWorld.add(this);
			// world.physicsWorld.addBody(this.collision);
			this.rayCastVehicle.addToWorld(world.physicsWorld);

			this.boundOnCollide = (event: any) => this.onCollide(event);
			(this.collision as any).addEventListener('collide', this.boundOnCollide);

			this.wheels.forEach((wheel) =>
			{
				world.graphicsWorld.attach(wheel.wheelObject);
			});


			this.setupEngineSound(world);
		}
	}

	public removeFromWorld(world: World): void
	{
		if (!_.includes(world.vehicles, this))
		{
			console.warn('Removing character from a world in which it isn\'t present.');
		}
		else
		{
			this.world = undefined;
			this.clearRemoteTarget();
			_.pull(world.vehicles, this);
			world.graphicsWorld.remove(this);
			// world.physicsWorld.remove(this.collision);
			this.rayCastVehicle.removeFromWorld(world.physicsWorld);

			if (this.boundOnCollide !== undefined)
			{
				(this.collision as any).removeEventListener('collide', this.boundOnCollide);
				this.boundOnCollide = undefined;
			}

			this.wheels.forEach((wheel) =>
			{
				world.graphicsWorld.remove(wheel.wheelObject);
			});

			this.disposeEngineSound();
			this.disposeScreech();
		}
	}

	/**
	 * Creates a looping engine sound that travels with the vehicle.
	 * The sound is a child of the vehicle's Object3D, so the 'updateMatrixWorld'
	 * call in 'update' already moves the panner along with it.
	 */
	protected setupEngineSound(world: World): void
	{
		if (this.engineSoundPath === undefined || world.audioListener === undefined) return;

		this.engineSound = new THREE.PositionalAudio(world.audioListener);
		this.engineSound.setRefDistance(this.engineSoundRefDistance);
		this.engineSound.setRolloffFactor(1.6);
		this.engineSound.setLoop(true);
		this.engineSound.setVolume(0);
		this.add(this.engineSound);

		new THREE.AudioLoader().load(this.engineSoundPath,
			(buffer: AudioBuffer) =>
			{
				// The vehicle can get removed while the file is still downloading
				if (this.engineSound === undefined) return;

				this.engineSound.setBuffer(buffer);
				this.engineSound.play();
			},
			undefined,
			() =>
			{
				console.warn('Couldn\'t load engine sound from \'' + this.engineSoundPath + '\'.');
			});
	}

	/**
	 * Feeds the engine sound. Pitch is a multiple of the sample's own pitch, both
	 * values are lerped so gear shifts and throttle taps glide instead of clicking.
	 */
	protected updateEngineSound(pitch: number, volume: number): void
	{
		if (this.engineSound === undefined || !this.engineSound.isPlaying) return;

		this.enginePitch = THREE.MathUtils.lerp(this.enginePitch, pitch, 0.15);
		this.engineVolume = THREE.MathUtils.lerp(this.engineVolume, volume, 0.15);

		// Time scale is baked in, so slow motion sounds like slow motion
		this.engineSound.setPlaybackRate(this.enginePitch * this.world.params.Time_Scale);
		this.engineSound.setVolume(this.engineVolume);
	}

	/**
	 * Paints the vehicle in the driver's colour. Wheels are left alone,
	 * a bright red tyre reads as a bug rather than a livery.
	 */
	public setPlayerTint(color: string): void
	{
		let target = new THREE.Color(color);

		this.materials.forEach((mat: any) =>
		{
			if (mat.color === undefined || Vehicle.isUnpainted(mat.name)) return;

			if (this.originalColors[mat.uuid] === undefined)
			{
				this.originalColors[mat.uuid] = mat.color.clone();
			}

			mat.color.copy(target);
		});
	}

	/**
	 * Bodywork gets the driver's colour; glass, lights, trim and tyres don't.
	 * Matched on the material name, since that's all an imported model carries,
	 * and a red windscreen reads as a bug rather than a paint job.
	 */
	private static isUnpainted(name: string): boolean
	{
		if (name === undefined) return false;

		let lower = name.toLowerCase();

		for (const part of Vehicle.UNPAINTED)
		{
			if (lower.indexOf(part) >= 0) return true;
		}

		return false;
	}

	public clearPlayerTint(): void
	{
		this.materials.forEach((mat: any) =>
		{
			let original = this.originalColors[mat.uuid];
			if (original !== undefined) mat.color.copy(original);
		});

		this.originalColors = {};
	}

	protected disposeEngineSound(): void
	{
		if (this.engineSound === undefined) return;

		// Without this, a looping engine keeps playing after a scenario restart
		if (this.engineSound.isPlaying) this.engineSound.stop();
		this.remove(this.engineSound);
		this.engineSound = undefined;
	}

	public readVehicleData(gltf: any): void
	{
		gltf.scene.traverse((child) => {

			if (child.isMesh)
			{
				Utils.setupMeshProperties(child);
				Utils.paintVehicle(child);

				if (child.material !== undefined)
				{
					this.materials.push(child.material);
				}
			}

			if (child.hasOwnProperty('userData'))
			{
				if (child.userData.hasOwnProperty('data'))
				{
					if (child.userData.data === 'seat')
					{
						this.seats.push(new VehicleSeat(this, child, gltf));
					}
					if (child.userData.data === 'camera')
					{
						this.camera = child;
					}
					if (child.userData.data === 'wheel')
					{
						this.wheels.push(new Wheel(child));
					}
					if (child.userData.data === 'collision')
					{
						if (child.userData.shape === 'box')
						{
							child.visible = false;

							let phys = new CANNON.Box(new CANNON.Vec3(child.scale.x, child.scale.y, child.scale.z));
							phys.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
							this.collision.addShape(phys, new CANNON.Vec3(child.position.x, child.position.y, child.position.z));
						}
						else if (child.userData.shape === 'sphere')
						{
							child.visible = false;

							let phys = new CANNON.Sphere(child.scale.x);
							phys.collisionFilterGroup = CollisionGroups.TrimeshColliders;
							this.collision.addShape(phys, new CANNON.Vec3(child.position.x, child.position.y, child.position.z));
						}
					}
					if (child.userData.data === 'navmesh')
					{
						child.visible = false;
					}
				}
			}
		});

		if (this.collision.shapes.length === 0)
		{
			console.warn('Vehicle ' + typeof(this) + ' has no collision data.');
		}
		if (this.seats.length === 0)
		{
			console.warn('Vehicle ' + typeof(this) + ' has no seats.');
		}
		else
		{
			this.connectSeats();
		}
	}

	private connectSeats(): void
	{
		for (const firstSeat of this.seats)
		{
			if (firstSeat.connectedSeatsString !== undefined)
			{
				// Get list of connected seat names
				let conn_seat_names = firstSeat.connectedSeatsString.split(';');
				for (const conn_seat_name of conn_seat_names)
				{
					// If name not empty
					if (conn_seat_name.length > 0)
					{
						// Run through seat list and connect seats to this seat,
						// based on this seat's connected seats list
						for (const secondSeat of this.seats)
						{
							if (secondSeat.seatPointObject.name === conn_seat_name) 
							{
								firstSeat.connectedSeats.push(secondSeat);
							}
						}
					}
				}
			}
		}
	}
}