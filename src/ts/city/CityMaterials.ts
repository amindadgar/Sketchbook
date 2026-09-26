import * as THREE from 'three';
import { LoadingManager } from '../core/LoadingManager';

/**
 * The city's materials. Every surface is physically based, textured from
 * Poly Haven's CC0 scans, with the geometry's UVs measured in world units so a
 * texture's scale is set once here rather than per mesh.
 *
 * Two families get a little shader on top: roads, which paint their own lane
 * markings and crossings from where on the road a pixel is, and building
 * walls, which cut a grid of windows into whatever the wall is made of and
 * light a scatter of them after dark.
 */
export class CityMaterials
{
	/** Shared by every window and lamp that glows at night, nought to one. */
	public static night: { value: number } = { value: 0 };

	public asphalt: THREE.MeshStandardMaterial;
	public highway: THREE.MeshStandardMaterial;
	public junction: THREE.MeshStandardMaterial;
	public parking: THREE.MeshStandardMaterial;
	public sidewalk: THREE.MeshStandardMaterial;
	public curb: THREE.MeshStandardMaterial;
	public concrete: THREE.MeshStandardMaterial;
	public grass: THREE.MeshStandardMaterial;
	public sand: THREE.MeshStandardMaterial;
	public rocks: THREE.MeshStandardMaterial;
	public roof: THREE.MeshStandardMaterial;
	public roofTiles: THREE.MeshStandardMaterial;
	public planks: THREE.MeshStandardMaterial;
	public metal: THREE.MeshStandardMaterial;
	public painted: THREE.MeshStandardMaterial;
	public darkMetal: THREE.MeshStandardMaterial;
	public lampGlow: THREE.MeshStandardMaterial;

	/** Facades by name: what the wall between the windows is made of. */
	public facades: { [name: string]: THREE.MeshStandardMaterial } = {};
	public static readonly FACADES: string[] = ['brick', 'tan', 'stucco', 'concrete', 'tiles', 'glass', 'warehouse'];

	private loader: THREE.TextureLoader;
	private loadingManager: LoadingManager;
	private anisotropy: number;
	private cache: { [key: string]: THREE.Texture } = {};

