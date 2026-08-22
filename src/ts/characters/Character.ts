import * as THREE from 'three';
import * as CANNON from 'cannon';
import * as _ from 'lodash';
import * as Utils from '../core/FunctionLibrary';

import { KeyBinding } from '../core/KeyBinding';
import { VectorSpringSimulator } from '../physics/spring_simulation/VectorSpringSimulator';
import { RelativeSpringSimulator } from '../physics/spring_simulation/RelativeSpringSimulator';
import { Idle } from './character_states/Idle';
import { EnteringVehicle } from './character_states/vehicles/EnteringVehicle';
import { ExitingVehicle } from './character_states/vehicles/ExitingVehicle';
import { OpenVehicleDoor as OpenVehicleDoor } from './character_states/vehicles/OpenVehicleDoor';
import { Driving } from './character_states/vehicles/Driving';
import { ExitingAirplane } from './character_states/vehicles/ExitingAirplane';
import { ICharacterAI } from '../interfaces/ICharacterAI';
import { World } from '../world/World';
import { IControllable } from '../interfaces/IControllable';
import { ICharacterState } from '../interfaces/ICharacterState';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { Vehicle } from '../vehicles/Vehicle';
import { CollisionGroups } from '../enums/CollisionGroups';
import { CapsuleCollider } from '../physics/colliders/CapsuleCollider';
import { VehicleEntryInstance } from './VehicleEntryInstance';
import { SeatType } from '../enums/SeatType';
import { GroundImpactData } from './GroundImpactData';
import { ClosestObjectFinder } from '../core/ClosestObjectFinder';
import { Object3D } from 'three';
import { EntityType } from '../enums/EntityType';
import { NameTag } from '../party/NameTag';
import { WeaponSpec, buildWeaponModel } from '../combat/Weapons';

export class Character extends THREE.Object3D implements IWorldEntity
{
	public updateOrder: number = 1;
	public entityType: EntityType = EntityType.Character;

	public height: number = 0;
	public tiltContainer: THREE.Group;
	public modelContainer: THREE.Group;
	public materials: THREE.Material[] = [];
	public mixer: THREE.AnimationMixer;
	public animations: any[];
	// Remembered so the party layer can tell everyone else what to play
	public currentAnimation: string;

	// Movement
	public acceleration: THREE.Vector3 = new THREE.Vector3();
	public velocity: THREE.Vector3 = new THREE.Vector3();
	public arcadeVelocityInfluence: THREE.Vector3 = new THREE.Vector3();
	public velocityTarget: THREE.Vector3 = new THREE.Vector3();
	public arcadeVelocityIsAdditive: boolean = false;

	public defaultVelocitySimulatorDamping: number = 0.8;
	public defaultVelocitySimulatorMass: number = 50;
	public velocitySimulator: VectorSpringSimulator;
	public moveSpeed: number = 4;
	public angularVelocity: number = 0;
	public orientation: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
	public orientationTarget: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
	public defaultRotationSimulatorDamping: number = 0.5;
	public defaultRotationSimulatorMass: number = 10;
	public rotationSimulator: RelativeSpringSimulator;
	public viewVector: THREE.Vector3;
	public actions: { [action: string]: KeyBinding };
	public characterCapsule: CapsuleCollider;
	
	// Ray casting
	public rayResult: CANNON.RaycastResult = new CANNON.RaycastResult();
	public rayHasHit: boolean = false;
	public rayCastLength: number = 0.57;
	public raySafeOffset: number = 0.03;
	public wantsToJump: boolean = false;
	public initJumpSpeed: number = -1;
	public groundImpactData: GroundImpactData = new GroundImpactData();
	public raycastBox: THREE.Mesh;
	
	public world: World;
	public charState: ICharacterState;
	public behaviour: ICharacterAI;
	
	// Vehicles
	public controlledObject: IControllable;
	public occupyingSeat: VehicleSeat = null;
	public vehicleEntryInstance: VehicleEntryInstance = null;
	
	public static readonly MAX_HEALTH: number = 100;
	/** How far a body has to come down to lie on the ground rather than over it. */
	private static readonly FALLEN_DROP: number = 0.49;

	// Combat
	public health: number = Character.MAX_HEALTH;
	public weapon: WeaponSpec;
	public ammo: number = 0;
	public reserve: number = 0;
	/** Set for anyone in a party, so hits can be addressed to their client. */
	public networkId: number;

	// Party
	public playerName: string;
	public playerColor: string;
	public nameTag: NameTag;
	
	private physicsEnabled: boolean = true;
	private originalColors: { [uuid: string]: THREE.Color } = {};
	private weaponModel: THREE.Object3D;
	private headTexture: THREE.Texture;
	private headCanvas: HTMLCanvasElement;

