import * as THREE from 'three';
import { mulberry32 } from '../core/FunctionLibrary';
import { Sky as SkyMesh } from 'three/addons/objects/Sky.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { World } from './World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { DeviceProfile } from '../core/DeviceProfile';

/**
 * Sun, moon, sky and the light they cast.
 *
 * The sky is three's physical (Preetham) sky with its drifting clouds, and the
 * same sky is rendered into a prefiltered environment map every time the sun
 * has moved a little, so everything shiny reflects the sky that's actually up
 * there and everything rough is lit by it. The sun goes below the horizon for
 * a short night, when a moon takes over the shadows and the stars come out.
 */
export class Sky extends THREE.Object3D implements IUpdatable
{
	public updateOrder: number = 5;

	/** Toward the sun, ten units long. Below the horizon at night. */
	public sunPosition: THREE.Vector3 = new THREE.Vector3();
	public csm: CSM;

	set theta(value: number) {
		this._theta = value;
		this.refreshSunPosition();
	}

	set phi(value: number) {
		this._phi = value;
		this.refreshSunPosition();
		this.refreshLighting();
	}

	private _phi: number = 50;
	private _theta: number = 145;

	/**
	 * How far round the day it is, nought to one. The sun rises, crosses and
	 * sets, and dips far enough under the horizon for about a quarter of the
	 * cycle to be night: long enough for the city lights to mean something,
	 * short enough that nobody spends long driving in the dark.
	 */
	private phase: number = 0.32;
	private static readonly LOW_SUN: number = -14;
	private static readonly HIGH_SUN: number = 78;
	/** Below this the headlights come on. */
	private static readonly NIGHT_BELOW: number = 6;

	private static readonly SUN_INTENSITY: number = 3.4;
	/**
	 * A game's moon rather than a real one: bright enough to drive and fight
	 * by, with the street lights and windows still the brightest things out.
	 */
	private static readonly MOON_INTENSITY: number = 1.9;

	/** 0 in daylight, 1 at full night. Read by anything that glows after dark. */
	public nightFactor: number = 0;

	private hemiLight: THREE.HemisphereLight;
	private skyMesh: SkyMesh;
	private stars: THREE.Points;

	// Environment lighting
	private envScene: THREE.Scene;
	private envSky: SkyMesh;
	private pmrem: THREE.PMREMGenerator;
	private envTarget: THREE.WebGLRenderTarget;
	private envSunAtLastBake: THREE.Vector3 = new THREE.Vector3(0, -1, 0);
	private envAge: number = 0;

	private fogDay: THREE.Color = new THREE.Color(0xb9c8d8);
	private fogDusk: THREE.Color = new THREE.Color(0xd6a47c);
	/** Also the colour the night sky fades to at the horizon, so the haze meets it. */
	private fogNight: THREE.Color = new THREE.Color(0x26344f);
	private lightDirection: THREE.Vector3 = new THREE.Vector3();
	private moonColor: THREE.Color = new THREE.Color(0xbccbf2);
	private sunColor: THREE.Color = new THREE.Color();
	private hemiSkyDay: THREE.Color = new THREE.Color(0xbfd4ff);
	private hemiSkyNight: THREE.Color = new THREE.Color(0x9fb8ff);
	private hemiGroundDay: THREE.Color = new THREE.Color(0x6b5a48);
	private hemiGroundNight: THREE.Color = new THREE.Color(0x3e4658);

	private world: World;

