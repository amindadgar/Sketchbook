import * as THREE from 'three';
import * as Utils from './FunctionLibrary';
import { World } from '../world/World';
import { IInputReceiver } from '../interfaces/IInputReceiver';
import { KeyBinding } from './KeyBinding';
import { Character } from '../characters/Character';
import _ = require('lodash');
import { IUpdatable } from '../interfaces/IUpdatable';

export class CameraOperator implements IInputReceiver, IUpdatable
{
	public updateOrder: number = 4;

	public world: World;
	public camera: THREE.Camera;
	public target: THREE.Vector3;
	public sensitivity: THREE.Vector2;
	public radius: number = 1;
	public theta: number;
	public phi: number;
	public onMouseDownPosition: THREE.Vector2;
	public onMouseDownTheta: any;
	public onMouseDownPhi: any;
	public targetRadius: number = 1;

	public movementSpeed: number;
	public actions: { [action: string]: KeyBinding };

	public upVelocity: number = 0;
	public forwardVelocity: number = 0;
	public rightVelocity: number = 0;

	public followMode: boolean = false;
	public autoCenter: boolean = false;
	public aiming: boolean = false;

	/** How close the camera pulls in over the shoulder, and how far it slides across. */
	private static readonly AIM_RADIUS: number = 1.5;
	private static readonly AIM_SHOULDER: number = 0.6;
	private static readonly AIM_FOV: number = 55;
	private aimBlend: number = 0;
	private static readonly BASE_FOV: number = 80;
	private static scratch: THREE.Vector3 = new THREE.Vector3();

	public characterCaller: Character;

	constructor(world: World, camera: THREE.Camera, sensitivityX: number = 1, sensitivityY: number = sensitivityX * 0.8)
	{
		this.world = world;
		this.camera = camera;
		this.target = new THREE.Vector3();
		this.sensitivity = new THREE.Vector2(sensitivityX, sensitivityY);

		this.movementSpeed = 0.06;
		this.radius = 3;
		this.theta = 0;
		this.phi = 0;

		this.onMouseDownPosition = new THREE.Vector2();
		this.onMouseDownTheta = this.theta;
		this.onMouseDownPhi = this.phi;

		this.actions = {
			'forward': new KeyBinding('KeyW'),
			'back': new KeyBinding('KeyS'),
			'left': new KeyBinding('KeyA'),
			'right': new KeyBinding('KeyD'),
			'up': new KeyBinding('KeyE'),
			'down': new KeyBinding('KeyQ'),
			'fast': new KeyBinding('ShiftLeft'),
		};

		world.registerUpdatable(this);
	}

	public setSensitivity(sensitivityX: number, sensitivityY: number = sensitivityX): void
	{
		this.sensitivity = new THREE.Vector2(sensitivityX, sensitivityY);
	}

	public setRadius(value: number, instantly: boolean = false): void
	{
		this.targetRadius = Math.max(0.001, value);
		if (instantly === true)
		{
			this.radius = value;
		}
	}

	public move(deltaX: number, deltaY: number): void
	{
		this.theta -= deltaX * (this.sensitivity.x / 2);
		this.theta %= 360;
		this.phi += deltaY * (this.sensitivity.y / 2);
		this.phi = Math.min(85, Math.max(-85, this.phi));
	}

