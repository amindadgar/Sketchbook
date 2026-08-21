import * as THREE from 'three';

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
	reloadTime: number;
	/** Cone half angle in radians. */
	spread: number;
	range: number;
	/** Bullets per shot, only the shotgun fires more than one. */
	pellets: number;
	color: string;
}

/**
 * Four weapons that want to be used differently: the rifle rewards aim, the
 * shotgun rewards closing the distance, the automatic rewards holding an angle,
 * and the handgun is the one you always have something better than.
 */
export const WEAPONS: WeaponSpec[] = [
	{
		id: 'handgun', name: 'Handgun', color: '#f5d327',
		damage: 25, fireInterval: 0.32, automatic: false,
		magazine: 12, reloadTime: 1.2, spread: 0.012, range: 90, pellets: 1
	},
	{
		id: 'automatic', name: 'Automatic', color: '#35bfd0',
		damage: 13, fireInterval: 0.085, automatic: true,
		magazine: 30, reloadTime: 1.8, spread: 0.035, range: 70, pellets: 1
	},
	{
		id: 'rifle', name: 'Rifle', color: '#9b5cf0',
		damage: 55, fireInterval: 0.95, automatic: false,
		magazine: 8, reloadTime: 2.2, spread: 0.002, range: 250, pellets: 1
	},
	{
		id: 'shotgun', name: 'Shotgun', color: '#e6394a',
		damage: 12, fireInterval: 0.85, automatic: false,
		magazine: 6, reloadTime: 2.0, spread: 0.085, range: 35, pellets: 8
	},
];

export function findWeapon(id: string): WeaponSpec
{
	for (const weapon of WEAPONS)
	{
		if (weapon.id === id) return weapon;
	}

	return undefined;
}

/**
 * Guns built out of boxes rather than modelled, since the project ships no
 * weapon art. At the size they're actually seen, silhouette and colour are what
 * make them tellable apart, so each one gets a distinct one.
 *
 * The group carries a 'muzzle' child marking where shots leave the barrel.
 */
export function buildWeaponModel(spec: WeaponSpec): THREE.Group
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