	constructor(world: World)
	{
		super();

		this.world = world;

		this.skyMesh = Sky.createSkyMesh();
		this.skyMesh.renderOrder = -1000;
		this.skyMesh.frustumCulled = false;
		this.skyMesh.scale.setScalar(1000);
		this.skyMesh.userData.noOcclusion = true;
		this.attach(this.skyMesh);

		this.stars = Sky.createStars();
		this.attach(this.stars);

		// A little fill that never goes away, bluer and relatively stronger at night
		this.hemiLight = new THREE.HemisphereLight(0xbfd4ff, 0x6b5a48, 0.35);
		this.hemiLight.position.set(0, 50, 0);
		this.world.graphicsWorld.add(this.hemiLight);

		// The same sky again, alone in a scene, for baking reflections from
		this.envScene = new THREE.Scene();
		this.envSky = Sky.createSkyMesh();
		this.envSky.material = this.skyMesh.material;
		this.envSky.scale.setScalar(100);
		this.envScene.add(this.envSky);
		this.pmrem = new THREE.PMREMGenerator(world.renderer);

		world.graphicsWorld.fog = new THREE.FogExp2(this.fogDay.getHex(), 0.0008);

		// CSM. Each split a quarter of the next, so the nearest cascade is
		// sharp where the character stands and the far one covers the view
		let splitsCallback = (amount: number, near: number, far: number, target: number[]) =>
		{
			for (let i = amount - 1; i >= 0; i--)
			{
				target.push(Math.pow(1 / 4, i));
			}
		};

		this.csm = new CSM({
			maxFar: 300,
			lightIntensity: Sky.SUN_INTENSITY,
			cascades: 3,
			shadowMapSize: DeviceProfile.shadowMapSize(),
			camera: world.camera,
			parent: world.graphicsWorld,
			mode: 'custom',
			customSplitsCallback: splitsCallback,
			lightMargin: 250
		});
		this.csm.fade = true;
		this.csm.lights.forEach((light) =>
		{
			light.shadow.bias = -0.0002;
			light.shadow.normalBias = 0.02;
		});

		this.refreshSunPosition();
		this.refreshLighting();

		world.graphicsWorld.add(this);
		world.registerUpdatable(this);
	}

	/**
	 * The physical sky comes out some twenty times brighter than anything
	 * a sun of sensible strength can light, which left the world looking dim
	 * under a glaring sky and made everything bloom. Scaling the sky down
	 * instead of the sun up keeps the numbers small, and since the same sky
	 * is baked into the reflections, what things reflect scales with it.
	 */
	private static readonly SKY_SCALE: number = 0.085;

	private static createSkyMesh(): SkyMesh
	{
		let sky = new SkyMesh();
		let material = sky.material as THREE.ShaderMaterial;
		material.uniforms.skyScale = { value: Sky.SKY_SCALE };
		// The physical sky goes black once the sun is down. At night it gets a
		// moonlit blue instead, lighter toward the horizon, and the moon itself
		material.uniforms.night = { value: 0 };
		material.uniforms.nightHorizon = { value: new THREE.Color() };
		material.uniforms.nightZenith = { value: new THREE.Color(0x0a1224) };
		material.uniforms.moonDirection = { value: new THREE.Vector3(0, 1, 0) };
		material.fragmentShader = material.fragmentShader
			.replace('uniform float time;', 'uniform float time;\nuniform float skyScale;\nuniform float night;\nuniform vec3 nightHorizon;\nuniform vec3 nightZenith;\nuniform vec3 moonDirection;')
			.replace('gl_FragColor = vec4( texColor, 1.0 );', `
			vec3 nightSky = mix( nightHorizon, nightZenith, smoothstep( -0.02, 0.55, direction.y ) );
			float moonCos = dot( direction, moonDirection );
			// A moon drawn larger than life, with a soft glow round it
			float moonEdge = 0.99955;
			float disc = smoothstep( moonEdge, moonEdge + 0.00008, moonCos );
			float limb = sqrt( clamp( ( moonCos - moonEdge ) / ( 1.0 - moonEdge ), 0.0, 1.0 ) );
			vec3 moon = vec3( 1.0, 0.97, 0.9 ) * disc * ( 1.7 + 0.9 * limb );
			vec3 glow = vec3( 0.55, 0.65, 0.9 ) * ( pow( max( moonCos, 0.0 ), 900.0 ) * 0.35 + pow( max( moonCos, 0.0 ), 40.0 ) * 0.05 );
			gl_FragColor = vec4( texColor * skyScale + ( nightSky + moon + glow ) * night, 1.0 );`);

		let uniforms = material.uniforms;
		uniforms.turbidity.value = 4;
		uniforms.rayleigh.value = 1.4;
		uniforms.mieCoefficient.value = 0.004;
		uniforms.mieDirectionalG.value = 0.82;
		uniforms.cloudCoverage.value = 0.32;
		uniforms.cloudDensity.value = 0.45;
		uniforms.cloudElevation.value = 0.55;
		return sky;
	}