	public update(timeScale: number): void
	{
		if (this.followMode === true)
		{
			this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, this.target.y, Number.POSITIVE_INFINITY);
			this.camera.lookAt(this.target);
			let newPos = this.target.clone().add(new THREE.Vector3().subVectors(this.camera.position, this.target).normalize().multiplyScalar(this.targetRadius));
			this.camera.position.x = newPos.x;
			this.camera.position.y = newPos.y;
			this.camera.position.z = newPos.z;
		}
		else 
		{
			if (this.autoCenter === true) this.centerBehindSubject();

			this.aimBlend = THREE.MathUtils.lerp(this.aimBlend, this.aiming ? 1 : 0, 0.18);
			this.applyAimFov();

			let wanted = THREE.MathUtils.lerp(this.targetRadius, CameraOperator.AIM_RADIUS, this.aimBlend);
			this.radius = THREE.MathUtils.lerp(this.radius, wanted, 0.1);

			let theta = this.theta * Math.PI / 180;
			let phi = this.phi * Math.PI / 180;

			// Aiming slides the view sideways so the character isn't standing where
			// the crosshair is. Perpendicular to the camera offset, so it moves across
			// the screen rather than toward or away from the player.
			let shoulder = CameraOperator.AIM_SHOULDER * this.aimBlend;
			let aimTarget = CameraOperator.scratch.set(
				this.target.x + Math.cos(theta) * shoulder,
				this.target.y,
				this.target.z - Math.sin(theta) * shoulder
			);

			this.camera.position.x = aimTarget.x + this.radius * Math.sin(theta) * Math.cos(phi);
			this.camera.position.y = aimTarget.y + this.radius * Math.sin(phi);
			this.camera.position.z = aimTarget.z + this.radius * Math.cos(theta) * Math.cos(phi);
			this.camera.updateMatrix();
			this.camera.lookAt(aimTarget);
		}
	}

	/**
	 * Swings the orbit angle around to sit behind whatever the player is steering,
	 * their character on foot or their vehicle while driving. Pitch is left alone,
	 * so whatever camera height they picked survives being centred.
	 */
	/** Narrows the view while aiming, which reads as zoom without moving the camera. */
	private applyAimFov(): void
	{
		let camera = this.camera as THREE.PerspectiveCamera;
		if (camera.isPerspectiveCamera !== true) return;

		let wanted = THREE.MathUtils.lerp(CameraOperator.BASE_FOV, CameraOperator.AIM_FOV, this.aimBlend);
		if (Math.abs(camera.fov - wanted) < 0.01) return;

		camera.fov = wanted;
		camera.updateProjectionMatrix();
	}

	private centerBehindSubject(): void
	{
		// In free camera this operator is the input receiver and the target is the
		// camera itself, so there's nothing meaningful to sit behind
		if (this.world.inputManager.inputReceiver === this) return;

		let character = this.world.localCharacter;
		if (character === undefined) return;

		let subject: THREE.Object3D = character;
		if (character.occupyingSeat !== null)
		{
			subject = character.occupyingSeat.vehicle as unknown as THREE.Object3D;
		}

		let subjectQuaternion = new THREE.Quaternion();
		subject.getWorldQuaternion(subjectQuaternion);
		let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(subjectQuaternion);

		// The camera belongs opposite the way the subject faces
		let targetTheta = Math.atan2(-forward.x, -forward.z) * 180 / Math.PI;

		// Shortest way round, so it never swings the long way past 180 degrees
		let delta = ((((targetTheta - this.theta) % 360) + 540) % 360) - 180;
		this.theta += delta * 0.1;
	}

	public handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void
	{
		// Free camera
		if (code === 'KeyC' && pressed === true && event.shiftKey === true)
		{
			if (this.characterCaller !== undefined)
			{
				this.world.inputManager.setInputReceiver(this.characterCaller);
				this.characterCaller = undefined;
			}
		}
		else
		{
			for (const action in this.actions) {
				if (this.actions.hasOwnProperty(action)) {
					const binding = this.actions[action];
	
					if (_.includes(binding.eventCodes, code))
					{
						binding.isPressed = pressed;
					}
				}
			}
		}
	}

	public handleMouseWheel(event: WheelEvent, value: number): void
	{
		this.world.scrollTheTimeScale(value);
	}

	public handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void
	{
		for (const action in this.actions) {
			if (this.actions.hasOwnProperty(action)) {
				const binding = this.actions[action];

				if (_.includes(binding.eventCodes, code))
				{
					binding.isPressed = pressed;
				}
			}
		}
	}

	public handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void
	{
		this.move(deltaX, deltaY);
	}

	public inputReceiverInit(): void
	{
		this.target.copy(this.camera.position);
		this.setRadius(0, true);
		// this.world.dirLight.target = this.world.camera;

		this.world.updateControls([
			{
				keys: ['W', 'S', 'A', 'D'],
				desc: 'Move around'
			},
			{
				keys: ['E', 'Q'],
				desc: 'Move up / down'
			},
			{
				keys: ['Shift'],
				desc: 'Speed up'
			},
			{
				keys: ['Shift', '+', 'C'],
				desc: 'Exit free camera mode'
			},
		]);
	}

	public inputReceiverUpdate(timeStep: number): void
	{
		// Set fly speed
		let speed = this.movementSpeed * (this.actions.fast.isPressed ? timeStep * 600 : timeStep * 60);

		const up = Utils.getUp(this.camera);
		const right = Utils.getRight(this.camera);
		const forward = Utils.getBack(this.camera);

		this.upVelocity = THREE.MathUtils.lerp(this.upVelocity, +this.actions.up.isPressed - +this.actions.down.isPressed, 0.3);
		this.forwardVelocity = THREE.MathUtils.lerp(this.forwardVelocity, +this.actions.forward.isPressed - +this.actions.back.isPressed, 0.3);
		this.rightVelocity = THREE.MathUtils.lerp(this.rightVelocity, +this.actions.right.isPressed - +this.actions.left.isPressed, 0.3);

		this.target.add(up.multiplyScalar(speed * this.upVelocity));
		this.target.add(forward.multiplyScalar(speed * this.forwardVelocity));
		this.target.add(right.multiplyScalar(speed * this.rightVelocity));
	}
}