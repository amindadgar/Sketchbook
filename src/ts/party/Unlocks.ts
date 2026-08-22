import * as THREE from 'three';

export interface Unlock
{
	id: string;
	label: string;
	/** Kills on the account before it can be picked. Zero means everyone has it. */
	kills: number;
}

/**
 * Things to earn by playing.
 *
 * The server has been counting kills since accounts went in and nothing ever
 * spent them. Four more colours and three hats, gated on the tally, is a use
 * for a number that was only ever written down.
 */
export const COLOURS: Unlock[] = [
	{ id: '#e6394a', label: 'Red', kills: 0 },
	{ id: '#f28f2c', label: 'Orange', kills: 0 },
	{ id: '#f5d327', label: 'Yellow', kills: 0 },
	{ id: '#4cc95d', label: 'Green', kills: 0 },
	{ id: '#35bfd0', label: 'Cyan', kills: 0 },
	{ id: '#3d7ff5', label: 'Blue', kills: 0 },
	{ id: '#9b5cf0', label: 'Purple', kills: 0 },
	{ id: '#f062b4', label: 'Pink', kills: 0 },
	{ id: '#2ee6a8', label: 'Mint', kills: 10 },
	{ id: '#ff5e1a', label: 'Ember', kills: 25 },
	{ id: '#c0c8d4', label: 'Steel', kills: 50 },
	{ id: '#ffd700', label: 'Gold', kills: 100 },
];

export const HATS: Unlock[] = [
	{ id: 'none', label: 'Bare head', kills: 0 },
	{ id: 'cap', label: 'Cap', kills: 5 },
	{ id: 'cone', label: 'Party hat', kills: 20 },
	{ id: 'crown', label: 'Crown', kills: 60 },
];

export function isUnlocked(item: Unlock, kills: number): boolean
{
	return item.kills === 0 || kills >= item.kills;
}

export function findHat(id: string): Unlock
{
	for (const hat of HATS)
	{
		if (hat.id === id) return hat;
	}

	return HATS[0];
}

/**
 * Built from primitives rather than loaded: three hats' worth of geometry is
 * a smaller thing to make than a file to download, and they tint with the
 * player's colour the same way the rest of the body does.
 */
export function buildHat(id: string, color: string): THREE.Object3D
{
	if (id === undefined || id === 'none') return undefined;

	let group = new THREE.Group();
	let tint = new THREE.Color(color);
	let dark = tint.clone().multiplyScalar(0.55);

	if (id === 'cap')
	{
		let crown = new THREE.Mesh(
			new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
			new THREE.MeshLambertMaterial({ color: tint }));

		let peak = new THREE.Mesh(
			new THREE.CylinderGeometry(0.19, 0.19, 0.02, 12, 1, false, -Math.PI / 2.4, Math.PI / 1.2),
			new THREE.MeshLambertMaterial({ color: dark }));
		peak.position.set(0, 0.01, 0.08);

		group.add(crown);
		group.add(peak);
	}
	else if (id === 'cone')
	{
		let cone = new THREE.Mesh(
			new THREE.ConeGeometry(0.15, 0.34, 14),
			new THREE.MeshLambertMaterial({ color: tint }));
		cone.position.y = 0.17;

		let bobble = new THREE.Mesh(
			new THREE.SphereGeometry(0.045, 10, 8),
			new THREE.MeshLambertMaterial({ color: 0xffffff }));
		bobble.position.y = 0.36;

		group.add(cone);
		group.add(bobble);
	}
	else if (id === 'crown')
	{
		let band = new THREE.Mesh(
			new THREE.CylinderGeometry(0.17, 0.17, 0.09, 14, 1, true),
			new THREE.MeshLambertMaterial({ color: 0xffd23d, side: THREE.DoubleSide }));
		band.position.y = 0.05;
		group.add(band);

		// Five points around the band, which is what reads as a crown at a distance
		for (let i = 0; i < 5; i++)
		{
			let spike = new THREE.Mesh(
				new THREE.ConeGeometry(0.045, 0.12, 6),
				new THREE.MeshLambertMaterial({ color: 0xffd23d }));

			let angle = (i / 5) * Math.PI * 2;
			spike.position.set(Math.cos(angle) * 0.15, 0.14, Math.sin(angle) * 0.15);
			group.add(spike);
		}
	}

	group.traverse((child: any) =>
	{
		if (child.isMesh !== true) return;
		child.castShadow = true;
	});

	return group;
}
