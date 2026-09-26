import * as THREE from 'three';
import { CityContext, BreakableSpec, InstanceRef } from './CityContext';
import { Vegetation, mergeGeometries } from './Vegetation';
import { createGLTFLoader } from '../core/Loaders';
import { LoadingManager } from '../core/LoadingManager';

/**
 * The things along a street: lamps, traffic signals, trees, and the props
 * from Poly Haven. Simple shapes are made here; the props arrive in one file
 * and are set up as kinds once it's in, before the instances are drawn.
 */
export class StreetFurniture
{
	public static readonly PROPS: string[] = ['street_lamp_01', 'street_lamp_02', 'fire_hydrant', 'metal_trash_can',
		'modular_street_seating', 'concrete_road_barrier', 'utility_box_01', 'planter_box_01'];

	/** How far the lamp's head reaches out over the road from the pole. */
	public static readonly LAMP_REACH: number = 1.7;
	public static readonly LAMP_HEIGHT: number = 5.6;

	private context: CityContext;
	private poolMaterial: THREE.MeshBasicMaterial;

	constructor(context: CityContext)
	{
		this.context = context;
		let m = context.materials;

		this.context.defineKind('lamp', [
			{ geometry: StreetFurniture.lampPole(), material: m.darkMetal },
			{ geometry: StreetFurniture.lampHead(), material: m.lampGlow }
		], false, 300);
		this.context.defineKind('signal', [
			{ geometry: StreetFurniture.signalFrame(), material: m.darkMetal }
		], false, 260);

		// Pools of lamplight on the road, which is what sells a street at night
		// without a real light per lamp
		this.poolMaterial = new THREE.MeshBasicMaterial({
			map: StreetFurniture.poolTexture(),
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			opacity: 0,
			polygonOffset: true,
			polygonOffsetFactor: -2,
			fog: true
		});
		let pool = new THREE.PlaneGeometry(7, 7);
		pool.rotateX(-Math.PI / 2);
		this.context.defineKind('lightPool', [{ geometry: pool, material: this.poolMaterial }], false, 280);

		let leaves = Vegetation.leafMaterial();
		let bark = Vegetation.barkMaterial(false);
		for (let i = 0; i < Vegetation.TREE_VARIANTS; i++)
		{
			let tree = Vegetation.tree(i);
			this.context.defineKind('tree' + i, [{ geometry: tree.trunk, material: bark }, { geometry: tree.crown, material: leaves }], true, 330);
		}

		let fronds = Vegetation.frondMaterial();
		let palmBark = Vegetation.barkMaterial(true);
		for (let i = 0; i < Vegetation.TREE_VARIANTS; i++)
		{
			let palm = Vegetation.palm(i);
			this.context.defineKind('palm' + i, [{ geometry: palm.trunk, material: palmBark }, { geometry: palm.crown, material: fronds }], true, 450);
		}
		this.context.defineKind('shrub', [{ geometry: Vegetation.shrub(0), material: leaves }], false, 200);

		// Rooftop clutter
		let ac = new THREE.BoxGeometry(1.3, 0.8, 1.0);
		ac.translate(0, 0.4, 0);
		this.context.defineKind('ac', [{ geometry: ac, material: m.metal }], false, 300);
		let tank = new THREE.CylinderGeometry(1.0, 1.0, 1.8, 12);
		tank.translate(0, 2.3, 0);
		let legs = new THREE.BoxGeometry(1.4, 1.4, 1.4);
		legs.translate(0, 0.7, 0);
		this.context.defineKind('tank', [{ geometry: tank, material: m.planks }, { geometry: legs, material: m.darkMetal }], true, 400);
		let antenna = new THREE.CylinderGeometry(0.05, 0.08, 6, 5);
		antenna.translate(0, 3, 0);
		this.context.defineKind('antenna', [{ geometry: antenna, material: m.darkMetal }], false, 900);

		// Harbour bollards
		let bollard = new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8);
		bollard.translate(0, 0.25, 0);
		this.context.defineKind('bollard', [{ geometry: bollard, material: m.darkMetal }], false, 140);
	}

	public setNight(amount: number): void
	{
		this.poolMaterial.opacity = amount * 0.55;
		this.poolMaterial.visible = amount > 0.02;
	}

	/** Loads the props file and defines a kind per prop. Instances can be placed before it arrives. */
	public loadProps(loadingManager: LoadingManager, onLoaded: () => void): void
	{
		let path = 'build/assets/props.glb';
		let entry = loadingManager !== undefined ? loadingManager.addLoadingEntry(path) : undefined;
		createGLTFLoader().load(path, (gltf) =>
		{
			for (const name of StreetFurniture.PROPS)
			{
				let root = gltf.scene.getObjectByName(name);
				if (root === undefined) continue;
				let parts: { geometry: THREE.BufferGeometry, material: THREE.Material }[] = [];
				root.updateMatrixWorld(true);
				let rootInverse = root.matrixWorld.clone().invert();
				root.traverse((child: any) =>
				{
					if (!child.isMesh) return;
					// Relative to the prop's own origin, since the file lays them out in a row
					let geometry = child.geometry.clone();
					geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld));
					parts.push({ geometry: geometry, material: child.material });
				});
				// Small things neither cast shadows nor get drawn from far off;
				// the old style lamps are tall enough to be seen down a street
				let lamp = name.startsWith('street_lamp');
				this.context.defineKind(name, parts, false, lamp ? 300 : 170);
			}
			onLoaded();
			if (entry !== undefined) loadingManager.doneLoading(entry);
		}, undefined, () =>
		{
			console.warn('Couldn\'t load the street props');
			if (entry !== undefined) loadingManager.doneLoading(entry);
		});
	}

	/**
	 * A street light: a pole, and an arm reaching over the road with the head
	 * on the end. Built pointing along +Z, the direction it lights.
	 */
	private static lampPole(): THREE.BufferGeometry
	{
		let pole = new THREE.CylinderGeometry(0.04, 0.065, StreetFurniture.LAMP_HEIGHT, 8);
		pole.translate(0, StreetFurniture.LAMP_HEIGHT / 2, 0);
		let arm = new THREE.CylinderGeometry(0.035, 0.035, StreetFurniture.LAMP_REACH, 6);
		arm.rotateX(Math.PI / 2 - 0.12);
		arm.translate(0, StreetFurniture.LAMP_HEIGHT - 0.05 + 0.1, StreetFurniture.LAMP_REACH / 2);
		let housing = new THREE.BoxGeometry(0.34, 0.14, 0.78);
		housing.translate(0, StreetFurniture.LAMP_HEIGHT + 0.15, StreetFurniture.LAMP_REACH + 0.2);
		let base = new THREE.CylinderGeometry(0.1, 0.12, 0.45, 8);
		base.translate(0, 0.25, 0);
		return mergeGeometries([pole, arm, housing, base]);
	}

	private static lampHead(): THREE.BufferGeometry
	{
		let lens = new THREE.BoxGeometry(0.26, 0.04, 0.62);
		lens.translate(0, StreetFurniture.LAMP_HEIGHT + 0.07, StreetFurniture.LAMP_REACH + 0.2);
		return lens;
	}

	/**
	 * A signal mast: pole on the corner, arm out over the lanes, and the
	 * housing hanging off it facing the oncoming traffic, which is +Z. The
	 * lights themselves are the traffic system's to draw, since they change.
	 */
	private static signalFrame(): THREE.BufferGeometry
	{
		let pole = new THREE.CylinderGeometry(0.055, 0.08, 4.6, 8);
		pole.translate(0, 2.3, 0);
		let arm = new THREE.BoxGeometry(4.2, 0.1, 0.1);
		arm.translate(-2.1, 4.4, 0);
		let housing = new THREE.BoxGeometry(0.34, 1.0, 0.26);
		housing.translate(-3.6, 3.85, 0);
		let visor = new THREE.BoxGeometry(0.4, 0.04, 0.2);
		visor.translate(-3.6, 4.37, 0.18);
		let pedestrian = new THREE.BoxGeometry(0.3, 0.5, 0.22);
		pedestrian.translate(0, 2.6, 0.12);
		return mergeGeometries([pole, arm, housing, visor, pedestrian]);
	}

	/**
	 * A street light as something a car can knock down: the pole solid until
	 * then, and the pole with its arm and head as the piece that falls. The
	 * median lights have an arm each way.
	 */
	public static lampBreakable(base: THREE.Vector3, yaw: number, scale: number,
		instances: { ref: InstanceRef, falls: boolean }[], bothWays: boolean = false): BreakableSpec
	{
		let height = StreetFurniture.LAMP_HEIGHT * scale;
		let reach = (StreetFurniture.LAMP_REACH + 0.6) * scale;
		return {
			position: base.clone(), yaw: yaw,
			size: new THREE.Vector3(0.22 * scale, height, 0.22 * scale),
			pieces: [
				{ center: new THREE.Vector3(0, height / 2, 0), size: new THREE.Vector3(0.14 * scale, height, 0.14 * scale) },
				{ center: new THREE.Vector3(0, height + 0.12 * scale, bothWays ? 0 : reach / 2), size: new THREE.Vector3(0.34 * scale, 0.24 * scale, bothWays ? reach * 2 : reach) }
			],
			mass: 3, strength: 3, keep: 0.82,
			instances: instances
		};
	}

	/** A signal mast: the pole, and the arm reaching out over the road with the lights on it. */
	public static signalBreakable(base: THREE.Vector3, yaw: number, mast: InstanceRef, lenses: number[]): BreakableSpec
	{
		return {
			position: base.clone(), yaw: yaw,
			size: new THREE.Vector3(0.24, 4.6, 0.24),
			pieces: [
				{ center: new THREE.Vector3(0, 2.3, 0), size: new THREE.Vector3(0.16, 4.6, 0.16) },
				{ center: new THREE.Vector3(-2.1, 4.2, 0), size: new THREE.Vector3(4.2, 0.5, 0.3) }
			],
			mass: 5, strength: 3.5, keep: 0.78,
			instances: [{ ref: mast, falls: true }],
			lenses: lenses
		};
	}

	/** A small thing on the pavement that goes over whole: a hydrant, a bin, a bench. */
	public static propBreakable(base: THREE.Vector3, yaw: number, size: THREE.Vector3, ref: InstanceRef, mass: number): BreakableSpec
	{
		return {
			position: base.clone(), yaw: yaw,
			size: size.clone(),
			pieces: [{ center: new THREE.Vector3(0, size.y / 2, 0), size: size.clone() }],
			mass: mass, strength: 2, keep: 0.94,
			instances: [{ ref: ref, falls: true }],
			fit: true
		};
	}

	/** Where each of a signal's three lamps sits, relative to its frame, facing +Z. */
	public static readonly SIGNAL_LAMPS: THREE.Vector3[] = [
		new THREE.Vector3(-3.6, 4.15, 0.14),
		new THREE.Vector3(-3.6, 3.85, 0.14),
		new THREE.Vector3(-3.6, 3.55, 0.14)
	];

	private static poolTexture(): THREE.Texture
	{
		let size = 128;
		let canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		let ctx = canvas.getContext('2d');
		let gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		gradient.addColorStop(0, 'rgba(255, 214, 150, 1)');
		gradient.addColorStop(0.45, 'rgba(255, 190, 120, 0.45)');
		gradient.addColorStop(1, 'rgba(255, 170, 100, 0)');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, size, size);
		let texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		return texture;
	}
}
