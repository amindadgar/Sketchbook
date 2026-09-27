import * as THREE from 'three';
import { createGLTFLoader } from '../core/Loaders';

import catalogue from '../../../shared/weapons.json';

export interface WeaponSpec
{
	id: string;
	name: string;
	/** Damage per bullet that lands. Characters start on 100. */
	damage: number;
	/** Seconds between shots. */
	fireInterval: number;
	/** Held trigger keeps firing, otherwise one shot per click. */
	automatic: boolean;
	magazine: number;
	/** Spare rounds carried beyond the loaded magazine. Runs out for good. */
	reserve: number;
	reloadTime: number;
	/** Cone half angle in radians. */
	spread: number;
	range: number;
	/** Bullets per shot, only the shotgun fires more than one. */
	pellets: number;
	/** Degrees the view kicks up per shot, and settles back down from. */
	recoil: number;
	color: string;
	/** Dollars at a gun shop, and for another magazine's worth of spare rounds. */
	price: number;
	ammoPrice: number;
	/** Held and aimed in one hand. Everything longer gets the other hand under it. */
	oneHanded?: boolean;
	/** The view narrows to this while aiming, for a scope. */
	zoomFov?: number;
	/** Another gun's report, played at a different pitch, when this one has none of its own. */
	sound?: string;
	soundPitch?: number;
	/** False for guns only ever sold, never lying about to be picked up. */
	pickup?: boolean;
}

/**
 * Guns that want to be used differently: the rifles reward aim, the shotgun
 * rewards closing the distance, the automatics reward holding an angle, and
 * the handgun is the one you always have something better than. The first
 * four lie about the map to be picked up; the rest are only sold.
 *
 * The numbers live in shared/weapons.json because the relay checks incoming
 * hits against them. A second copy over there would drift from this one and
 * start turning honest shots away.
 */
export const WEAPONS: WeaponSpec[] = (catalogue as any).weapons;

export function findWeapon(id: string): WeaponSpec
{
	for (const weapon of WEAPONS)
	{
		if (weapon.id === id) return weapon;
	}

	return undefined;
}

/** Each gun's model, loaded once and copied for every hand and pickup that shows it. */
const gunModels: { [id: string]: Promise<THREE.Object3D> } = {};

function loadGunModel(id: string): Promise<THREE.Object3D>
{
	if (gunModels[id] === undefined)
	{
		gunModels[id] = new Promise((resolve, reject) =>
		{
			createGLTFLoader().load('build/assets/guns/' + id + '.glb', (gltf) =>
			{
				gltf.scene.traverse((child: any) =>
				{
					if (child.isMesh) child.castShadow = true;
				});
				resolve(gltf.scene);
			}, undefined, reject);
		});
	}
	return gunModels[id];
}

/**
 * A gun: the modelled one, from the CC0 guns pack, once it has loaded, and
 * until then one built out of boxes in its shape and colour, so a gun is in
 * the hand the moment it's picked up. Both share an origin at the top of the
 * grip, the barrel along +z, so the swap doesn't move it.
 *
 * The group carries a 'muzzle' child marking where shots leave the barrel.
 */
export function buildWeaponModel(spec: WeaponSpec): THREE.Group
{
	let group = buildBoxModel(spec);

	loadGunModel(spec.id).then((model) =>
	{
		for (const child of group.children.slice())
		{
			group.remove(child);
			let mesh = child as THREE.Mesh;
			if (mesh.isMesh)
			{
				mesh.geometry.dispose();
				(mesh.material as THREE.Material).dispose();
			}
		}
		// Shares the loaded geometry and textures, which nothing ever frees
		group.add(model.clone(true));
	}).catch(() =>
	{
		// Offline or missing: the boxes will do
	});

	return group;
}

/**
 * Guns built out of boxes. At the size they're actually seen, silhouette and
 * colour are what make them tellable apart, so each one gets a distinct one.
 */
