import * as THREE from 'three';
import * as CANNON from 'cannon';
import * as _ from 'lodash';
import { SimulationFrame } from '../physics/spring_simulation/SimulationFrame';
import { World } from '../world/World';
import { Side } from '../enums/Side';
import { Object3D } from 'three';
import { Space } from '../enums/Space';

//#region Math

/**
 * Constructs a 2D matrix from first vector, replacing the Y axes with the global Y axis,
 * and applies this matrix to the second vector. Saves performance when compared to full 3D matrix application.
 * Useful for character rotation, as it only happens on the Y axis.
 * @param {Vector3} a Vector to construct 2D matrix from
 * @param {Vector3} b Vector to apply basis to
 */
export function appplyVectorMatrixXZ(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3
{
	return new THREE.Vector3(
		(a.x * b.z + a.z * b.x),
		b.y,
		(a.z * b.z + -a.x * b.x)
	);
}

export function round(value: number, decimals: number = 0): number
{
	return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function roundVector(vector: THREE.Vector3, decimals: number = 0): THREE.Vector3
{
	return new THREE.Vector3(
		round(vector.x, decimals),
		round(vector.y, decimals),
		round(vector.z, decimals),
	);
}

/**
 * Finds an angle between two vectors
 * @param {THREE.Vector3} v1 
 * @param {THREE.Vector3} v2 
 */
export function getAngleBetweenVectors(v1: THREE.Vector3, v2: THREE.Vector3, dotTreshold: number = 0.0005): number
{
	let angle: number;
	let dot = v1.dot(v2);

	// If dot is close to 1, we'll round angle to zero
	if (dot > 1 - dotTreshold)
	{
		angle = 0;
	}
	else
	{
		// Dot too close to -1
		if (dot < -1 + dotTreshold)
		{
			angle = Math.PI;
		}
		else
		{
			// Get angle difference in radians
			angle = Math.acos(dot);
		}
	}

	return angle;
}

/**
 * Finds an angle between two vectors with a sign relative to normal vector
 */
export function getSignedAngleBetweenVectors(v1: THREE.Vector3, v2: THREE.Vector3, normal: THREE.Vector3 = new THREE.Vector3(0, 1, 0), dotTreshold: number = 0.0005): number
{
	let angle = getAngleBetweenVectors(v1, v2, dotTreshold);

	// Get vector pointing up or down
	let cross = new THREE.Vector3().crossVectors(v1, v2);
	// Compare cross with normal to find out direction
	if (normal.dot(cross) < 0)
	{
		angle = -angle;
	}

	return angle;
}

export function haveSameSigns(n1: number, n2: number): boolean
{
	return (n1 < 0) === (n2 < 0);
}

export function haveDifferentSigns(n1: number, n2: number): boolean
{
	return (n1 < 0) !== (n2 < 0);
}

//#endregion

//#region Miscellaneous

export function setDefaults(options: {}, defaults: {}): {}
{
	return _.defaults({}, _.clone(options), defaults);
}

export function getGlobalProperties(prefix: string = ''): any[]
{
	let keyValues = [];
	let global = window; // window for browser environments
	for (let prop in global)
	{
		// check the prefix
		if (prop.indexOf(prefix) === 0) {
			keyValues.push(prop /*+ "=" + global[prop]*/);
		}
	}
	return keyValues; // build the string
}

export function spring(source: number, dest: number, velocity: number, mass: number, damping: number): SimulationFrame
{
	let acceleration = dest - source;
	acceleration /= mass;
	velocity += acceleration;
	velocity *= damping;

	let position = source + velocity;

	return new SimulationFrame(position, velocity);
}

export function springV(source: THREE.Vector3, dest: THREE.Vector3, velocity: THREE.Vector3, mass: number, damping: number): void
{
	let acceleration = new THREE.Vector3().subVectors(dest, source);
	acceleration.divideScalar(mass);
	velocity.add(acceleration);
	velocity.multiplyScalar(damping);
	source.add(velocity);
}

export function threeVector(vec: CANNON.Vec3): THREE.Vector3
{
	return new THREE.Vector3(vec.x, vec.y, vec.z);
}

export function cannonVector(vec: THREE.Vector3): CANNON.Vec3
{
	return new CANNON.Vec3(vec.x, vec.y, vec.z);
}

export function threeQuat(quat: CANNON.Quaternion): THREE.Quaternion
{
	return new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w);
}

export function cannonQuat(quat: THREE.Quaternion): CANNON.Quaternion
{
	return new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w);
}

