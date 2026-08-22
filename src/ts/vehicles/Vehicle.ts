import { Character } from '../characters/Character';
import * as THREE from 'three';
import * as CANNON from 'cannon';
import { World } from '../world/World';
import _ = require('lodash');
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
			this.controllingCharacter.modelContainer.visible = true;
			this.controllingCharacter.setState(
				new SwitchingSeats(
					this.controllingCharacter,
					this.controllingCharacter.occupyingSeat,
					this.controllingCharacter.occupyingSeat.connectedSeats[0]
				)
			);
			this.controllingCharacter.stopControllingVehicle();
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
			this.world.restartScenario();
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
		if (this.impactCooldown > 0 || event.contact === undefined) return;

		let impact = Math.abs(event.contact.getImpactVelocityAlongNormal());
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

			this.materials.forEach((mat) =>
			{
				world.sky.csm.setupMaterial(mat);
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