function buildBoxModel(spec: WeaponSpec): THREE.Group
{
	let group = new THREE.Group();

	let metal = new THREE.MeshPhongMaterial({ color: 0x2b2f36, shininess: 30 });
	let accent = new THREE.MeshPhongMaterial({ color: new THREE.Color(spec.color), shininess: 40 });

	let add = (material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) =>
	{
		let mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
		mesh.position.set(x, y, z);
		mesh.castShadow = true;
		group.add(mesh);
		return mesh;
	};

	let barrelLength: number;

	switch (spec.id)
	{
		case 'handgun':
			barrelLength = 0.22;
			add(metal, 0.05, 0.09, 0.24, 0, 0, 0.02);
			add(accent, 0.045, 0.13, 0.06, 0, -0.10, -0.05);
			break;

		case 'automatic':
			barrelLength = 0.34;
			add(metal, 0.05, 0.09, 0.36, 0, 0, 0.06);
			add(accent, 0.04, 0.16, 0.07, 0, -0.11, -0.02);
			add(metal, 0.04, 0.10, 0.10, 0, -0.02, -0.14);
			break;

		case 'rifle':
			barrelLength = 0.52;
			add(metal, 0.045, 0.07, 0.62, 0, 0, 0.14);
			add(accent, 0.04, 0.09, 0.20, 0, -0.03, -0.26);
			add(metal, 0.035, 0.11, 0.05, 0, -0.09, -0.04);
			// Scope, the giveaway that this is the long range one
			add(accent, 0.04, 0.04, 0.20, 0, 0.08, 0.04);
			break;

		case 'shotgun':
			barrelLength = 0.46;
			add(metal, 0.09, 0.06, 0.54, 0, 0.01, 0.10);
			add(accent, 0.05, 0.10, 0.22, 0, -0.04, -0.24);
			add(metal, 0.05, 0.09, 0.05, 0, -0.07, -0.02);
			break;

		case 'heavy_pistol':
			barrelLength = 0.25;
			add(metal, 0.055, 0.1, 0.27, 0, 0, 0.03);
			add(accent, 0.05, 0.14, 0.065, 0, -0.11, -0.05);
			add(metal, 0.03, 0.03, 0.05, 0, 0.065, -0.08);
			break;

		case 'smg':
			barrelLength = 0.3;
			add(metal, 0.05, 0.08, 0.3, 0, 0, 0.05);
			add(metal, 0.035, 0.18, 0.045, 0, -0.12, 0.08);
			add(accent, 0.04, 0.12, 0.06, 0, -0.09, -0.04);
			add(metal, 0.02, 0.05, 0.16, 0, 0.0, -0.17);
			break;

		case 'assault_rifle':
			barrelLength = 0.58;
			add(metal, 0.05, 0.085, 0.5, 0, 0, 0.08);
			add(metal, 0.03, 0.03, 0.22, 0, 0.005, 0.42);
			add(accent, 0.045, 0.16, 0.06, 0, -0.12, 0.1);
			add(metal, 0.035, 0.1, 0.05, 0, -0.08, -0.05);
			add(accent, 0.045, 0.09, 0.22, 0, -0.03, -0.26);
			add(metal, 0.03, 0.035, 0.12, 0, 0.065, 0.06);
			break;

		case 'sniper':
			barrelLength = 0.78;
			add(metal, 0.045, 0.075, 0.62, 0, 0, 0.12);
			add(metal, 0.025, 0.025, 0.32, 0, 0.005, 0.58);
			add(accent, 0.045, 0.1, 0.26, 0, -0.03, -0.3);
			add(metal, 0.035, 0.11, 0.05, 0, -0.09, -0.04);
			// A long scope, fatter at the ends
			add(metal, 0.035, 0.035, 0.26, 0, 0.085, 0.08);
			add(metal, 0.05, 0.05, 0.05, 0, 0.085, 0.22);
			add(metal, 0.045, 0.045, 0.05, 0, 0.085, -0.06);
			break;

		default:
			barrelLength = 0.25;
			add(metal, 0.05, 0.09, 0.26, 0, 0, 0.02);
			break;
	}

	let muzzle = new THREE.Object3D();
	muzzle.name = 'muzzle';
	muzzle.position.set(0, 0.01, barrelLength);
	group.add(muzzle);

	return group;
}

let flashTexture: THREE.CanvasTexture;

/** A soft radial blob, drawn once and shared by every muzzle flash. */
export function getFlashTexture(): THREE.CanvasTexture
{
	if (flashTexture !== undefined) return flashTexture;

	let canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;

	let context = canvas.getContext('2d');
	let gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
	gradient.addColorStop(0.0, 'rgba(255, 255, 240, 1)');
	gradient.addColorStop(0.25, 'rgba(255, 214, 120, 0.95)');
	gradient.addColorStop(0.55, 'rgba(255, 140, 40, 0.5)');
	gradient.addColorStop(1.0, 'rgba(255, 90, 0, 0)');

	context.fillStyle = gradient;
	context.fillRect(0, 0, 64, 64);

	flashTexture = new THREE.CanvasTexture(canvas);
	return flashTexture;
}