	/**
	 * Where "three.js" is printed on the boxman's face texture, measured off the
	 * image itself. The text sits below the smiley and reads upside down in the
	 * atlas, which is how it comes out the right way up on the model.
	 */
	private static readonly HEAD_LABEL = { x: 6, y: 470, w: 158, h: 38 };
	/** The cream the face plate is painted, sampled either side of the text. */
	private static readonly HEAD_PLATE: string = 'rgb(252, 252, 244)';

	constructor(gltf: any)
	{
		super();

		this.readCharacterData(gltf);
		this.setAnimations(gltf.animations);

		// The visuals group is centered for easy character tilting
		this.tiltContainer = new THREE.Group();
		this.add(this.tiltContainer);

		// Model container is used to reliably ground the character, as animation can alter the position of the model itself
		this.modelContainer = new THREE.Group();
		this.modelContainer.position.y = -0.57;
		this.tiltContainer.add(this.modelContainer);
		this.modelContainer.add(gltf.scene);

		this.mixer = new THREE.AnimationMixer(gltf.scene);

		this.velocitySimulator = new VectorSpringSimulator(60, this.defaultVelocitySimulatorMass, this.defaultVelocitySimulatorDamping);
		this.rotationSimulator = new RelativeSpringSimulator(60, this.defaultRotationSimulatorMass, this.defaultRotationSimulatorDamping);

		this.viewVector = new THREE.Vector3();

		// Actions
		this.actions = {
			'up': new KeyBinding('KeyW'),
			'down': new KeyBinding('KeyS'),
			'left': new KeyBinding('KeyA'),
			'right': new KeyBinding('KeyD'),
			'run': new KeyBinding('ShiftLeft'),
			'jump': new KeyBinding('Space'),
			'use': new KeyBinding('KeyE'),
			'enter': new KeyBinding('KeyF'),
			'enter_passenger': new KeyBinding('KeyG'),
			'seat_switch': new KeyBinding('KeyX'),
			'primary': new KeyBinding('Mouse0'),
			// DOM button 1 is the middle button; the right one is 2
			'secondary': new KeyBinding('Mouse2'),
		};

		// Physics
		// Player Capsule
		this.characterCapsule = new CapsuleCollider({
			mass: 1,
			position: new CANNON.Vec3(),
			height: 0.5,
			radius: 0.25,
			segments: 8,
			friction: 0.0
		});
		// capsulePhysics.physical.collisionFilterMask = ~CollisionGroups.Trimesh;
		this.characterCapsule.body.shapes.forEach((shape) => {
			// tslint:disable-next-line: no-bitwise
			shape.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
		});
		this.characterCapsule.body.allowSleep = false;

		// Move character to different collision group for raycasting
		this.characterCapsule.body.collisionFilterGroup = 2;

		// Disable character rotation
		this.characterCapsule.body.fixedRotation = true;
		this.characterCapsule.body.updateMassProperties();

		// Ray cast debug
		const boxGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
		const boxMat = new THREE.MeshLambertMaterial({
			color: 0xff0000
		});
		this.raycastBox = new THREE.Mesh(boxGeo, boxMat);
		this.raycastBox.visible = false;

		// Physics pre/post step callback bindings
		this.characterCapsule.body.preStep = (body: CANNON.Body) => { this.physicsPreStep(body, this); };
		this.characterCapsule.body.postStep = (body: CANNON.Body) => { this.physicsPostStep(body, this); };

		// States
		this.setState(new Idle(this));
	}

	public setAnimations(animations: []): void
	{
		this.animations = animations;
	}

	public setArcadeVelocityInfluence(x: number, y: number = x, z: number = x): void
	{
		this.arcadeVelocityInfluence.set(x, y, z);
	}

	public setViewVector(vector: THREE.Vector3): void
	{
		this.viewVector.copy(vector).normalize();
	}

	/**
	 * Set state to the player. Pass state class (function) name.
	 * @param {function} State 
	 */
	public setState(state: ICharacterState): void
	{
		this.charState = state;
		this.charState.onInputChange();
	}

	public setPosition(x: number, y: number, z: number): void
	{
		if (this.physicsEnabled)
		{
			this.characterCapsule.body.previousPosition = new CANNON.Vec3(x, y, z);
			this.characterCapsule.body.position = new CANNON.Vec3(x, y, z);
			this.characterCapsule.body.interpolatedPosition = new CANNON.Vec3(x, y, z);
		}
		else
		{
			this.position.x = x;
			this.position.y = y;
			this.position.z = z;
		}
	}

