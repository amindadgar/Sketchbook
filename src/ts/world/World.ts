import * as THREE from 'three';
import * as CANNON from 'cannon';
import Swal from 'sweetalert2';
import * as $ from 'jquery';

import { CameraOperator } from '../core/CameraOperator';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { FXAAShader  } from 'three/examples/jsm/shaders/FXAAShader';

import { Detector } from '../../lib/utils/Detector';
import { Stats } from '../../lib/utils/Stats';
import * as GUI from '../../lib/utils/dat.gui';
import { CannonDebugRenderer } from '../../lib/cannon/CannonDebugRenderer';
import * as _ from 'lodash';

import { InputManager } from '../core/InputManager';
import * as Utils from '../core/FunctionLibrary';
import { LoadingManager } from '../core/LoadingManager';
import { InfoStack } from '../core/InfoStack';
import { UIManager } from '../core/UIManager';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Character } from '../characters/Character';
import { Path } from './Path';
import { CollisionGroups } from '../enums/CollisionGroups';
import { EntityType } from '../enums/EntityType';
import { BoxCollider } from '../physics/colliders/BoxCollider';
import { TrimeshCollider } from '../physics/colliders/TrimeshCollider';
import { Vehicle } from '../vehicles/Vehicle';
import { Scenario } from './Scenario';
import { CharacterSpawnPoint } from './CharacterSpawnPoint';
import { VehicleSpawnPoint } from './VehicleSpawnPoint';
import { Sky } from './Sky';
import { Ocean } from './Ocean';
import { PlayerIdentity } from '../party/PlayerIdentity';
import { PartyMenu } from '../party/PartyMenu';
import { PartySession } from '../party/PartySession';
import { Minimap } from '../core/Minimap';
import { TouchControls } from '../core/TouchControls';
import { DeviceProfile } from '../core/DeviceProfile';
import { Effects } from '../core/Effects';
import { RaceSystem } from '../race/RaceSystem';
import { Chat } from '../party/Chat';
import { Leaderboard } from '../party/Leaderboard';
import { CombatSystem } from '../combat/CombatSystem';

export class World
{
	public renderer: THREE.WebGLRenderer;
	public camera: THREE.PerspectiveCamera;
	public composer: any;
	public stats: Stats;
	public graphicsWorld: THREE.Scene;
	public sky: Sky;
	public physicsWorld: CANNON.World;
	public parallelPairs: any[];
	public physicsFrameRate: number;
	public physicsFrameTime: number;
	public physicsMaxPrediction: number;
	public clock: THREE.Clock;
	public renderDelta: number;
	public logicDelta: number;
	public requestDelta: number;
	public sinceLastFrame: number;
	public justRendered: boolean;
	public params: any;
	public inputManager: InputManager;
	public cameraOperator: CameraOperator;
	public timeScaleTarget: number = 1;
	public console: InfoStack;
	public cannonDebugRenderer: CannonDebugRenderer;
	public scenarios: Scenario[] = [];
	public characters: Character[] = [];
	public vehicles: Vehicle[] = [];
	public paths: Path[] = [];
	public scenarioGUIFolder: any;
	public updatables: IUpdatable[] = [];
	public audioListener: THREE.AudioListener;
	public music: THREE.Audio;
	public musicElement: HTMLAudioElement;
	public localPlayer: PlayerIdentity = PlayerIdentity.load();
	public localCharacter: Character;
	public party: PartySession;
	public combat: CombatSystem;
	public effects: Effects;
	public race: RaceSystem;
	public chat: Chat;
	public leaderboard: Leaderboard;
	public minimap: Minimap;
	public touchControls: TouchControls;
	public lastScenarioID: string;

	/**
	 * The playable area, used both to respawn anything that leaves it and to
	 * frame the minimap. Measured from this world file.
	 */
	public worldBounds = {
		minX: -211.882,
		maxX: 211.882,
		minZ: -169.098,
		maxZ: 153.232,
		seaLevel: 14.989,
		floor: 0.107
	};


	private speedometerFill: number = 0;
	private fxaaPass: any;
	private boundResumeAudio: (evt: any) => void;

	constructor(worldScenePath?: any)
	{
		const scope = this;

		// WebGL not supported
		if (!Detector.webgl)
		{
			Swal.fire({
				icon: 'warning',
				title: 'WebGL compatibility',
				text: 'This browser doesn\'t seem to have the required WebGL capabilities. The application may not work correctly.',
				footer: '<a href="https://get.webgl.org/" target="_blank">Click here for more information</a>',
				showConfirmButton: false,
				buttonsStyling: false
			});
		}

		// Renderer
		this.renderer = new THREE.WebGLRenderer();
		this.renderer.setPixelRatio(DeviceProfile.pixelRatio());
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.0;
		this.renderer.shadowMap.enabled = true;
		// Soft shadows cost several taps a fragment, which a phone can't spare
		this.renderer.shadowMap.type = DeviceProfile.isTouch() ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

		this.generateHTML();

		// Both are listened for, but neither is trusted: see syncViewportSize
		window.addEventListener('resize', () => this.applyViewportSize(), false);
		window.addEventListener('orientationchange', () => this.applyViewportSize(), false);

		// Three.js scene
		this.graphicsWorld = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1010);