	constructor(loadingManager: LoadingManager, anisotropy: number)
	{
		this.loader = new THREE.TextureLoader();
		this.loadingManager = loadingManager;
		this.anisotropy = anisotropy;

		// The cracked scan repeats its cracks down a whole street, so roads use
		// the clean one and the cracked one is kept for car parks
		this.asphalt = this.surface('clean_asphalt', 7, { roughness: 1 });
		this.highway = this.surface('clean_asphalt', 8, { roughness: 1 });
		this.junction = this.surface('clean_asphalt', 7, { roughness: 1 });
		this.parking = this.surface('asphalt_02', 6, { roughness: 1 });
		this.sidewalk = this.surface('concrete_pavement', 2.4, { roughness: 1 });
		this.curb = this.surface('brushed_concrete', 3, { roughness: 1 });
		this.concrete = this.surface('brushed_concrete', 6, { roughness: 1 });
		this.grass = this.surface('leafy_grass', 3, { roughness: 1 });
		// The scan is more autumn than park; nudge it greener
		this.grass.color.setRGB(0.62, 0.86, 0.46);
		this.sand = this.surface('coast_sand_01', 4, { roughness: 1 });
		this.rocks = this.surface('coast_land_rocks_01', 5, { roughness: 1 });
		this.roof = this.surface('tarred_gravel', 4, { roughness: 1 });
		this.roofTiles = this.surface('roof_tiles', 2.5, { roughness: 1 });
		this.planks = this.surface('weathered_planks', 2.5, { roughness: 1 });
		this.metal = this.surface('corrugated_iron', 3, { roughness: 1, metalness: 0.3 });

		this.painted = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.1 });
		this.darkMetal = new THREE.MeshStandardMaterial({ color: 0x5b6067, roughness: 0.5, metalness: 0.45 });
		this.lampGlow = new THREE.MeshStandardMaterial({ color: 0xfff4dd, emissive: new THREE.Color(0xffe2b0), emissiveIntensity: 0.2, roughness: 0.3 });

		CityMaterials.addRoadMarkings(this.asphalt, 'road');
		CityMaterials.addRoadMarkings(this.highway, 'road-highway');
		CityMaterials.addCrossings(this.junction);
		CityMaterials.addCrossings(this.parking);
		this.parking.userData.shaderKey = 'parking';

		this.facades.brick = this.facade('brick_wall_006', 3.2);
		this.facades.tan = this.facade('brick_wall_09', 3.2);
		this.facades.stucco = this.facade('white_stucco', 4);
		this.facades.concrete = this.facade('concrete_wall_008', 5);
		this.facades.tiles = this.facade('rectangular_facade_tiles', 3);
		this.facades.glass = this.facade('concrete_wall_008', 5);
		this.facades.warehouse = this.facade('corrugated_iron', 3);
	}

	/** Night glow follows the sky, and so do the street lamps' heads. */
	public setNight(amount: number): void
	{
		CityMaterials.night.value = amount;
		this.lampGlow.emissiveIntensity = 0.2 + amount * 6;
	}

	private texture(name: string, kind: string, repeat: number, color: boolean): THREE.Texture
	{
		let key = name + ':' + kind + ':' + repeat;
		if (this.cache[key] !== undefined) return this.cache[key];

		let path = 'build/assets/textures/' + name + '_' + kind + '.webp';
		let entry = this.loadingManager !== undefined ? this.loadingManager.addLoadingEntry(path) : undefined;

		let texture = this.loader.load(path, () =>
		{
			if (entry !== undefined) this.loadingManager.doneLoading(entry);
		}, undefined, () =>
		{
			console.warn('Couldn\'t load texture ' + path);
			if (entry !== undefined) this.loadingManager.doneLoading(entry);
		});

		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.repeat.set(1 / repeat, 1 / repeat);
		texture.anisotropy = this.anisotropy;
		texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
		this.cache[key] = texture;
		return texture;
	}

	/** An ordinary tiled surface: colour, normals, and the AO/roughness/metal pack. */
	private surface(name: string, repeat: number, options: { roughness?: number, metalness?: number }): THREE.MeshStandardMaterial
	{
		let arm = this.texture(name, 'arm', repeat, false);
		let material = new THREE.MeshStandardMaterial({
			map: this.texture(name, 'color', repeat, true),
			normalMap: this.texture(name, 'normal', repeat, false),
			roughnessMap: arm,
			metalnessMap: options.metalness !== undefined ? arm : null,
			aoMap: arm,
			aoMapIntensity: 0.8,
			roughness: options.roughness !== undefined ? options.roughness : 1,
			metalness: options.metalness !== undefined ? options.metalness : 0
		});
		material.name = name;
		return material;
	}

	/**
	 * Lane markings from the road's own coordinates: u across it in units
	 * from the centreline, v along it. The road's layout rides along as an
	 * attribute (lanes each way, lane width, median, parking strip) so one
	 * material paints every kind of road.
	 */
	private static addRoadMarkings(material: THREE.MeshStandardMaterial, key: string): void
	{
		material.userData.shaderKey = key;
		material.onBeforeCompile = (shader) =>
		{
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nattribute vec2 aLane;\nvarying vec4 vRoad;\nvarying vec2 vLane;')
				.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;\nvLane = aLane;');

			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nvarying vec4 vRoad;\nvarying vec2 vLane;\n' + CityMaterials.MARKING_GLSL)
				.replace('#include <map_fragment>', `#include <map_fragment>
					float paintMask = 0.0;
					vec3 paintColor = vec3(0.0);
					roadPaint(vLane.x, vLane.y, vRoad, paintMask, paintColor);
					diffuseColor.rgb = mix(diffuseColor.rgb, paintColor, paintMask);`)
				.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, paintMask);');
		};
	}

	/** Zebra crossings round the edge of a junction's square. */
	private static addCrossings(material: THREE.MeshStandardMaterial): void
	{
		material.userData.shaderKey = 'junction';
		material.onBeforeCompile = (shader) =>
		{
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nattribute vec2 aLane;\nvarying vec4 vRoad;\nvarying vec2 vLane;')
				.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;\nvLane = aLane;');

			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nvarying vec4 vRoad;\nvarying vec2 vLane;')
				.replace('#include <map_fragment>', `#include <map_fragment>
					// vLane is the offset from the junction's centre, vRoad.xy its half size,
					// vRoad.z which sides have a crossing (bits: +x, -x, +z, -z)
					vec2 edge = vRoad.xy - abs(vLane);
					float sides = vRoad.z;
					float onX = vLane.x > 0.0 ? mod(sides, 2.0) : mod(floor(sides / 2.0), 2.0);
					float onZ = vLane.y > 0.0 ? mod(floor(sides / 4.0), 2.0) : mod(floor(sides / 8.0), 2.0);
					float band = 2.4;
					float stripeX = step(0.5, fract(vLane.y / 1.1)) * step(0.35, edge.x) * step(edge.x, band) * onX * step(1.2, edge.y);
					float stripeZ = step(0.5, fract(vLane.x / 1.1)) * step(0.35, edge.y) * step(edge.y, band) * onZ * step(1.2, edge.x);
					float paintMask = max(stripeX, stripeZ) * 0.9;
					diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82), paintMask);`)
				.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, paintMask);');
		};
	}

	/**
	 * u is across the road from the centre line, v along it. aRoad is lanes,
	 * lane width, median width and parking strip width.
	 */
	private static readonly MARKING_GLSL: string = `
		float bandMask(float x, float centre, float halfWidth)
		{
			float w = fwidth(x) * 0.75 + 0.001;
			return smoothstep(centre - halfWidth - w, centre - halfWidth + w, x) * (1.0 - smoothstep(centre + halfWidth - w, centre + halfWidth + w, x));
		}

		void roadPaint(float u, float v, vec4 road, inout float mask, inout vec3 color)
		{
			float lanes = road.x;
			float laneWidth = road.y;
			float median = road.z;
			float parking = road.w;
			float side = abs(u);
			vec3 white = vec3(0.86, 0.86, 0.84);
			vec3 yellow = vec3(0.85, 0.62, 0.12);

			// Down the middle: double yellow, or yellow edges to a median
			float centre = median < 0.1
				? bandMask(side, 0.12, 0.055)
				: bandMask(side, median * 0.5 - 0.1, 0.06);
			if (centre > 0.0) { mask = centre; color = yellow; }

			// Dashed white between lanes going the same way
			float dash = step(fract(v / 9.0), 0.4);
			for (int i = 1; i < 4; i++)
			{
				if (float(i) >= lanes) break;
				float at = median * 0.5 + float(i) * laneWidth;
				float m = bandMask(side, at, 0.06) * dash;
				if (m > mask) { mask = m; color = white; }
			}

			// Solid white along the outside of the traffic lanes
			float outer = median * 0.5 + lanes * laneWidth;
			float edgeLine = bandMask(side, outer, 0.07);
			if (edgeLine > mask) { mask = edgeLine; color = white; }

			// Parking bays: a tick every few metres
			if (parking > 0.1 && side > outer)
			{
				float tick = bandMask(fract(v / 3.6) * 3.6, 0.1, 0.05) * step(side, outer + parking - 0.1);
				if (tick > mask) { mask = tick; color = white; }
			}
			mask *= 0.92;
		}
	`;

	/**
	 * A wall with windows in it. The UVs run along the wall and up it, in
	 * units; aFacade is floor height, bay width, window style and a seed, and
	 * aTint colours the wall. Styles: 0 punched windows, 1 ribbon windows,
	 * 2 curtain wall, 3 warehouse; add 10 for shop windows on the ground floor.
	 */
	private facade(name: string, repeat: number): THREE.MeshStandardMaterial
	{
		let material = this.surface(name, repeat, { roughness: 1 });
		material.name = 'facade_' + name;
		material.userData.shaderKey = 'facade';
		const night = CityMaterials.night;

		material.onBeforeCompile = (shader) =>
		{
			shader.uniforms.nightFactor = night;

			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nattribute vec4 aFacade;\nattribute vec3 aTint;\nvarying vec4 vFacade;\nvarying vec3 vTint;\nvarying vec2 vWall;')
				.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = aFacade;\nvTint = aTint;\nvWall = uv;');

			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', `#include <common>
					varying vec4 vFacade;
					varying vec3 vTint;
					varying vec2 vWall;
					uniform float nightFactor;
					float facadeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
					float boxMask(vec2 f, vec4 r, vec2 w)
					{
						vec2 lo = smoothstep(r.xy - w, r.xy + w, f);
						vec2 hi = 1.0 - smoothstep(r.zw - w, r.zw + w, f);
						return lo.x * lo.y * hi.x * hi.y;
					}`)
				.replace('#include <map_fragment>', `#include <map_fragment>
					float floorHeight = vFacade.x;
					float bay = vFacade.y;
					float style = mod(vFacade.z, 10.0);
					float shops = step(9.5, vFacade.z);
					float seed = vFacade.w;
					vec2 cellSize = vec2(bay, floorHeight);
					vec2 cellPos = vWall / cellSize;
					vec2 cellId = floor(cellPos);
					vec2 f = fract(cellPos);
					vec2 aa = fwidth(cellPos) * 0.8 + 0.001;

					vec4 rect = style < 0.5 ? vec4(0.2, 0.26, 0.8, 0.84)
						: style < 1.5 ? vec4(0.0, 0.3, 1.0, 0.8)
						: style < 2.5 ? vec4(0.04, 0.05, 0.96, 0.95)
						: vec4(0.15, 0.62, 0.85, 0.82);
					bool storefront = shops > 0.5 && cellId.y < 0.5;
					if (storefront) rect = vec4(0.05, 0.06, 0.95, 0.8);
					float glass = boxMask(f, rect, aa);
					// A frame round each window and, under punched ones, a sill
					float frame = max(boxMask(f, rect + vec4(-0.035, -0.03, 0.035, 0.03), aa) - glass, 0.0);
					float sill = style < 0.5 && !storefront ? boxMask(f, vec4(rect.x - 0.05, rect.y - 0.075, rect.z + 0.05, rect.y - 0.03), aa) : 0.0;

					// Warehouses only get windows up high, and not in every bay
					float openings = 1.0;
					if (style > 2.5 && style < 3.5) openings = step(0.55, facadeHash(vec2(cellId.x, seed))) * step(0.5, cellId.y);
					// Nothing below the first floor line on anything but shops, and
					// style 4 is a blank wall: parapets, cornices, gable ends
					openings *= step(0.0, vWall.y - 0.05) * step(style, 3.5);
					glass *= openings;
					frame *= openings;
					sill *= openings;

					// About one window in five lit, whole floors a little more or less so
					float lit = step(facadeHash(cellId + seed * 17.0), 0.12 + 0.16 * facadeHash(vec2(cellId.y, seed)));
					// Blinds drawn in a few windows; hardly any on a glass tower's curtain wall
					float blinds = step(style > 1.5 && style < 2.5 ? 0.93 : 0.8, facadeHash(cellId * 1.7 + seed));

					vec3 wall = diffuseColor.rgb * vTint;
					// A little grime toward the pavement
					wall *= mix(0.78, 1.0, smoothstep(0.0, 3.0, vWall.y));
					bool curtain = style > 1.5 && style < 2.5;
					// Coated glass: grey-blue, and reflective enough to show the sky
					vec3 glassColor = curtain ? vec3(0.30, 0.36, 0.42) : vec3(0.16, 0.18, 0.20);
					glassColor = mix(glassColor, vec3(0.38, 0.36, 0.33), blinds * 0.5);
					if (storefront) glassColor = vec3(0.2, 0.22, 0.24);
					vec3 frameColor = curtain || style > 0.5 ? vec3(0.2, 0.21, 0.22) : vec3(0.8, 0.79, 0.76);
					diffuseColor.rgb = mix(wall, frameColor, frame);
					diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.7, 0.66), sill);
					diffuseColor.rgb = mix(diffuseColor.rgb, glassColor, glass);
					float glassMetal = (curtain ? 0.55 : 0.4) * (1.0 - blinds * 0.6);
					float facadeSmooth = max(max(glass, frame), sill);
					float facadeGlass = glass;
					float facadeLit = lit * glass;
					float facadeBlinds = blinds;`)
				.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, max(frame, sill));\nroughnessFactor = mix(roughnessFactor, mix(0.06, 0.45, facadeBlinds * 0.6), facadeGlass);')
				.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, facadeSmooth));')
				.replace('#include <aomap_fragment>', THREE.ShaderChunk.aomap_fragment.replace('* aoMapIntensity + 1.0', '* aoMapIntensity * (1.0 - facadeSmooth) + 1.0'))
				.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, glassMetal, facadeGlass);')
				.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
					// Warm lamps mostly, the odd cool office, each window its own brightness
					vec3 roomLight = mix(vec3(1.0, 0.72, 0.42), vec3(0.8, 0.88, 1.0), step(0.75, facadeHash(cellId + 3.1)));
					float brightness = 0.35 + 0.65 * facadeHash(cellId * 2.3 + seed);
					totalEmissiveRadiance += roomLight * facadeLit * nightFactor * brightness * 1.1;
					if (storefront) totalEmissiveRadiance += vec3(1.0, 0.82, 0.6) * facadeGlass * nightFactor * 0.9 * step(0.35, facadeHash(vec2(cellId.x, seed)));`);
		};

		return material;
	}
}