	public resetVelocity(): void
	{
		this.velocity.x = 0;
		this.velocity.y = 0;
		this.velocity.z = 0;

		this.characterCapsule.body.velocity.x = 0;
		this.characterCapsule.body.velocity.y = 0;
		this.characterCapsule.body.velocity.z = 0;

		this.velocitySimulator.init();
	}

	public setArcadeVelocityTarget(velZ: number, velX: number = 0, velY: number = 0): void
	{
		this.velocityTarget.z = velZ;
		this.velocityTarget.x = velX;
		this.velocityTarget.y = velY;
	}

	public setOrientation(vector: THREE.Vector3, instantly: boolean = false): void
	{
		let lookVector = new THREE.Vector3().copy(vector).setY(0).normalize();
		this.orientationTarget.copy(lookVector);
		
		if (instantly)
		{
			this.orientation.copy(lookVector);
		}
	}

	public resetOrientation(): void
	{
		const forward = Utils.getForward(this);
		this.setOrientation(forward, true);
	}

	public setBehaviour(behaviour: ICharacterAI): void
	{
		behaviour.character = this;
		this.behaviour = behaviour;
	}

	public setPhysicsEnabled(value: boolean): void {
		this.physicsEnabled = value;

		if (value === true)
		{
			this.world.physicsWorld.addBody(this.characterCapsule.body);
		}
		else
		{
			this.world.physicsWorld.remove(this.characterCapsule.body);
		}
	}

	/**
	 * Names and colours the character. The tag is parented to the model container,
	 * so it rides along into vehicles and hides itself in first person view.
	 */
	public setPlayerAppearance(name: string, color: string): void
	{
		this.playerName = name;
		this.playerColor = color;

		if (this.nameTag === undefined)
		{
			this.nameTag = new NameTag(name, color);
			this.modelContainer.add(this.nameTag);
		}
		else
		{
			this.nameTag.setText(name, color);
		}

		this.updateNameTagHeight();

		this.stampNameOnHead(name);
		this.setTint(color);

		// Recolour a vehicle already being driven
		if (this.controlledObject !== undefined)
		{
			(this.controlledObject as unknown as Vehicle).setPlayerTint(color);
		}
	}

	/**
	 * Paints the player's name over the "three.js" the boxman is shipped wearing.
	 *
	 * The face texture is redrawn into a canvas and handed back to the same
	 * three.js texture, so every setting the loader put on it survives. Each
	 * character parses its own copy of the model, so this only ever repaints the
	 * one head it belongs to.
	 */
	private stampNameOnHead(name: string): void
	{
		if (this.headCanvas === undefined && !this.captureHeadTexture()) return;

		const label = Character.HEAD_LABEL;
		let ctx = this.headCanvas.getContext('2d');

		// Back to bare plate, then the name where the printing used to be
		ctx.fillStyle = Character.HEAD_PLATE;
		ctx.fillRect(label.x, label.y, label.w, label.h);

		ctx.save();
		ctx.translate(label.x + label.w / 2, label.y + label.h / 2);
		ctx.rotate(Math.PI);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#2c2c2c';

		let size = 22;
		do
		{
			ctx.font = '700 ' + size + 'px Solway, Trebuchet MS, sans-serif';
			size--;
		}
		while (size > 8 && ctx.measureText(name).width > label.w - 12);

		ctx.fillText(name, 0, 0);
		ctx.restore();

		this.headTexture.needsUpdate = true;
	}

	/** Copies the loaded face texture onto a canvas the tag can be drawn into. */
	private captureHeadTexture(): boolean
	{
		let texture: THREE.Texture;
		this.materials.forEach((mat: any) =>
		{
			if (texture === undefined && mat.map !== undefined && mat.map !== null
				&& mat.map.image !== undefined && mat.map.image !== null)
			{
				texture = mat.map;
			}
		});

		if (texture === undefined) return false;

		let image = texture.image;
		if (!(image.width > 0) || !(image.height > 0)) return false;

		let canvas = document.createElement('canvas');
		canvas.width = image.width;
		canvas.height = image.height;
		canvas.getContext('2d').drawImage(image, 0, 0);

		// Same texture object, new source, so wrapping, flipY and encoding all stay
		// exactly as the glTF loader set them up
		texture.image = canvas;
		this.headTexture = texture;
		this.headCanvas = canvas;

		return true;
	}

	/**
	 * Model container sits 0.57 below the character origin, so that's the baseline.
	 * Sitting lifts the character, so the tag comes down to hug the vehicle roof.
	 */
	private updateNameTagHeight(): void
	{
		if (this.nameTag === undefined) return;

		this.nameTag.position.y = 0.57 + (this.occupyingSeat !== null ? 0.5 : 0.95);
	}