		// Passes
		let renderPass = new RenderPass( this.graphicsWorld, this.camera );
		let fxaaPass = new ShaderPass( FXAAShader );
		this.fxaaPass = fxaaPass;

		// FXAA
		let pixelRatio = this.renderer.getPixelRatio();
		fxaaPass.material['uniforms'].resolution.value.x = 1 / ( window.innerWidth * pixelRatio );
		fxaaPass.material['uniforms'].resolution.value.y = 1 / ( window.innerHeight * pixelRatio );

		// Composer
		this.composer = new EffectComposer( this.renderer );
		this.composer.addPass( renderPass );
		this.composer.addPass( fxaaPass );

		// Physics
		this.physicsWorld = new CANNON.World();
		this.physicsWorld.gravity.set(0, -9.81, 0);
		this.physicsWorld.broadphase = new CANNON.SAPBroadphase(this.physicsWorld);
		this.physicsWorld.solver.iterations = 10;
		this.physicsWorld.allowSleep = true;

		this.parallelPairs = [];
		this.physicsFrameRate = 60;
		this.physicsFrameTime = 1 / this.physicsFrameRate;
		this.physicsMaxPrediction = this.physicsFrameRate;

		// RenderLoop
		this.clock = new THREE.Clock();
		this.renderDelta = 0;
		this.logicDelta = 0;
		this.sinceLastFrame = 0;
		this.justRendered = false;

		// Stats (FPS, Frame time, Memory)
		this.stats = Stats();
		// Create right panel GUI
		this.createParamsGUI(scope);

		// Audio
		this.setupAudio();

		// Shared by everything that puts something on screen for half a second
		this.effects = new Effects(this);

		// Multiplayer, idle until a party is actually started
		this.party = new PartySession(this);
		this.combat = new CombatSystem(this);
		this.race = new RaceSystem(this);
		this.chat = new Chat(this);
		this.leaderboard = new Leaderboard(this);

		// Initialization
		this.inputManager = new InputManager(this, this.renderer.domElement);
		this.cameraOperator = new CameraOperator(this, this.camera, this.params.Mouse_Sensitivity);
		this.sky = new Sky(this);

		// Only on devices whose primary pointer is a finger. Desktop never
		// constructs this, so nothing about it changes.
		if (TouchControls.isTouchDevice()) this.touchControls = new TouchControls(this);
		
		// Load scene if path is supplied
		if (worldScenePath !== undefined)
		{
			let loadingManager = new LoadingManager(this);
			loadingManager.onFinishedCallback = () =>
			{
				this.update(1, 1);
				this.setTimeScale(1);
	
				// Snapshot the world from overhead now that everything is in place
				this.minimap = new Minimap(this);
				this.minimap.capture();
	
				PartyMenu.show({
					identity: this.localPlayer,
					onPlay: () =>
					{
						this.applyLocalIdentity();
						this.resumeAudio();
						UIManager.setUserInterfaceVisible(true);
					},
					onHost: (url) => this.party.host(url, this.localPlayer),
					onJoin: (url, code) => this.party.join(url, code, this.localPlayer)
				});
			};
			loadingManager.loadGLTF(worldScenePath, (gltf) =>
				{
					this.loadScene(loadingManager, gltf);
				}
			);
		}
		else
		{
			UIManager.setUserInterfaceVisible(true);
			UIManager.setLoadingScreenVisible(false);
			Swal.fire({
				icon: 'success',
				title: 'Hello world!',
				text: 'Empty Sketchbook world was succesfully initialized. Enjoy the blueness of the sky.',
				buttonsStyling: false
			});
		}

