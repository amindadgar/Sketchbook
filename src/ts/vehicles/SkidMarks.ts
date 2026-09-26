import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';

interface Trail
{
	point: THREE.Vector3;
	left: THREE.Vector3;
	right: THREE.Vector3;
	strength: number;
	frame: number;
}

/**
 * Rubber left on the road by tyres that are sliding, locked or spinning.
 *
 * Every mark in the world is one mesh: a long run of quads written into a
 * ring, a new one each time a sliding tyre has moved a hand's width. The
 * oldest are faded out as the ring fills and then written over, so the
 * streets keep the last few minutes of driving without it ever costing more
 * than one draw call.
 */
export class SkidMarks implements IUpdatable
{
	public updateOrder: number = 20;

	private static readonly CAPACITY: number = 8000;
	/** Half a tyre's width. */
	private static readonly HALF_WIDTH: number = 0.085;
	/** How far a tyre moves between one piece of mark and the next. */
	private static readonly STEP: number = 0.28;
	/** Above the road, so a mark doesn't flicker in and out of it. */
	private static readonly LIFT: number = 0.012;

	private mesh: THREE.Mesh;
	private positions: THREE.BufferAttribute;
	private strengths: THREE.BufferAttribute;
	private serials: THREE.BufferAttribute;
	private uniforms: { uSerial: { value: number }, uCapacity: { value: number } };
	private head: number = 0;
	private written: number = 0;
	private frame: number = 0;
	private trails: Map<any, Trail> = new Map();

	private static side: THREE.Vector3 = new THREE.Vector3();
	private static flat: THREE.Vector3 = new THREE.Vector3();

	constructor(world: World)
	{
		let capacity = SkidMarks.CAPACITY;
		let geometry = new THREE.BufferGeometry();
		this.positions = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3);
		this.strengths = new THREE.BufferAttribute(new Float32Array(capacity * 4), 1);
		this.serials = new THREE.BufferAttribute(new Float32Array(capacity * 4), 1);
		for (const attribute of [this.positions, this.strengths, this.serials]) attribute.setUsage(THREE.DynamicDrawUsage);
		geometry.setAttribute('position', this.positions);
		geometry.setAttribute('aStrength', this.strengths);
		geometry.setAttribute('aSerial', this.serials);

		// Each piece joins where the last one ended to where the tyre is now
		let index = new Uint32Array(capacity * 6);
		for (let i = 0; i < capacity; i++)
		{
			let v = i * 4;
			index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
		}
		geometry.setIndex(new THREE.BufferAttribute(index, 1));
		geometry.setDrawRange(0, 0);

		this.uniforms = { uSerial: { value: 0 }, uCapacity: { value: capacity } };
		let material = new THREE.MeshBasicMaterial({
			color: 0x0c0c0c,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			polygonOffset: true,
			polygonOffsetFactor: -4,
			polygonOffsetUnits: -4
		});
		material.onBeforeCompile = (shader) =>
		{
			Object.assign(shader.uniforms, this.uniforms);
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nattribute float aStrength;\nattribute float aSerial;\nuniform float uSerial;\nuniform float uCapacity;\nvarying float vMark;')
				.replace('#include <begin_vertex>', `#include <begin_vertex>
					// The oldest quarter of the ring fades before it's written over
					float age = uSerial - aSerial;
					vMark = aStrength * clamp((uCapacity - age) / (uCapacity * 0.25), 0.0, 1.0);`);
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nvarying float vMark;')
				.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vMark;');
		};
		material.customProgramCacheKey = () => 'skidmarks';

		this.mesh = new THREE.Mesh(geometry, material);
		this.mesh.name = 'skid marks';
		this.mesh.frustumCulled = false;
		// First among the see-through things, since it's on the ground under
		// all of them: smoke and glass in front of a mark then cover it
		this.mesh.renderOrder = -1;
		this.mesh.userData.noOcclusion = true;
		world.graphicsWorld.add(this.mesh);
		world.registerUpdatable(this);
	}

	public update(timeStep: number): void
	{
		this.frame++;
		// A tyre not marked last frame starts afresh next time, so its old
		// trail can go, and with it whatever vehicle it would have kept alive
		this.trails.forEach((trail, key) =>
		{
			if (trail.frame < this.frame - 1) this.trails.delete(key);
		});
	}

	/**
	 * A tyre sliding this frame.
	 * @param key anything that identifies the tyre, so its mark is one unbroken line
	 * @param strength 0 to 1, how dark the mark is
	 */
	public mark(key: any, point: THREE.Vector3, normal: THREE.Vector3, travel: THREE.Vector3, strength: number): void
	{
		let lifted = point.clone().addScaledVector(normal, SkidMarks.LIFT);

		// Across the direction the tyre is going over the road
		let flat = SkidMarks.flat.copy(travel).addScaledVector(normal, -travel.dot(normal));
		if (flat.lengthSq() < 1e-4) return;
		flat.normalize();
		let side = SkidMarks.side.crossVectors(flat, normal).normalize().multiplyScalar(SkidMarks.HALF_WIDTH);
		let left = lifted.clone().add(side);
		let right = lifted.clone().sub(side);

		let trail = this.trails.get(key);
		let broken = trail === undefined || trail.frame < this.frame - 1 || trail.point.distanceTo(lifted) > 3;
		if (broken)
		{
			this.trails.set(key, { point: lifted, left: left, right: right, strength: strength, frame: this.frame });
			return;
		}

		trail.frame = this.frame;
		if (trail.point.distanceTo(lifted) < SkidMarks.STEP) return;

		this.write(trail.left, trail.right, trail.strength, left, right, strength);
		trail.point = lifted;
		trail.left = left;
		trail.right = right;
		trail.strength = strength;
	}

	private write(fromLeft: THREE.Vector3, fromRight: THREE.Vector3, fromStrength: number,
		toLeft: THREE.Vector3, toRight: THREE.Vector3, toStrength: number): void
	{
		let i = this.head;
		let p = this.positions.array as Float32Array;
		let v = i * 12;
		p[v] = fromLeft.x; p[v + 1] = fromLeft.y; p[v + 2] = fromLeft.z;
		p[v + 3] = fromRight.x; p[v + 4] = fromRight.y; p[v + 5] = fromRight.z;
		p[v + 6] = toLeft.x; p[v + 7] = toLeft.y; p[v + 8] = toLeft.z;
		p[v + 9] = toRight.x; p[v + 10] = toRight.y; p[v + 11] = toRight.z;

		let s = this.strengths.array as Float32Array;
		s[i * 4] = s[i * 4 + 1] = fromStrength * 0.62;
		s[i * 4 + 2] = s[i * 4 + 3] = toStrength * 0.62;

		let serial = this.written++;
		let n = this.serials.array as Float32Array;
		n[i * 4] = n[i * 4 + 1] = n[i * 4 + 2] = n[i * 4 + 3] = serial;
		this.uniforms.uSerial.value = this.written;

		this.positions.addUpdateRange(v, 12);
		this.strengths.addUpdateRange(i * 4, 4);
		this.serials.addUpdateRange(i * 4, 4);
		this.positions.needsUpdate = true;
		this.strengths.needsUpdate = true;
		this.serials.needsUpdate = true;

		this.head = (this.head + 1) % SkidMarks.CAPACITY;
		this.mesh.geometry.setDrawRange(0, Math.min(this.written, SkidMarks.CAPACITY) * 6);
	}
}