/**
 * Shadows on, and the materials left as they were authored: physically based,
 * straight out of the glTF. They used to be swapped for flat Phong ones, which
 * threw away their roughness and bump detail and is most of why everything
 * looked like plastic.
 */
export function setupMeshProperties(child: any): void
{
	child.castShadow = true;
	child.receiveShadow = true;

	let materials = Array.isArray(child.material) ? child.material : [child.material];
	materials.forEach((mat: any) =>
	{
		if (mat === undefined || mat === null) return;
		if (mat.map) mat.map.anisotropy = 8;
		if (mat.normalMap) mat.normalMap.anisotropy = 8;
	});
}

/**
 * Car paint: the painted texture under a clear coat that reflects the sky,
 * which does more than anything else to stop a car looking like a toy. The
 * material is swapped once per loaded model, and every car of that model
 * shares it until something tints one.
 */
export function paintVehicle(child: any): void
{
	let material = child.material;
	if (material === undefined || material === null || material.isMeshPhysicalMaterial === true) return;

	if (material.name === 'Car')
	{
		let paint = new THREE.MeshPhysicalMaterial({
			name: material.name,
			map: material.map,
			color: material.color,
			roughness: 0.38,
			metalness: 0.2,
			clearcoat: 1,
			clearcoatRoughness: 0.06
		});
		child.material = paint;
	}
	else if (material.name === 'Wheel')
	{
		material.roughness = 0.75;
		material.metalness = 0.1;
	}
}

export function detectRelativeSide(from: Object3D, to: Object3D): Side
{
	const right = getRight(from, Space.Local);
	const viewVector = to.position.clone().sub(from.position).normalize();

	return right.dot(viewVector) > 0 ? Side.Left : Side.Right;
}

export function easeInOutSine(x: number): number
{
	return -(Math.cos(Math.PI * x) - 1) / 2;
}

export function easeOutQuad(x: number): number
{
	return 1 - (1 - x) * (1 - x);
}

export function getRight(obj: THREE.Object3D, space: Space = Space.Global): THREE.Vector3
{
	const matrix = getMatrix(obj, space);
	return new THREE.Vector3(
		matrix.elements[0],
		matrix.elements[1],
		matrix.elements[2]
		);
}

export function getUp(obj: THREE.Object3D, space: Space = Space.Global): THREE.Vector3
{
	const matrix = getMatrix(obj, space);
	return new THREE.Vector3(
		matrix.elements[4],
		matrix.elements[5],
		matrix.elements[6]
		);
}

export function getForward(obj: THREE.Object3D, space: Space = Space.Global): THREE.Vector3
{
	const matrix = getMatrix(obj, space);
	return new THREE.Vector3(
		matrix.elements[8],
		matrix.elements[9],
		matrix.elements[10]
		);
}

export function getBack(obj: THREE.Object3D, space: Space = Space.Global): THREE.Vector3
{
	const matrix = getMatrix(obj, space);
	return new THREE.Vector3(
		-matrix.elements[8],
		-matrix.elements[9],
		-matrix.elements[10]
		);
}

export function getMatrix(obj: THREE.Object3D, space: Space): THREE.Matrix4
{
	switch (space)
	{
		case Space.Local: return obj.matrix;
		case Space.Global: return obj.matrixWorld;
	}
}

export function countSleepyBodies(): any
{
	// let awake = 0;
	// let sleepy = 0;
	// let asleep = 0;
	// this.physicsWorld.bodies.forEach((body) =>
	// {
	//     if (body.sleepState === 0) awake++;
	//     if (body.sleepState === 1) sleepy++;
	//     if (body.sleepState === 2) asleep++;
	// });
}

//#endregion

/** Small seeded random number generator, so every client makes the same choices. */
export function mulberry32(seed: number): () => number
{
	let a = seed >>> 0;
	return () =>
	{
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
