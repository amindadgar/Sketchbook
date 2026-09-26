import * as THREE from 'three';
import { World } from './World';
import { IUpdatable } from '../interfaces/IUpdatable';

/**
 * The sea: one plane out to the horizon at sea level.
 *
 * It's an ordinary physically based material, dark and very smooth, so the
 * sky and the sun do the work: the environment map gives it the sky's
 * reflection with the right fresnel, the sun lays a glint across it, and the
 * shadow cascades fall on it like anything else. The ripples are two layers
 * of the same tileable normal map sliding past each other in world space,
 * fading out with distance so the horizon doesn't shimmer.
 */
export class Water implements IUpdatable
{
	public updateOrder: number = 10;
	public mesh: THREE.Mesh;
	public level: number;

	private time: { value: number } = { value: 0 };
	private material: THREE.MeshStandardMaterial;

	/**
	 * `hole` is a rectangle in x and z the sea stays out of: the island, whose
	 * sunken race tracks sit below sea level inside its walls.
	 */
	constructor(world: World, level: number, size: number = 12000, hole?: { minX: number, maxX: number, minZ: number, maxZ: number })
	{
		this.level = level;

		this.material = new THREE.MeshStandardMaterial({
			color: new THREE.Color(0x0b3345),
			roughness: 0.05,
			metalness: 0.0,
			normalMap: Water.createNormalMap(),
			normalScale: new THREE.Vector2(0.55, 0.55)
		});
		this.material.name = 'water';
		this.material.userData.shaderKey = 'water';

		const time = this.time;
		this.material.onBeforeCompile = (shader) =>
		{
			shader.uniforms.waterTime = time;

			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
				.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');

			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;\nuniform float waterTime;')
				.replace('#include <normal_fragment_maps>', `
					{
						vec2 xz = vWaterWorld.xz;
						vec3 a = texture2D(normalMap, xz * 0.031 + waterTime * vec2(0.011, 0.007)).xyz * 2.0 - 1.0;
						vec3 b = texture2D(normalMap, xz * 0.017 - waterTime * vec2(0.006, -0.009)).xyz * 2.0 - 1.0;
						vec3 c = texture2D(normalMap, xz * 0.0045 + waterTime * vec2(0.002, 0.003)).xyz * 2.0 - 1.0;
						float distance = length(vWaterWorld - cameraPosition);
						float fade = exp(-distance * 0.0025);
						vec2 slope = ((a.xy + b.xy) * normalScale * fade + c.xy * 0.35);
						vec3 worldNormal = normalize(vec3(slope.x, 1.0, slope.y));
						normal = normalize((viewMatrix * vec4(worldNormal, 0.0)).xyz);
					}
				`);
		};

		this.mesh = new THREE.Mesh(Water.surface(size, hole), this.material);
		this.mesh.rotation.x = -Math.PI / 2;
		this.mesh.position.y = level;
		this.mesh.receiveShadow = true;
		this.mesh.castShadow = false;
		this.mesh.name = 'sea';

		world.graphicsWorld.add(this.mesh);
		world.registerUpdatable(this);
	}

	/** A square of sea, in the XY plane before it's laid flat, with the hole cut out. */
	private static surface(size: number, hole?: { minX: number, maxX: number, minZ: number, maxZ: number }): THREE.BufferGeometry
	{
		if (hole === undefined) return new THREE.PlaneGeometry(size, size, 1, 1);

		let half = size / 2;
		let shape = new THREE.Shape();
		shape.moveTo(-half, -half);
		shape.lineTo(half, -half);
		shape.lineTo(half, half);
		shape.lineTo(-half, half);
		shape.lineTo(-half, -half);

		// Laid flat by turning -90 about X, so plane Y becomes world -Z
		let path = new THREE.Path();
		path.moveTo(hole.minX, -hole.maxZ);
		path.lineTo(hole.minX, -hole.minZ);
		path.lineTo(hole.maxX, -hole.minZ);
		path.lineTo(hole.maxX, -hole.maxZ);
		path.lineTo(hole.minX, -hole.maxZ);
		shape.holes.push(path);

		return new THREE.ShapeGeometry(shape);
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		this.time.value += unscaledTimeStep;
	}

	/**
	 * A tileable ripple texture drawn on the spot, so the sea costs nothing to
	 * download. Sums of waves whose frequencies are whole numbers of cycles
	 * across the tile, so it wraps without a seam, stored as tangent space
	 * normals the usual way.
	 */
	private static createNormalMap(): THREE.Texture
	{
		const size = 256;
		const waves: number[][] = [];
		let seed = 7;
		let random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

		for (let i = 0; i < 28; i++)
		{
			let kx = Math.round((random() - 0.5) * 18);
			let ky = Math.round((random() - 0.5) * 18);
			if (kx === 0 && ky === 0) kx = 1;
			let frequency = Math.sqrt(kx * kx + ky * ky);
			// Shorter waves are smaller, roughly like a real sea surface
			let amplitude = 1 / Math.pow(frequency, 1.3);
			waves.push([kx, ky, amplitude, random() * Math.PI * 2]);
		}

		let data = new Uint8Array(size * size * 4);
		for (let y = 0; y < size; y++)
		{
			for (let x = 0; x < size; x++)
			{
				let dx = 0;
				let dy = 0;
				for (const [kx, ky, amplitude, phase] of waves)
				{
					let angle = Math.PI * 2 * (kx * x + ky * y) / size + phase;
					let slope = Math.cos(angle) * amplitude * Math.PI * 2;
					dx += slope * kx / size * 40;
					dy += slope * ky / size * 40;
				}

				let length = Math.sqrt(dx * dx + dy * dy + 1);
				let i = (y * size + x) * 4;
				data[i] = Math.round((-dx / length * 0.5 + 0.5) * 255);
				data[i + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255);
				data[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
				data[i + 3] = 255;
			}
		}

		let texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.magFilter = THREE.LinearFilter;
		texture.minFilter = THREE.LinearMipmapLinearFilter;
		texture.generateMipmaps = true;
		texture.anisotropy = 8;
		texture.needsUpdate = true;
		return texture;
	}
}