	/** A few thousand points on the far plane, faded in after dark. */
	private static createStars(): THREE.Points
	{
		let positions: number[] = [];
		let sizes: number[] = [];
		let random = mulberry32(1337);

		for (let i = 0; i < 2600; i++)
		{
			// Upper hemisphere only, a touch denser toward the zenith
			let u = random();
			let y = Math.pow(u, 0.7);
			let angle = random() * Math.PI * 2;
			let radius = Math.sqrt(1 - y * y);
			positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
			sizes.push(0.6 + Math.pow(random(), 6) * 2.8);
		}

		let geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

		let material = new THREE.ShaderMaterial({
			uniforms: { opacity: { value: 0 } },
			vertexShader: `
				attribute float size;
				varying float vTwinkle;
				void main() {
					vec4 clip = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 900.0, 1.0);
					clip.z = clip.w;
					gl_Position = clip;
					gl_PointSize = size;
					vTwinkle = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
				}`,
			fragmentShader: `
				uniform float opacity;
				varying float vTwinkle;
				void main() {
					vec2 c = gl_PointCoord - 0.5;
					float d = 1.0 - smoothstep(0.1, 0.5, length(c));
					gl_FragColor = vec4(vec3(0.8, 0.85, 1.0) * (0.6 + vTwinkle * 0.6), d * opacity);
				}`,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			fog: false
		});

		let points = new THREE.Points(geometry, material);
		points.frustumCulled = false;
		points.renderOrder = -999;
		return points;
	}

	/** True when it's dark enough to want the lights on. */
	public get isNight(): boolean
	{
		return this._phi < Sky.NIGHT_BELOW;
	}

	/** The baked sky, for materials that want it without being in the scene. */
	public get environment(): THREE.Texture
	{
		return this.envTarget !== undefined ? this.envTarget.texture : null;
	}

	public update(timeScale: number, unscaledTimeStep: number): void
	{
		this.position.copy(this.world.camera.position);
		this.advanceDay(unscaledTimeStep);
		this.refreshSunPosition();

		let uniforms = (this.skyMesh.material as THREE.ShaderMaterial).uniforms;
		uniforms.time.value += unscaledTimeStep;

		this.csm.lightDirection.copy(this.lightDirection).negate();
		this.csm.update();

		this.envAge += unscaledTimeStep;
		this.refreshEnvironment();
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
		this.refreshLighting();
	}

	/** Sets the time of day directly, nought to one, as the party clock does. */
	public setPhase(phase: number): void
	{
		this.phase = ((phase % 1) + 1) % 1;
		this.advanceDay(0);
	}

	public getPhase(): number
	{
		return this.phase;
	}

	public refreshSunPosition(): void
	{
		const sunDistance = 10;

		this.sunPosition.x = sunDistance * Math.sin(this._theta * Math.PI / 180) * Math.cos(this._phi * Math.PI / 180);
		this.sunPosition.y = sunDistance * Math.sin(this._phi * Math.PI / 180);
		this.sunPosition.z = sunDistance * Math.cos(this._theta * Math.PI / 180) * Math.cos(this._phi * Math.PI / 180);

		(this.skyMesh.material as THREE.ShaderMaterial).uniforms.sunPosition.value.copy(this.sunPosition);

		// By day the shadows come from the sun, by night from a moon hung
		// opposite it. They swap over while both are too dim to notice.
		if (this._phi > 0)
		{
			this.lightDirection.copy(this.sunPosition).normalize();
		}
		else
		{
			this.lightDirection.set(-this.sunPosition.x, Math.abs(this.sunPosition.y) + 4, -this.sunPosition.z).normalize();
		}

		// Where the moon is drawn, which is where its light comes from
		(this.skyMesh.material as THREE.ShaderMaterial).uniforms.moonDirection.value
			.set(-this.sunPosition.x, Math.abs(this.sunPosition.y) + 4, -this.sunPosition.z).normalize();
	}