	/**
	 * Puts a gun in the character's right hand.
	 *
	 * Parented to the visuals rather than to the arm bone: the bone swings with
	 * every animation in the set, and pinning a gun to it convincingly would
	 * mean a hand tuned offset per clip.
	 */
	public equipWeapon(spec: WeaponSpec): void
	{
		this.unequipWeapon();

		this.weapon = spec;
		this.ammo = spec.magazine;
		this.reserve = spec.reserve;

		this.weaponModel = buildWeaponModel(spec);
		this.weaponModel.position.set(0.24, 0.1, 0.2);
		this.tiltContainer.add(this.weaponModel);
	}

	public unequipWeapon(): void
	{
		if (this.weaponModel !== undefined)
		{
			this.tiltContainer.remove(this.weaponModel);
			this.weaponModel = undefined;
		}

		this.weapon = undefined;
		this.ammo = 0;
		this.reserve = 0;
	}

	/** Where shots leave the gun, so flashes and tracers start at the barrel. */
	public getMuzzlePosition(): THREE.Vector3
	{
		let target = new THREE.Vector3();

		if (this.weaponModel !== undefined)
		{
			let muzzle = this.weaponModel.getObjectByName('muzzle');
			if (muzzle !== undefined) return muzzle.getWorldPosition(target);
		}

		return this.getWorldPosition(target).setY(this.position.y + 0.6);
	}

	public setTint(color: string): void
	{
		let target = new THREE.Color(color);

		this.materials.forEach((mat: any) =>
		{
			if (mat.color === undefined) return;

			if (this.originalColors[mat.uuid] === undefined)
			{
				this.originalColors[mat.uuid] = mat.color.clone();
			}

			mat.color.copy(target);
		});
	}

