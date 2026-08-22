import { SkyShader } from '../../lib/shaders/SkyShader';
import * as THREE from 'three';
import { World } from './World';
import { EntityType } from '../enums/EntityType';
import { IUpdatable } from '../interfaces/IUpdatable';
import { default as CSM } from 'three-csm';
import { DeviceProfile } from '../core/DeviceProfile';

export class Sky extends THREE.Object3D implements IUpdatable
{
	public updateOrder: number = 5;

	public sunPosition: THREE.Vector3 = new THREE.Vector3();
	public csm: CSM;

	set theta(value: number) {
		this._theta = value;
		this.refreshSunPosition();
	}

	set phi(value: number) {
		this._phi = value;
		this.refreshSunPosition();
		this.refreshHemiIntensity();
	}

	private _phi: number = 50;
	private _theta: number = 145;

	/**
	 * How far round the day it is, nought to one. The sun rises, crosses and
	 * sets, and the elevation stops just short of the horizon rather than going
	 * under it: the sky here is an atmospheric scattering shader with no stars
	 * behind it, and a game nobody can see is worse than a short night.
	 */
	private phase: number = 0.32;
	private static readonly LOW_SUN: number = 3;
	private static readonly HIGH_SUN: number = 78;
	/** Below this the world is lit like dusk and the headlights come on. */
	private static readonly NIGHT_BELOW: number = 16;

	private hemiLight: THREE.HemisphereLight;
	private maxHemiIntensity: number = 0.9;
	private minHemiIntensity: number = 0.3;

	private skyMesh: THREE.Mesh;
	private skyMaterial: THREE.ShaderMaterial;

	private world: World;

	constructor(world: World)
	{
		super();

		this.world = world;
		
		// Sky material
		this.skyMaterial = new THREE.ShaderMaterial({
			uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms),
			fragmentShader: SkyShader.fragmentShader,
			vertexShader: SkyShader.vertexShader,
			side: THREE.BackSide
		});

		// Mesh
		this.skyMesh = new THREE.Mesh(
			new THREE.SphereBufferGeometry(1000, 24, 12),
			this.skyMaterial
		);
		this.attach(this.skyMesh);

		// Ambient light
		this.hemiLight = new THREE.HemisphereLight( 0xffffff, 0xffffff, 1.0 );
		this.refreshHemiIntensity();
		this.hemiLight.color.setHSL( 0.59, 0.4, 0.6 );
		this.hemiLight.groundColor.setHSL( 0.095, 0.2, 0.75 );
		this.hemiLight.position.set( 0, 50, 0 );
		this.world.graphicsWorld.add( this.hemiLight );

		// CSM
		// New version
		// let splitsCallback = (amount, near, far, target) =>
		// {
		// 	for (let i = amount - 1; i >= 0; i--)
		// 	{
		// 		target.push(Math.pow(1 / 3, i));
		// 	}
		// };

		// Legacy
		let splitsCallback = (amount, near, far) =>
		{
			let arr = [];

			for (let i = amount - 1; i >= 0; i--)
			{
				arr.push(Math.pow(1 / 4, i));
			}

			return arr;
		};

		this.csm = new CSM({
			fov: 80,
			far: 250,	// maxFar
			lightIntensity: 2.5,
			cascades: 3,
			shadowMapSize: DeviceProfile.shadowMapSize(),
			camera: world.camera,
			parent: world.graphicsWorld,
			mode: 'custom',
			customSplitsCallback: splitsCallback
		});
		this.csm.fade = true;

		this.refreshSunPosition();
		
		world.graphicsWorld.add(this);
		world.registerUpdatable(this);
	}

	/** True when it's dark enough to want the lights on. */
	public get isNight(): boolean
	{
		return this._phi < Sky.NIGHT_BELOW;
	}

	public update(timeScale: number, unscaledTimeStep: number): void
	{
		this.position.copy(this.world.camera.position);
		this.advanceDay(unscaledTimeStep);
		this.refreshSunPosition();

		this.csm.update(this.world.camera.matrix);
		this.csm.lightDirection = new THREE.Vector3(-this.sunPosition.x, -this.sunPosition.y, -this.sunPosition.z).normalize();
	}

	/**
	 * Walks the sun round on its own, unless somebody is dragging the sliders
	 * in the settings, in which case it stays where they put it.
	 */
	private advanceDay(unscaledTimeStep: number): void
	{
		if (this.world.params.Day_Night !== true) return;

		let length = Math.max(30, this.world.params.Day_Length);
		this.phase = (this.phase + unscaledTimeStep / length) % 1;

		// A sine puts the sun overhead at midday and low at either end, and
		// spends longer near the top than a straight ramp would
		let height = Math.sin(this.phase * Math.PI * 2) * 0.5 + 0.5;

		this.world.params.Sun_Elevation = Sky.LOW_SUN + height * (Sky.HIGH_SUN - Sky.LOW_SUN);
		this.world.params.Sun_Rotation = (this.phase * 360) % 360;

		this._phi = this.world.params.Sun_Elevation;
		this._theta = this.world.params.Sun_Rotation;
		this.refreshHemiIntensity();
	}

	public refreshSunPosition(): void
	{
		const sunDistance = 10;

		this.sunPosition.x = sunDistance * Math.sin(this._theta * Math.PI / 180) * Math.cos(this._phi * Math.PI / 180);
		this.sunPosition.y = sunDistance * Math.sin(this._phi * Math.PI / 180);
		this.sunPosition.z = sunDistance * Math.cos(this._theta * Math.PI / 180) * Math.cos(this._phi * Math.PI / 180);

		this.skyMaterial.uniforms.sunPosition.value.copy(this.sunPosition);
		this.skyMaterial.uniforms.cameraPos.value.copy(this.world.camera.position);
	}

	public refreshHemiIntensity(): void
	{
		this.hemiLight.intensity = this.minHemiIntensity + Math.pow(1 - (Math.abs(this._phi - 90) / 90), 0.25) * (this.maxHemiIntensity - this.minHemiIntensity);

		// Dusk is bluer as well as dimmer, which is most of what sells it
		let dusk = THREE.MathUtils.clamp(1 - this._phi / Sky.NIGHT_BELOW, 0, 1);
		this.hemiLight.intensity *= 1 - dusk * 0.6;
		this.hemiLight.color.setHSL(0.59, 0.4, 0.6 - dusk * 0.3);

		// The sky is a scattering shader with nothing behind it, so it never gets
		// truly dark on its own. Pulling the exposure down takes the whole frame
		// with it, sky included, which is what makes night look like night.
		this.world.renderer.toneMappingExposure = 1 - dusk * 0.62;
	}
}