		this.render(this);
	}

	// Update
	// Handles all logic updates.
	public update(timeStep: number, unscaledTimeStep: number): void
	{
		this.updatePhysics(timeStep);

		// Update registred objects
		this.updatables.forEach((entity) => {
			entity.update(timeStep, unscaledTimeStep);
		});

		// Lerp time scale
		this.params.Time_Scale = THREE.MathUtils.lerp(this.params.Time_Scale, this.timeScaleTarget, 0.2);

		this.updateSpeedometer();

		// The touch buttons say something different in a car than on foot
		if (this.touchControls !== undefined) this.touchControls.update();

		this.chat.update(unscaledTimeStep);

		// Physics debug
		if (this.params.Debug_Physics) this.cannonDebugRenderer.update();
	}

	public updatePhysics(timeStep: number): void
	{
		// Step the physics world
		this.physicsWorld.step(this.physicsFrameTime, timeStep);

		this.characters.forEach((char) => {
			if (this.isOutOfBounds(char.characterCapsule.body.position))
			{
				this.outOfBoundsRespawn(char.characterCapsule.body);
			}
		});

		this.vehicles.forEach((vehicle) => {
			if (this.isOutOfBounds(vehicle.rayCastVehicle.chassisBody.position))
			{
				let worldPos = new THREE.Vector3();
				vehicle.spawnPoint.getWorldPosition(worldPos);
				worldPos.y += 1;
				this.outOfBoundsRespawn(vehicle.rayCastVehicle.chassisBody, Utils.cannonVector(worldPos));
			}
		});
	}

	public isOutOfBounds(position: CANNON.Vec3): boolean
	{
		let bounds = this.worldBounds;

		let inside = position.x > bounds.minX && position.x < bounds.maxX &&
					position.z > bounds.minZ && position.z < bounds.maxZ &&
					position.y > bounds.floor;
		let belowSeaLevel = position.y < bounds.seaLevel;

		return !inside && belowSeaLevel;
	}

	public outOfBoundsRespawn(body: CANNON.Body, position?: CANNON.Vec3): void
	{
		let newPos = position || new CANNON.Vec3(0, 16, 0);
		let newQuat = new CANNON.Quaternion(0, 0, 0, 1);

		body.position.copy(newPos);
		body.interpolatedPosition.copy(newPos);
		body.quaternion.copy(newQuat);
		body.interpolatedQuaternion.copy(newQuat);
		body.velocity.setZero();
		body.angularVelocity.setZero();
	}

	/**
	 * Rendering loop.
	 * Implements fps limiter and frame-skipping
	 * Calls world's "update" function before rendering.
	 * @param {World} world 
	 */
	/**
	 * iOS in standalone doesn't reliably fire resize when the device is turned,
	 * which leaves the canvas at its portrait size with the page showing through
	 * the rest of the screen. Rather than trust any single event to arrive, the
	 * render loop notices the window no longer matches and puts it right. Two
	 * comparisons a frame, and it can't be missed.
	 */
	private syncViewportSize(): void
	{
		// Compares the drawing buffer itself rather than what was last applied,
		// so it corrects a mismatch however it arose. Reading canvas.width is an
		// attribute, not a measurement, so it costs no layout.
		let canvas = this.renderer.domElement;
		let ratio = this.renderer.getPixelRatio();

		if (canvas.width === Math.floor(window.innerWidth * ratio)
			&& canvas.height === Math.floor(window.innerHeight * ratio)) return;

		this.applyViewportSize();
	}

	public applyViewportSize(): void
	{
		// A resize can arrive before the constructor has finished building these
		if (this.camera === undefined || this.composer === undefined) return;

		let width = window.innerWidth;
		let height = window.innerHeight;
		let pixelRatio = this.renderer.getPixelRatio();

		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height);

		if (this.fxaaPass !== undefined)
		{
			this.fxaaPass.uniforms['resolution'].value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
		}

		this.composer.setSize(width * pixelRatio, height * pixelRatio);
	}

	public render(world: World): void
	{
		this.syncViewportSize();

		this.requestDelta = this.clock.getDelta();

		requestAnimationFrame(() =>
		{
			world.render(world);
		});

		// Getting timeStep
		let unscaledTimeStep = (this.requestDelta + this.renderDelta + this.logicDelta) ;
		let timeStep = unscaledTimeStep * this.params.Time_Scale;
		timeStep = Math.min(timeStep, 1 / 30);    // min 30 fps

		// Logic
		world.update(timeStep, unscaledTimeStep);

		// Measuring logic time
		this.logicDelta = this.clock.getDelta();

		// Frame limiting
		let interval = 1 / 60;
		this.sinceLastFrame += this.requestDelta + this.renderDelta + this.logicDelta;
		this.sinceLastFrame %= interval;

		// Stats end
		this.stats.end();
		this.stats.begin();

		// Actual rendering with a FXAA ON/OFF switch
		if (this.params.FXAA) this.composer.render();
		else this.renderer.render(this.graphicsWorld, this.camera);

		// Measuring render time
		this.renderDelta = this.clock.getDelta();
	}

	/**
	 * The car the local player is driving, if any. While driving, the character
	 * stays the input receiver and forwards input to the vehicle, so the car has
	 * to be reached through it rather than read off the receiver directly.
	 */
	private getLocallyDrivenCar(): any
	{
		let receiver = this.inputManager.inputReceiver as any;
		if (receiver === undefined) return undefined;

		if (receiver.entityType === EntityType.Car) return receiver;

		let controlled = receiver.controlledObject;
		if (controlled !== undefined && controlled.entityType === EntityType.Car) return controlled;

		return undefined;
	}

	/**
	 * Shows the speed bar only while the local player is at the wheel of a car,
	 * and eases the fill so it climbs rather than snapping.
	 */
	private updateSpeedometer(): void
	{
		let car = this.getLocallyDrivenCar();
		let driving = car !== undefined;

		if (driving)
		{
			let target = THREE.MathUtils.clamp(Math.abs(car.speed) / car.topSpeed, 0, 1);
			this.speedometerFill = THREE.MathUtils.lerp(this.speedometerFill, target, 0.12);
		}
		else if (this.speedometerFill === 0)
		{
			return;
		}
		else
		{
			this.speedometerFill = 0;
		}

		UIManager.setSpeedometerVisible(driving);
		// The units are invented, but a number that moves reads better than a
		// bar at the size a phone can spare for it
		UIManager.setSpeedometerFill(this.speedometerFill, driving ? Math.abs(car.speed) * 10 : 0);
	}

	/**
	 * Pushes the current name and colour onto the character the player controls.
	 * Called after the menu closes, since the character spawns before that.
	 */
	public applyLocalIdentity(): void
	{
		if (this.localCharacter !== undefined)
		{
			this.localCharacter.setPlayerAppearance(this.localPlayer.name, this.localPlayer.color, this.localPlayer.hat);
		}

		// Solo has a scoreboard too, it just has one row on it
		this.party.refreshScoreboard();
	}

	public setTimeScale(value: number): void
	{
		this.params.Time_Scale = value;
		this.timeScaleTarget = value;
	}

	/**
	 * Starts the audio context and the music track.
	 * Browsers keep audio suspended until the user interacts with the page,
	 * so this runs on the first click or key press, whichever comes first.
	 */
	/** Bound to M. */
	public toggleMusic(): void
	{
		this.params.Mute_Music = !this.params.Mute_Music;
		this.applyMusicVolume();
	}

	/** Bound to L. */
	public toggleLeaderboard(): void
	{
		this.leaderboard.toggle();
	}

	/** Bound to C. */
	public toggleCameraCentering(): void
	{
		this.params.Center_Camera = !this.params.Center_Camera;
		this.cameraOperator.autoCenter = this.params.Center_Camera;
	}

	public applyMusicVolume(): void
	{
		if (this.music !== undefined)
		{
			this.music.setVolume(this.params.Mute_Music ? 0 : this.params.Music_Volume);
		}
	}

	public resumeAudio(): void
	{
		let context: any = this.audioListener.context;

		// Safari wants a sound actually started inside the gesture, not merely a
		// resume call, before it will let anything else through
		this.nudgeAudioContext(context);

		if (context.state !== 'running')
		{
			let request: any = context.resume();
			if (request !== undefined && request.then !== undefined)
			{
				request.then(() => this.releaseAudioUnlock()).catch(() => undefined);
			}
		}

		if (this.musicElement.paused)
		{
			let musicRequest: any = this.musicElement.play();
			if (musicRequest !== undefined)
			{
				// Missing file, or a browser that still refuses to play
				musicRequest.catch(() => undefined);
			}
		}

		this.releaseAudioUnlock();
	}

	/**
	 * Stops listening only once the context is genuinely running.
	 *
	 * This used to unhook on the first attempt whether or not it worked, so a
	 * single refused resume, which is what happens when the call doesn't land
	 * inside a real gesture, left the game silent for the rest of the session
	 * with nothing left listening to try again.
	 */
	private releaseAudioUnlock(): void
	{
		if (this.audioListener.context.state !== 'running') return;

		document.removeEventListener('click', this.boundResumeAudio, false);
		document.removeEventListener('keydown', this.boundResumeAudio, false);
		document.removeEventListener('touchend', this.boundResumeAudio, false);
	}

	/** Puts the gesture listeners back, for when a context is lost after unlocking. */
	private listenForAudioUnlock(): void
	{
		document.addEventListener('click', this.boundResumeAudio, false);
		document.addEventListener('keydown', this.boundResumeAudio, false);
		document.addEventListener('touchend', this.boundResumeAudio, false);
	}

	/** A silent one sample buffer, which is what actually unlocks iOS. */
	private nudgeAudioContext(context: any): void
	{
		try
		{
			let source = context.createBufferSource();
			source.buffer = context.createBuffer(1, 1, 22050);
			source.connect(context.destination);
			source.start(0);
		}
		catch (error)
		{
			// Nothing to do; the resume below is the other half of the attempt
		}
	}

	public add(worldEntity: IWorldEntity): void
	{
		worldEntity.addToWorld(this);
		this.registerUpdatable(worldEntity);
	}

	public registerUpdatable(registree: IUpdatable): void
	{
		this.updatables.push(registree);
		this.updatables.sort((a, b) => (a.updateOrder > b.updateOrder) ? 1 : -1);
	}

	public remove(worldEntity: IWorldEntity): void
	{
		worldEntity.removeFromWorld(this);
		this.unregisterUpdatable(worldEntity);
	}

	public unregisterUpdatable(registree: IUpdatable): void
	{
		_.pull(this.updatables, registree);
	}

	public loadScene(loadingManager: LoadingManager, gltf: any): void
	{
		gltf.scene.traverse((child) => {
			if (child.hasOwnProperty('userData'))
			{
				if (child.type === 'Mesh')
				{
					Utils.setupMeshProperties(child);
					this.sky.csm.setupMaterial(child.material);

					if (child.material.name === 'ocean')
					{
						this.registerUpdatable(new Ocean(child, this));
					}
				}

				if (child.userData.hasOwnProperty('data'))
				{
					if (child.userData.data === 'physics')
					{
						if (child.userData.hasOwnProperty('type')) 
						{
							// Convex doesn't work! Stick to boxes!
							if (child.userData.type === 'box')
							{
								let phys = new BoxCollider({size: new THREE.Vector3(child.scale.x, child.scale.y, child.scale.z)});
								phys.body.position.copy(Utils.cannonVector(child.position));
								phys.body.quaternion.copy(Utils.cannonQuat(child.quaternion));
								phys.body.computeAABB();

								phys.body.shapes.forEach((shape) => {
									shape.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
								});

								this.physicsWorld.addBody(phys.body);
							}
							else if (child.userData.type === 'trimesh')
							{
								let phys = new TrimeshCollider(child, {});
								this.physicsWorld.addBody(phys.body);
							}

							child.visible = false;
						}
					}

					if (child.userData.data === 'path')
					{
						this.paths.push(new Path(child));
					}

					if (child.userData.data === 'scenario')
					{
						this.scenarios.push(new Scenario(child, this));
					}
				}
			}
		});

		this.graphicsWorld.add(gltf.scene);

		this.createMergedScenario(gltf);
		this.prepareCombat(gltf);

		// Launch default scenario
		let defaultScenarioID: string;
		for (const scenario of this.scenarios) {
			if (scenario.default) {
				defaultScenarioID = scenario.id;
				break;
			}
		}
		if (defaultScenarioID !== undefined) this.launchScenario(defaultScenarioID, loadingManager);
	}
	
	/**
	 * Adds a scenario with a car, a helicopter and an aeroplane all within reach.
	 *
	 * The world file has no such spot. Free roam (default) starts you with cars
	 * 4m away but the nearest helicopter 128m and aeroplane 141m off, and Free
	 * roam (aviation) is the mirror image, aircraft on the doorstep and the
	 * nearest car 149m away.
	 *
	 * The air vehicles scenario spawns always, so the aircraft are already
	 * parked at the airfield. Starting the player there and parking one extra
	 * car beside them is all it takes to put all three types within seconds of
	 * each other, without inventing positions that might land in scenery.
	 */
	/**
	 * Scatters weapon pickups and works out where the dead come back.
	 *
	 * Spawn points are reused as the anchors rather than inventing positions:
	 * they're known good ground, spread across the map, and a gun dropped at an
	 * arbitrary coordinate could end up inside a wall or under the sea.
	 */
	private prepareCombat(gltf: any): void
	{
		gltf.scene.updateMatrixWorld(true);

		let spawns: THREE.Vector3[] = [];
		let playerSpawns: THREE.Vector3[] = [];

		gltf.scene.traverse((child: THREE.Object3D) =>
		{
			if (child.userData === undefined || child.userData.data !== 'spawn') return;

			let position = child.getWorldPosition(new THREE.Vector3());
			spawns.push(position);

			if (child.userData.type === 'player') playerSpawns.push(position);
		});

		// Thinned out, so a car park with six starting grids doesn't get six guns
		let anchors: THREE.Vector3[] = [];
		for (const candidate of spawns)
		{
			if (anchors.length >= 12) break;

			let clear = true;
			for (const chosen of anchors)
			{
				if (chosen.distanceTo(candidate) < 35) { clear = false; break; }
			}

			if (clear) anchors.push(candidate);
		}

		this.combat.setRespawnPoints(playerSpawns.length > 0 ? playerSpawns : anchors);
		this.combat.placePickups(anchors);
	}

	private createMergedScenario(gltf: any): void
	{
		// Spawn points are read in world space, and nothing has rendered yet
		gltf.scene.updateMatrixWorld(true);

		let playerSpawns: THREE.Object3D[] = [];
		let airplaneSpawns: THREE.Object3D[] = [];

		gltf.scene.traverse((child: THREE.Object3D) =>
		{
			if (child.userData !== undefined && child.userData.data === 'spawn')
			{
				if (child.userData.type === 'player') playerSpawns.push(child);
				else if (child.userData.type === 'airplane') airplaneSpawns.push(child);
			}
		});

		if (playerSpawns.length === 0 || airplaneSpawns.length === 0)
		{
			console.warn('Couldn\'t build the merged scenario, the world has no player or airplane spawns.');
			return;
		}

		// Whichever player start is nearest an aeroplane is the airfield. That's
		// the open end of the map, with room to park a car in the clear.
		let start: THREE.Object3D;
		let aircraft: THREE.Object3D;
		let shortest = Number.POSITIVE_INFINITY;

		playerSpawns.forEach((player) =>
		{
			airplaneSpawns.forEach((airplane) =>
			{
				let distance = player.getWorldPosition(new THREE.Vector3())
					.distanceTo(airplane.getWorldPosition(new THREE.Vector3()));

				if (distance < shortest)
				{
					shortest = distance;
					start = player;
					aircraft = airplane;
				}
			});
		});

		let root = new THREE.Object3D();
		root.name = 'everything';
		root.userData = {
			data: 'scenario',
			name: 'Free roam (everything)',
			desc_title: 'Free roam (everything)',
			desc_content: 'A car, a helicopter and an aeroplane, all parked within a few seconds of each other.',
			camera_angle: 0
		};

		let scenario = new Scenario(root, this);
		scenario.addSpawnPoint(new CharacterSpawnPoint(start));
		scenario.addSpawnPoint(this.createVehicleSpawnBetween(start, aircraft, 'car', 8));

		this.scenarios.push(scenario);
	}

	/** Parks a vehicle on the line from the player to the aircraft, where the apron is clear. */
	private createVehicleSpawnBetween(start: THREE.Object3D, aircraft: THREE.Object3D,
		type: string, distance: number): VehicleSpawnPoint
	{
		let startPosition = start.getWorldPosition(new THREE.Vector3());
		let towardAircraft = aircraft.getWorldPosition(new THREE.Vector3())
			.sub(startPosition)
			.setY(0)
			.normalize();

		let object = new THREE.Object3D();
		// Named rather than left blank: the party layer matches vehicles across
		// clients by their spawn point's name, so it has to be stable
		object.name = 'merged_' + type + '_spawn';
		object.position.copy(startPosition.add(towardAircraft.multiplyScalar(distance)));
		start.getWorldQuaternion(object.quaternion);

		let spawnPoint = new VehicleSpawnPoint(object);
		spawnPoint.type = type;

		return spawnPoint;
	}

	public launchScenario(scenarioID: string, loadingManager?: LoadingManager): void
	{
		this.lastScenarioID = scenarioID;

		this.clearEntities();

		// Launch default scenario
		if (!loadingManager) loadingManager = new LoadingManager(this);
		this.race.stop();

		for (const scenario of this.scenarios) {
			if (scenario.id === scenarioID || scenario.spawnAlways) {
				scenario.launch(loadingManager, this);

				// Arms it. The lights don't start until the world is actually
				// running, which is a while yet: models to load, and a briefing
				// the player reads at their own pace
				if (scenario.racePath !== undefined) this.race.begin(scenario);
			}
		}

		// Everyone in a party has to be in the same scenario, or vehicle ids don't line up
		if (this.party !== undefined) this.party.onScenarioLaunched(scenarioID);
	}

	public restartScenario(): void
	{
		if (this.lastScenarioID !== undefined)
		{
			document.exitPointerLock();
			this.launchScenario(this.lastScenarioID);
		}
		else
		{
			console.warn('Can\'t restart scenario. Last scenarioID is undefined.');
		}
	}

	public clearEntities(): void
	{
		for (let i = 0; i < this.characters.length; i++) {
			this.remove(this.characters[i]);
			i--;
		}

		for (let i = 0; i < this.vehicles.length; i++) {
			this.remove(this.vehicles[i]);
			i--;
		}
	}

	public scrollTheTimeScale(scrollAmount: number): void
	{
		// Changing time scale with scroll wheel
		const timeScaleBottomLimit = 0.003;
		const timeScaleChangeSpeed = 1.3;
	
		if (scrollAmount > 0)
		{
			this.timeScaleTarget /= timeScaleChangeSpeed;
			if (this.timeScaleTarget < timeScaleBottomLimit) this.timeScaleTarget = 0;
		}
		else
		{
			this.timeScaleTarget *= timeScaleChangeSpeed;
			if (this.timeScaleTarget < timeScaleBottomLimit) this.timeScaleTarget = timeScaleBottomLimit;
			this.timeScaleTarget = Math.min(this.timeScaleTarget, 1);
		}
	}

	public updateControls(controls: any): void
	{
		let html = '';
		html += '<h2 class="controls-title">Controls:</h2>';

		controls.forEach((row) =>
		{
			html += '<div class="ctrl-row">';
			row.keys.forEach((key) => {
				if (key === '+' || key === 'and' || key === 'or' || key === '&') html += '&nbsp;' + key + '&nbsp;';
				else html += '<span class="ctrl-key">' + key + '</span>';
			});

			html += '<span class="ctrl-desc">' + row.desc + '</span></div>';
		});

		// Available whatever the input receiver is, so they're listed everywhere
		html += '<div class="ctrl-row"><span class="ctrl-key">M</span>'
			+ '<span class="ctrl-desc">Mute music</span></div>';
		html += '<div class="ctrl-row"><span class="ctrl-key">C</span>'
			+ '<span class="ctrl-desc">Center camera</span></div>';

		document.getElementById('controls').innerHTML = html;
	}

	private setupAudio(): void
	{
		// There can only be one listener. It rides the camera, so panning follows
		// the view and the renderer keeps its matrix up to date for free.
		this.audioListener = new THREE.AudioListener();
		this.audioListener.setMasterVolume(this.params.Volume);
		this.camera.add(this.audioListener);

		// Music streams from an audio element instead of being decoded into memory,
		// so a full length track doesn't cost tens of megabytes of RAM
		this.musicElement = document.createElement('audio');
		this.musicElement.src = 'build/assets/music.mp3';
		this.musicElement.loop = true;
		this.musicElement.addEventListener('error', () =>
		{
			console.warn('Couldn\'t load music from \'' + this.musicElement.src + '\'.');
		}, false);

		// Playback control stays on the element, the Audio object is just the volume knob
		this.music = new THREE.Audio(this.audioListener);
		this.music.setMediaElementSource(this.musicElement);
		this.music.setVolume(this.params.Music_Volume);

		// touchend as well as click: the touch controls call preventDefault, which
		// stops a tap on them from ever becoming a click
		this.boundResumeAudio = () => this.resumeAudio();
		document.addEventListener('click', this.boundResumeAudio, false);
		document.addEventListener('keydown', this.boundResumeAudio, false);
		document.addEventListener('touchend', this.boundResumeAudio, false);

		// A phone call or a trip to another app interrupts the context, and
		// coming back is not a gesture, so nothing else would ever revive it
		document.addEventListener('visibilitychange', () =>
		{
			if (document.visibilityState !== 'visible') return;
			if (this.audioListener.context.state === 'running') return;

			this.listenForAudioUnlock();
			this.resumeAudio();
		}, false);
	}

	private generateHTML(): void
	{
		// Fonts
		$('head').append('<link href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&display=swap" rel="stylesheet">');
		$('head').append('<link href="https://fonts.googleapis.com/css2?family=Solway:wght@400;500;700&display=swap" rel="stylesheet">');
		$('head').append('<link href="https://fonts.googleapis.com/css2?family=Cutive+Mono&display=swap" rel="stylesheet">');

		// Loader
		$(`	<div id="loading-screen">
				<div id="loading-screen-background"></div>
				<h1 id="main-title" class="sb-font">Sketchbook 0.4</h1>
				<div class="cubeWrap">
					<div class="cube">
						<div class="faces1"></div>
						<div class="faces2"></div>     
					</div> 
				</div> 
				<div id="loading-text">Loading...</div>
			</div>
		`).appendTo('body');

		// UI
		$(`	<div id="ui-container" style="display: none;">
				<div class="github-corner">
					<a href="https://github.com/amindadgar/Sketchbook" target="_blank" title="Fork me on GitHub">
						<svg viewbox="0 0 100 100" fill="currentColor">
							<title>Fork me on GitHub</title>
							<path d="M0 0v100h100V0H0zm60 70.2h.2c1 2.7.3 4.7 0 5.2 1.4 1.4 2 3 2 5.2 0 7.4-4.4 9-8.7 9.5.7.7 1.3 2
							1.3 3.7V99c0 .5 1.4 1 1.4 1H44s1.2-.5 1.2-1v-3.8c-3.5 1.4-5.2-.8-5.2-.8-1.5-2-3-2-3-2-2-.5-.2-1-.2-1
							2-.7 3.5.8 3.5.8 2 1.7 4 1 5 .3.2-1.2.7-2 1.2-2.4-4.3-.4-8.8-2-8.8-9.4 0-2 .7-4 2-5.2-.2-.5-1-2.5.2-5
							0 0 1.5-.6 5.2 1.8 1.5-.4 3.2-.6 4.8-.6 1.6 0 3.3.2 4.8.7 2.8-2 4.4-2 5-2z"></path>
						</svg>
					</a>
				</div>
				<div class="left-panel">
					<div id="controls" class="panel-segment flex-bottom"></div>
				</div>
				<div id="reticle">
					<svg viewBox="0 0 100 100">
						<g stroke="#ff2f3f" stroke-width="4" fill="none" stroke-linecap="round">
							<circle cx="50" cy="50" r="24"></circle>
							<line x1="50" y1="8" x2="50" y2="20"></line>
							<line x1="50" y1="80" x2="50" y2="92"></line>
							<line x1="8" y1="50" x2="20" y2="50"></line>
							<line x1="80" y1="50" x2="92" y2="50"></line>
							<line x1="44" y1="44" x2="56" y2="56"></line>
							<line x1="56" y1="44" x2="44" y2="56"></line>
						</g>
					</svg>
				</div>
				<div id="hit-marker">
					<svg viewBox="0 0 100 100">
						<g stroke="#ffffff" stroke-width="7" stroke-linecap="round">
							<line x1="26" y1="26" x2="38" y2="38"></line>
							<line x1="74" y1="26" x2="62" y2="38"></line>
							<line x1="26" y1="74" x2="38" y2="62"></line>
							<line x1="74" y1="74" x2="62" y2="62"></line>
						</g>
					</svg>
				</div>
				<div id="settings-gear" title="Settings">&#9881;</div>
				<div id="health-badge"><span id="health-heart">&#10084;</span><span id="health-number">100</span></div>
				<div id="minimap-toggle">MAP</div>
				<div id="speed-badge"><span id="speed-number">0</span><span id="speed-unit">km/h</span></div>
				<div id="scoreboard">
					<div class="scoreboard-title">Players</div>
					<div id="match-clock"></div>
					<div id="scoreboard-rows"></div>
				</div>
				<div id="chat">
					<div id="chat-log"></div>
					<input id="chat-input" maxlength="160" spellcheck="false" autocomplete="off"
						placeholder="Say something, Enter to send">
					<div id="chat-open">&#128172;</div>
				</div>
				<div id="death-notice">
					<div id="death-title">You died</div>
					<div id="death-watching"></div>
					<div id="death-timer"></div>
				</div>
				<div id="leaderboard">
					<div id="leaderboard-head">
						<span id="leaderboard-title">Most kills</span>
						<span id="leaderboard-close">&times;</span>
					</div>
					<div id="leaderboard-rows"></div>
				</div>
				<div id="match-result">
					<div id="match-result-title">Round over</div>
					<div id="match-result-rows"></div>
					<div id="match-result-next">Next round starting</div>
				</div>
				<div id="combat-hud">
					<div id="health-bar"><div id="health-fill"></div></div>
					<div id="weapon-readout">
						<span id="weapon-name"></span><span id="weapon-ammo"></span>
					</div>
				</div>
				<div id="minimap">
					<canvas id="minimap-canvas"></canvas>
				</div>
				<div id="party-hud">
					<div id="party-code">PARTY <span id="party-code-value"></span></div>
					<div id="party-players"></div>
				</div>
				<div id="race-hud">
					<div class="race-row"><span class="race-label">LAP</span><span id="race-lap">1 / 3</span></div>
					<div class="race-row"><span class="race-label">POS</span><span id="race-place">1 / 1</span></div>
					<div id="race-time">0:00.00</div>
					<div class="race-row"><span class="race-label">BEST</span><span id="race-best">--:--</span></div>
				</div>
				<div id="race-countdown"></div>
				<div id="race-result">
					<div id="race-result-place"></div>
					<div class="race-result-row"><span>Total</span><span id="race-result-total"></span></div>
					<div class="race-result-row"><span>Best lap</span><span id="race-result-best"></span></div>
				</div>
				<div id="speedometer">
					<div id="speedometer-track">
						<div id="speedometer-fill"></div>
						<div class="speedometer-split" style="left: 33.33%;"></div>
						<div class="speedometer-split" style="left: 66.66%;"></div>
					</div>
				</div>
			</div>
		`).appendTo('body');

		document.getElementById('settings-gear').addEventListener('click', () =>
		{
			UIManager.toggleSettings();
		}, false);

		// Outside the UI container on purpose: that stays hidden until the menu
		// is dismissed, and a phone held upright needs telling before then
		$(`	<div id="rotate-notice">
				<div id="rotate-icon">\u21bb</div>
				<div id="rotate-text">Turn your phone sideways to play</div>
			</div>
		`).appendTo('body');

		// Canvas
		document.body.appendChild(this.renderer.domElement);
		this.renderer.domElement.id = 'canvas';
	}

	private createParamsGUI(scope: World): void
	{
		this.params = {
			Pointer_Lock: true,
			Mouse_Sensitivity: 0.3,
			Time_Scale: 1,
			Shadows: true,
			FXAA: true,
			Debug_Physics: false,
			Debug_FPS: false,
			Sun_Elevation: 50,
			Sun_Rotation: 145,
			Volume: 0.8,
			Music_Volume: 0.3,
			Mute_Music: false,
			Center_Camera: false,
		};

		const gui = new GUI.GUI();

		// Scenario
		this.scenarioGUIFolder = gui.addFolder('Scenarios');
		this.scenarioGUIFolder.open();

		// World
		let worldFolder = gui.addFolder('World');
		worldFolder.add(this.params, 'Time_Scale', 0, 1).listen()
			.onChange((value) =>
			{
				scope.timeScaleTarget = value;
			});
		worldFolder.add(this.params, 'Sun_Elevation', 0, 180).listen()
			.onChange((value) =>
			{
				scope.sky.phi = value;
			});
		worldFolder.add(this.params, 'Sun_Rotation', 0, 360).listen()
			.onChange((value) =>
			{
				scope.sky.theta = value;
			});

		// Input
		let settingsFolder = gui.addFolder('Settings');
		settingsFolder.add(this.params, 'FXAA');
		settingsFolder.add(this.params, 'Shadows')
			.onChange((enabled) =>
			{
				if (enabled)
				{
					this.sky.csm.lights.forEach((light) => {
						light.castShadow = true;
					});
				}
				else
				{
					this.sky.csm.lights.forEach((light) => {
						light.castShadow = false;
					});
				}
			});
		settingsFolder.add(this.params, 'Pointer_Lock')
			.onChange((enabled) =>
			{
				scope.inputManager.setPointerLock(enabled);
			});
		settingsFolder.add(this.params, 'Mouse_Sensitivity', 0, 1)
			.onChange((value) =>
			{
				scope.cameraOperator.setSensitivity(value, value * 0.8);
			});
		settingsFolder.add(this.params, 'Volume', 0, 1)
			.onChange((value) =>
			{
				scope.audioListener.setMasterVolume(value);
			});
		settingsFolder.add(this.params, 'Music_Volume', 0, 1)
			.onChange(() =>
			{
				scope.applyMusicVolume();
			});
		settingsFolder.add(this.params, 'Mute_Music').listen()
			.onChange(() =>
			{
				scope.applyMusicVolume();
			});
		settingsFolder.add(this.params, 'Center_Camera').listen()
			.onChange((enabled) =>
			{
				scope.cameraOperator.autoCenter = enabled;
			});
		settingsFolder.add(this.params, 'Debug_Physics')
			.onChange((enabled) =>
			{
				if (enabled)
				{
					this.cannonDebugRenderer = new CannonDebugRenderer( this.graphicsWorld, this.physicsWorld );
				}
				else
				{
					this.cannonDebugRenderer.clearMeshes();
					this.cannonDebugRenderer = undefined;
				}

				scope.characters.forEach((char) =>
				{
					char.raycastBox.visible = enabled;
				});
			});
		settingsFolder.add(this.params, 'Debug_FPS')
			.onChange((enabled) =>
			{
				UIManager.setFPSVisible(enabled);
			});

		gui.open();
	}
}