	public readCharacterData(gltf: any): void
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
		});
	}

	public handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void
	{
		if (this.health <= 0) return;

		if (this.controlledObject !== undefined)
		{
			this.controlledObject.handleKeyboardEvent(event, code, pressed);
		}
		else
		{
			// Free camera
			if (code === 'KeyC' && pressed === true && event.shiftKey === true)
			{
				this.resetControls();
				this.world.cameraOperator.characterCaller = this;
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
	}

	public handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void
	{
		if (this.health <= 0) return;

		if (this.controlledObject !== undefined)
		{
			this.controlledObject.handleMouseButton(event, code, pressed);
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

	public handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void
	{
		if (this.controlledObject !== undefined)
		{
			this.controlledObject.handleMouseMove(event, deltaX, deltaY);
		}
		else
		{
			this.world.cameraOperator.move(deltaX, deltaY);
		}
	}
	
	public handleMouseWheel(event: WheelEvent, value: number): void
	{
		if (this.controlledObject !== undefined)
		{
			this.controlledObject.handleMouseWheel(event, value);
		}
		else
		{
			this.world.scrollTheTimeScale(value);
		}
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

			// Tell player to handle states according to new input
			this.charState.onInputChange();

			// Reset the 'just' attributes
			action.justPressed = false;
			action.justReleased = false;
		}
	}

	public takeControl(): void
	{
		if (this.world !== undefined)
		{
			this.world.inputManager.setInputReceiver(this);

			// Whoever takes control is the local player, so they get the name and colour
			this.world.localCharacter = this;
			this.setPlayerAppearance(this.world.localPlayer.name, this.world.localPlayer.color);
		}
		else
		{
			console.warn('Attempting to take control of a character that doesn\'t belong to a world.');
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

	public update(timeStep: number): void
	{
		this.behaviour?.update(timeStep);
		this.vehicleEntryInstance?.update(timeStep);
		// console.log(this.occupyingSeat);
		this.charState?.update(timeStep);

		// this.visuals.position.copy(this.modelOffset);
		if (this.physicsEnabled) this.springMovement(timeStep);
		if (this.physicsEnabled) this.springRotation(timeStep);
		if (this.physicsEnabled) this.rotateModel();
		if (this.mixer !== undefined) this.mixer.update(timeStep);

		// Sync physics/graphics
		if (this.physicsEnabled)
		{
			this.position.set(
				this.characterCapsule.body.interpolatedPosition.x,
				this.characterCapsule.body.interpolatedPosition.y,
				this.characterCapsule.body.interpolatedPosition.z
			);
		}
		else {
			let newPos = new THREE.Vector3();
			this.getWorldPosition(newPos);

			this.characterCapsule.body.position.copy(Utils.cannonVector(newPos));
			this.characterCapsule.body.interpolatedPosition.copy(Utils.cannonVector(newPos));
		}

		this.updateDeathPose(timeStep);
		this.updateMatrixWorld();
	}

	/**
	 * Falls over when killed, and gets up on respawn.
	 *
	 * Not a ragdoll: the skeleton drives every animation in the set and handing
	 * it to the solver means a physics body per bone. Tipping the whole model
	 * over reads as death from any distance a fight happens at, and costs a
	 * rotation. The model container hangs below the tilt group, so laying that
	 * group down also lifts the body, and the offset brings it back to ground.
	 */
	private updateDeathPose(timeStep: number): void
	{
		let fallen = this.health <= 0 && this.occupyingSeat === null;
		if (!fallen && this.tiltContainer.rotation.x === 0) return;

		let ease = 1 - Math.exp(-9 * timeStep);

		this.tiltContainer.rotation.x = THREE.MathUtils.lerp(
			this.tiltContainer.rotation.x, fallen ? -Math.PI / 2 : 0, ease);

		// Taken off whatever the run cycle just wrote rather than eased on its own:
		// that runs first and rewrites the height every frame, so anything easing
		// towards a target here would start again from scratch each time
		let laid = this.tiltContainer.rotation.x / (-Math.PI / 2);
		this.tiltContainer.position.y -= laid * Character.FALLEN_DROP;

		// Close enough that the next frame of running would snap it back anyway
		if (!fallen && Math.abs(this.tiltContainer.rotation.x) < 0.001) this.tiltContainer.rotation.x = 0;
	}

	public inputReceiverInit(): void
	{
		if (this.controlledObject !== undefined)
		{
			this.controlledObject.inputReceiverInit();
			return;
		}

		this.world.cameraOperator.setRadius(1.6, true);
		this.world.cameraOperator.followMode = false;
		// this.world.dirLight.target = this;

		this.displayControls();
	}

	public displayControls(): void
	{
		this.world.updateControls([
			{
				keys: ['W', 'A', 'S', 'D'],
				desc: 'Movement'
			},
			{
				keys: ['Shift'],
				desc: 'Sprint'
			},
			{
				keys: ['Space'],
				desc: 'Jump'
			},
			{
				keys: ['F', 'or', 'G'],
				desc: 'Enter vehicle'
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

	public inputReceiverUpdate(timeStep: number): void
	{
		if (this.controlledObject !== undefined)
		{
			this.controlledObject.inputReceiverUpdate(timeStep);
		}
		else
		{
			// Look in camera's direction
			this.viewVector = new THREE.Vector3().subVectors(this.position, this.world.camera.position);
			this.getWorldPosition(this.world.cameraOperator.target);
		}
		
	}

	public setAnimation(clipName: string, fadeIn: number): number
	{
		if (this.mixer !== undefined)
		{
			// gltf
			let clip = THREE.AnimationClip.findByName( this.animations, clipName );

			let action = this.mixer.clipAction(clip);
			if (action === null)
			{
				console.error(`Animation ${clipName} not found!`);
				return 0;
			}

			this.mixer.stopAllAction();
			action.fadeIn(fadeIn);
			action.play();

			this.currentAnimation = clipName;

			return action.getClip().duration;
		}
	}

	public springMovement(timeStep: number): void
	{
		// Simulator
		this.velocitySimulator.target.copy(this.velocityTarget);
		this.velocitySimulator.simulate(timeStep);

		// Update values
		this.velocity.copy(this.velocitySimulator.position);
		this.acceleration.copy(this.velocitySimulator.velocity);
	}

	public springRotation(timeStep: number): void
	{
		// Spring rotation
		// Figure out angle between current and target orientation
		let angle = Utils.getSignedAngleBetweenVectors(this.orientation, this.orientationTarget);

		// Simulator
		this.rotationSimulator.target = angle;
		this.rotationSimulator.simulate(timeStep);
		let rot = this.rotationSimulator.position;

		// Updating values
		this.orientation.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
		this.angularVelocity = this.rotationSimulator.velocity;
	}

	public getLocalMovementDirection(): THREE.Vector3
	{
		const positiveX = this.actions.right.isPressed ? -1 : 0;
		const negativeX = this.actions.left.isPressed ? 1 : 0;
		const positiveZ = this.actions.up.isPressed ? 1 : 0;
		const negativeZ = this.actions.down.isPressed ? -1 : 0;

		return new THREE.Vector3(positiveX + negativeX, 0, positiveZ + negativeZ).normalize();
	}

	public getCameraRelativeMovementVector(): THREE.Vector3
	{
		const localDirection = this.getLocalMovementDirection();
		const flatViewVector = new THREE.Vector3(this.viewVector.x, 0, this.viewVector.z).normalize();

		return Utils.appplyVectorMatrixXZ(flatViewVector, localDirection);
	}

	public setCameraRelativeOrientationTarget(): void
	{
		if (this.vehicleEntryInstance === null)
		{
			let moveVector = this.getCameraRelativeMovementVector();
	
			if (moveVector.x === 0 && moveVector.y === 0 && moveVector.z === 0)
			{
				this.setOrientation(this.orientation);
			}
			else
			{
				this.setOrientation(moveVector);
			}
		}
	}

	public rotateModel(): void
	{
		this.lookAt(this.position.x + this.orientation.x, this.position.y + this.orientation.y, this.position.z + this.orientation.z);
		this.tiltContainer.rotation.z = (-this.angularVelocity * 2.3 * this.velocity.length());
		this.tiltContainer.position.setY((Math.cos(Math.abs(this.angularVelocity * 2.3 * this.velocity.length())) / 2) - 0.5);
	}

	public jump(initJumpSpeed: number = -1): void
	{
		this.wantsToJump = true;
		this.initJumpSpeed = initJumpSpeed;
	}

	public findVehicleToEnter(wantsToDrive: boolean): void
	{
		// reusable world position variable
		let worldPos = new THREE.Vector3();

		// Find best vehicle
		let vehicleFinder = new ClosestObjectFinder<Vehicle>(this.position, 10);
		this.world.vehicles.forEach((vehicle) =>
		{
			vehicleFinder.consider(vehicle, vehicle.position);
		});

		if (vehicleFinder.closestObject !== undefined)
		{
			let vehicle = vehicleFinder.closestObject;
			let vehicleEntryInstance = new VehicleEntryInstance(this);
			vehicleEntryInstance.wantsToDrive = wantsToDrive;

			// Find best seat
			let seatFinder = new ClosestObjectFinder<VehicleSeat>(this.position);
			for (const seat of vehicle.seats)
			{
				if (wantsToDrive)
				{
					// Consider driver seats
					if (seat.type === SeatType.Driver)
					{
						seat.seatPointObject.getWorldPosition(worldPos);
						seatFinder.consider(seat, worldPos);
					}
					// Consider passenger seats connected to driver seats
					else if (seat.type === SeatType.Passenger)
					{
						for (const connSeat of seat.connectedSeats)
						{
							if (connSeat.type === SeatType.Driver)
							{
								seat.seatPointObject.getWorldPosition(worldPos);
								seatFinder.consider(seat, worldPos);
								break;
							}
						}
					}
				}
				else
				{
					// Consider passenger seats
					if (seat.type === SeatType.Passenger)
					{
						seat.seatPointObject.getWorldPosition(worldPos);
						seatFinder.consider(seat, worldPos);
					}
				}
			}

			if (seatFinder.closestObject !== undefined)
			{
				let targetSeat = seatFinder.closestObject;
				vehicleEntryInstance.targetSeat = targetSeat;

				let entryPointFinder = new ClosestObjectFinder<Object3D>(this.position);

				for (const point of targetSeat.entryPoints) {
					point.getWorldPosition(worldPos);
					entryPointFinder.consider(point, worldPos);
				}

				if (entryPointFinder.closestObject !== undefined)
				{
					vehicleEntryInstance.entryPoint = entryPointFinder.closestObject;
					this.triggerAction('up', true);
					this.vehicleEntryInstance = vehicleEntryInstance;
				}
			}
		}
	}

	public enterVehicle(seat: VehicleSeat, entryPoint: THREE.Object3D): void
	{
		this.resetControls();

		if (seat.door?.rotation < 0.5)
		{
			this.setState(new OpenVehicleDoor(this, seat, entryPoint));
		}
		else
		{
			this.setState(new EnteringVehicle(this, seat, entryPoint));
		}
	}

	public teleportToVehicle(vehicle: Vehicle, seat: VehicleSeat): void
	{
		this.resetVelocity();
		this.rotateModel();
		this.setPhysicsEnabled(false);
		(vehicle as unknown as THREE.Object3D).attach(this);

		this.setPosition(seat.seatPointObject.position.x, seat.seatPointObject.position.y + 0.6, seat.seatPointObject.position.z);
		this.quaternion.copy(seat.seatPointObject.quaternion);

		this.occupySeat(seat);
		this.setState(new Driving(this, seat));

		this.startControllingVehicle(vehicle, seat);
	}

	public startControllingVehicle(vehicle: IControllable, seat: VehicleSeat): void
	{
		if (this.controlledObject !== vehicle)
		{
			this.transferControls(vehicle);
			this.resetControls();
	
			this.controlledObject = vehicle;
			this.controlledObject.allowSleep(false);
			vehicle.inputReceiverInit();
	
			vehicle.controllingCharacter = this;

			if (this.playerColor !== undefined)
			{
				(vehicle as unknown as Vehicle).setPlayerTint(this.playerColor);
			}
		}
	}

	public transferControls(entity: IControllable): void
	{
		// Currently running through all actions of this character and the vehicle,
		// comparing keycodes of actions and based on that triggering vehicle's actions
		// Maybe we should ask input manager what's the current state of the keyboard
		// and read those values... TODO
		for (const action1 in this.actions) {
			if (this.actions.hasOwnProperty(action1)) {
				for (const action2 in entity.actions) {
					if (entity.actions.hasOwnProperty(action2)) {

						let a1 = this.actions[action1];
						let a2 = entity.actions[action2];

						a1.eventCodes.forEach((code1) => {
							a2.eventCodes.forEach((code2) => {
								if (code1 === code2)
								{
									entity.triggerAction(action2, a1.isPressed);
								}
							});
						});
					}
				}
			}
		}
	}

	public stopControllingVehicle(): void
	{
		if (this.controlledObject?.controllingCharacter === this)
		{
			this.controlledObject.allowSleep(true);
			this.controlledObject.controllingCharacter = undefined;
			this.controlledObject.resetControls();
			(this.controlledObject as unknown as Vehicle).clearPlayerTint();
			this.controlledObject = undefined;
			this.inputReceiverInit();
		}
	}

	public exitVehicle(): void
	{
		if (this.occupyingSeat !== null)
		{
			if (this.occupyingSeat.vehicle.entityType === EntityType.Airplane)
			{
				this.setState(new ExitingAirplane(this, this.occupyingSeat));
			}
			else
			{
				this.setState(new ExitingVehicle(this, this.occupyingSeat));
			}
			
			this.stopControllingVehicle();
		}
	}

	public occupySeat(seat: VehicleSeat): void
	{
		this.occupyingSeat = seat;
		seat.occupiedBy = this;

		this.updateNameTagHeight();
	}

	public leaveSeat(): void
	{
		if (this.occupyingSeat !== null)
		{
			this.occupyingSeat.occupiedBy = null;
			this.occupyingSeat = null;

			this.updateNameTagHeight();
		}
	}

	public physicsPreStep(body: CANNON.Body, character: Character): void
	{
		character.feetRaycast();

		// Raycast debug
		if (character.rayHasHit)
		{
			if (character.raycastBox.visible) {
				character.raycastBox.position.x = character.rayResult.hitPointWorld.x;
				character.raycastBox.position.y = character.rayResult.hitPointWorld.y;
				character.raycastBox.position.z = character.rayResult.hitPointWorld.z;
			}
		}
		else
		{
			if (character.raycastBox.visible) {
				character.raycastBox.position.set(body.position.x, body.position.y - character.rayCastLength - character.raySafeOffset, body.position.z);
			}
		}
	}

	public feetRaycast(): void
	{
		// Player ray casting
		// Create ray
		let body = this.characterCapsule.body;
		const start = new CANNON.Vec3(body.position.x, body.position.y, body.position.z);
		const end = new CANNON.Vec3(body.position.x, body.position.y - this.rayCastLength - this.raySafeOffset, body.position.z);
		// Raycast options
		const rayCastOptions = {
			collisionFilterMask: CollisionGroups.Default,
			skipBackfaces: true      /* ignore back faces */
		};
		// Cast the ray
		this.rayHasHit = this.world.physicsWorld.raycastClosest(start, end, rayCastOptions, this.rayResult);
	}

	public physicsPostStep(body: CANNON.Body, character: Character): void
	{
		// Get velocities
		let simulatedVelocity = new THREE.Vector3(body.velocity.x, body.velocity.y, body.velocity.z);

		// Take local velocity
		let arcadeVelocity = new THREE.Vector3().copy(character.velocity).multiplyScalar(character.moveSpeed);
		// Turn local into global
		arcadeVelocity = Utils.appplyVectorMatrixXZ(character.orientation, arcadeVelocity);

		let newVelocity = new THREE.Vector3();

		// Additive velocity mode
		if (character.arcadeVelocityIsAdditive)
		{
			newVelocity.copy(simulatedVelocity);

			let globalVelocityTarget = Utils.appplyVectorMatrixXZ(character.orientation, character.velocityTarget);
			let add = new THREE.Vector3().copy(arcadeVelocity).multiply(character.arcadeVelocityInfluence);

			if (Math.abs(simulatedVelocity.x) < Math.abs(globalVelocityTarget.x * character.moveSpeed) || Utils.haveDifferentSigns(simulatedVelocity.x, arcadeVelocity.x)) { newVelocity.x += add.x; }
			if (Math.abs(simulatedVelocity.y) < Math.abs(globalVelocityTarget.y * character.moveSpeed) || Utils.haveDifferentSigns(simulatedVelocity.y, arcadeVelocity.y)) { newVelocity.y += add.y; }
			if (Math.abs(simulatedVelocity.z) < Math.abs(globalVelocityTarget.z * character.moveSpeed) || Utils.haveDifferentSigns(simulatedVelocity.z, arcadeVelocity.z)) { newVelocity.z += add.z; }
		}
		else
		{
			newVelocity = new THREE.Vector3(
				THREE.MathUtils.lerp(simulatedVelocity.x, arcadeVelocity.x, character.arcadeVelocityInfluence.x),
				THREE.MathUtils.lerp(simulatedVelocity.y, arcadeVelocity.y, character.arcadeVelocityInfluence.y),
				THREE.MathUtils.lerp(simulatedVelocity.z, arcadeVelocity.z, character.arcadeVelocityInfluence.z),
			);
		}

		// If we're hitting the ground, stick to ground
		if (character.rayHasHit)
		{
			// Flatten velocity
			newVelocity.y = 0;

			// Move on top of moving objects
			if (character.rayResult.body.mass > 0)
			{
				let pointVelocity = new CANNON.Vec3();
				character.rayResult.body.getVelocityAtWorldPoint(character.rayResult.hitPointWorld, pointVelocity);
				newVelocity.add(Utils.threeVector(pointVelocity));
			}

			// Measure the normal vector offset from direct "up" vector
			// and transform it into a matrix
			let up = new THREE.Vector3(0, 1, 0);
			let normal = new THREE.Vector3(character.rayResult.hitNormalWorld.x, character.rayResult.hitNormalWorld.y, character.rayResult.hitNormalWorld.z);
			let q = new THREE.Quaternion().setFromUnitVectors(up, normal);
			let m = new THREE.Matrix4().makeRotationFromQuaternion(q);

			// Rotate the velocity vector
			newVelocity.applyMatrix4(m);

			// Compensate for gravity
			// newVelocity.y -= body.world.physicsWorld.gravity.y / body.character.world.physicsFrameRate;

			// Apply velocity
			body.velocity.x = newVelocity.x;
			body.velocity.y = newVelocity.y;
			body.velocity.z = newVelocity.z;
			// Ground character
			body.position.y = character.rayResult.hitPointWorld.y + character.rayCastLength + (newVelocity.y / character.world.physicsFrameRate);
		}
		else
		{
			// If we're in air
			body.velocity.x = newVelocity.x;
			body.velocity.y = newVelocity.y;
			body.velocity.z = newVelocity.z;

			// Save last in-air information
			character.groundImpactData.velocity.x = body.velocity.x;
			character.groundImpactData.velocity.y = body.velocity.y;
			character.groundImpactData.velocity.z = body.velocity.z;
		}

		// Jumping
		if (character.wantsToJump)
		{
			// If initJumpSpeed is set
			if (character.initJumpSpeed > -1)
			{
				// Flatten velocity
				body.velocity.y = 0;
				let speed = Math.max(character.velocitySimulator.position.length() * 4, character.initJumpSpeed);
				body.velocity = Utils.cannonVector(character.orientation.clone().multiplyScalar(speed));
			}
			else {
				// Moving objects compensation
				let add = new CANNON.Vec3();
				character.rayResult.body.getVelocityAtWorldPoint(character.rayResult.hitPointWorld, add);
				body.velocity.vsub(add, body.velocity);
			}

			// Add positive vertical velocity 
			body.velocity.y += 4;
			// Move above ground by 2x safe offset value
			body.position.y += character.raySafeOffset * 2;
			// Reset flag
			character.wantsToJump = false;
		}
	}

	public addToWorld(world: World): void
	{
		if (_.includes(world.characters, this))
		{
			console.warn('Adding character to a world in which it already exists.');
		}
		else
		{
			// Set world
			this.world = world;

			// Register character
			world.characters.push(this);

			// Register physics
			world.physicsWorld.addBody(this.characterCapsule.body);

			// Add to graphicsWorld
			world.graphicsWorld.add(this);
			world.graphicsWorld.add(this.raycastBox);

			// Shadow cascades
			this.materials.forEach((mat) =>
			{
				world.sky.csm.setupMaterial(mat);
			});
		}
	}

	public removeFromWorld(world: World): void
	{
		if (!_.includes(world.characters, this))
		{
			console.warn('Removing character from a world in which it isn\'t present.');
		}
		else
		{
			if (world.inputManager.inputReceiver === this)
			{
				world.inputManager.inputReceiver = undefined;
			}

			this.world = undefined;

			// Remove from characters
			_.pull(world.characters, this);

			// Remove physics
			world.physicsWorld.remove(this.characterCapsule.body);

			// Remove visuals
			world.graphicsWorld.remove(this);
			world.graphicsWorld.remove(this.raycastBox);

			if (this.nameTag !== undefined)
			{
				this.modelContainer.remove(this.nameTag);
				this.nameTag.dispose();
				this.nameTag = undefined;
			}
		}
	}
}