	/**
	 * Everything that follows from the sun's height: how strong and what
	 * colour the light is, the haze, and the exposure.
	 */
	public refreshLighting(): void
	{
		let elevation = this._phi;
		let smooth = THREE.MathUtils.smoothstep;

		let day = smooth(elevation, -2, 10);
		let night = 1 - smooth(elevation, -8, 1);
		this.nightFactor = night;

		// Low sun is warm, high sun is white
		let warmth = 1 - smooth(elevation, 2, 28);
		this.sunColor.setRGB(1, 1 - warmth * 0.32, 1 - warmth * 0.62);

		// Both fade to nothing right at the horizon, where the shadows swap
		// from one to the other, so the swap is never seen
		let intensity: number;
		let color: THREE.Color;
		if (elevation > 0)
		{
			intensity = Sky.SUN_INTENSITY * smooth(elevation, 0, 10);
			color = this.sunColor;
		}
		else
		{
			intensity = Sky.MOON_INTENSITY * (1 - smooth(elevation, -4, 0));
			color = this.moonColor;
		}

		if (this.csm !== undefined)
		{
			this.csm.lights.forEach((light) =>
			{
				light.intensity = intensity;
				light.color.copy(color);
			});
		}

		// Fill from the whole sky, which at night is what keeps the shadowed
		// side of a street readable rather than black. It comes up as the sun
		// goes down, ahead of the night itself, so the half hour either side of
		// the horizon, with the sun and moon both faint, isn't the darkest part
		let fill = Math.max(night, 1 - smooth(elevation, -1, 9));
		this.hemiLight.intensity = 0.25 + fill * 1.05;
		this.hemiLight.color.copy(this.hemiSkyDay).lerp(this.hemiSkyNight, night);
		this.hemiLight.groundColor.copy(this.hemiGroundDay).lerp(this.hemiGroundNight, night);

		// Haze: clear blue by day, gold at the ends of it, moonlit blue at night
		let fog = this.world.graphicsWorld.fog as THREE.FogExp2;
		if (fog !== null && fog !== undefined)
		{
			let dusk = 1 - smooth(elevation, 3, 22);
			fog.color.copy(this.fogDay).lerp(this.fogDusk, dusk * day).lerp(this.fogNight, night);
			fog.density = 0.0008 + night * 0.0003;
		}

		(this.stars.material as THREE.ShaderMaterial).uniforms.opacity.value = night;

		let uniforms = (this.skyMesh.material as THREE.ShaderMaterial).uniforms;
		uniforms.night.value = night;
		uniforms.nightHorizon.value.copy(this.fogNight);

		// The physical sky is bright, and the scene is lit to match it; the
		// exposure is what keeps both on screen
		this.world.renderer.toneMappingExposure = 1.15 + night * 0.1;
	}

	/**
	 * Re-bakes the reflections once the sun has moved a degree or so. A bake
	 * is a handful of small renders, a few milliseconds, which is nothing
	 * every couple of seconds and far too much every frame.
	 */
	private refreshEnvironment(): void
	{
		let sun = this.sunPosition.clone().normalize();
		let threshold = DeviceProfile.isTouch() ? 0.035 : 0.015;
		let due = this.envTarget === undefined
			|| (sun.distanceTo(this.envSunAtLastBake) > threshold && this.envAge > 0.5);

		if (!due) return;

		this.envSunAtLastBake.copy(sun);
		this.envAge = 0;

		let uniforms = (this.envSky.material as THREE.ShaderMaterial).uniforms;
		let previousCoverage = uniforms.cloudCoverage.value;

		let previous = this.envTarget;
		this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
		uniforms.cloudCoverage.value = previousCoverage;

		this.world.graphicsWorld.environment = this.envTarget.texture;
		this.world.graphicsWorld.environmentIntensity = 1.35 - this.nightFactor * 0.35;

		if (previous !== undefined) previous.dispose();
	}
}
