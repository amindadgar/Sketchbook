import * as THREE from 'three';
import * as CANNON from 'cannon';
import { GeometryBatch } from './GeometryBatch';
import { CityMaterials } from './CityMaterials';
import { CollisionGroups } from '../enums/CollisionGroups';

/** One placed copy of a kind: which kind, which district's set, which copy in it. */
export interface InstanceRef
{
	kind: string;
	chunk: string;
	index: number;
	matrix: THREE.Matrix4;
}

/**
 * Something a car snaps off rather than stops dead against: street lights,
 * signal masts, hydrants, bins. Solid to anyone walking into it, and to a car
 * nudging it, but hit at any speed it comes away and falls over.
 */
export interface BreakableSpec
{
	/** The base, on the ground, and which way it faces. */
	position: THREE.Vector3;
	yaw: number;
	/** The solid part, a box standing on the base. */
	size: THREE.Vector3;
	/** Boxes for the loose piece once it's broken off, relative to the base and turned with it. */
	pieces: { center: THREE.Vector3, size: THREE.Vector3 }[];
	mass: number;
	/** Slowest a car can be going and still knock it over. */
	strength: number;
	/** How much of its speed a car keeps going through it. */
	keep: number;
	/** What's drawn: the copies to hide when it's knocked over, and whether each falls with it. */
	instances: { ref: InstanceRef, falls: boolean }[];
	/** Traffic light lenses on it, by index into the city's lens set. */
	lenses?: number[];
	/** The loose piece sized to what's drawn rather than to the pieces given, for props from a file. */
	fit?: boolean;
}

export interface Breakable extends BreakableSpec
{
	id: number;
	shape: CANNON.Box;
	body: CANNON.Body;
	offset: CANNON.Vec3;
	orientation: CANNON.Quaternion;
	broken: boolean;
	brokenAt: number;
}

/**
 * Everything the city's builders write into.
 *
 * Geometry goes into batches keyed by district and material, and each batch
 * becomes one mesh, so a district's roads are one draw call and it can be
 * culled as a whole when it's behind the camera. Colliders go into one static
 * body per district for the same reason: the physics engine sorts and tests
 * bodies, and a thousand buildings as a thousand bodies would cost it far
 * more than twenty bodies of fifty boxes each. Repeated props are counted
 * here and drawn instanced, again one set per district.
 */
export class CityContext
{
	public static readonly CHUNK: number = 160;

	public materials: CityMaterials;
	public group: THREE.Group = new THREE.Group();
	public bodies: { [key: string]: CANNON.Body } = {};
	/** Breakable things, by id, which is the same on every client since the city is. */
	public breakables: Breakable[] = [];
	/** Their colliders, a body per district of their own, so one can be taken out cheaply. */
	private breakableBodies: { [key: string]: CANNON.Body } = {};

	private batches: { [key: string]: { batch: GeometryBatch, material: THREE.Material, shadows: boolean } } = {};
	private instances: { [kind: string]: { [chunk: string]: THREE.Matrix4[] } } = {};
	private instanceColors: { [kind: string]: { [chunk: string]: THREE.Color[] } } = {};
	private kinds: { [kind: string]: { parts: { geometry: THREE.BufferGeometry, material: THREE.Material }[], shadows: boolean, drawDistance: number } } = {};
	/** The instanced meshes drawn for each kind in each district, once built. */
	private built: { [kind: string]: { [chunk: string]: THREE.InstancedMesh[] } } = {};
	/** Copies not to draw, 'kind|chunk|index', kept for sets that aren't built yet. */
	private hidden: Set<string> = new Set();
	private static readonly NOWHERE: THREE.Matrix4 = new THREE.Matrix4().makeScale(0, 0, 0);
	/** Everything with a draw distance, checked against the camera now and then. */
	public culled: THREE.Object3D[] = [];

	constructor(materials: CityMaterials)
	{
		this.materials = materials;
		this.group.name = 'city';
	}

	public static chunkOf(x: number, z: number): string
	{
		return Math.floor(x / CityContext.CHUNK) + ',' + Math.floor(z / CityContext.CHUNK);
	}

	/** The batch for a material in the district a point is in. */
	public batch(material: THREE.Material, x: number, z: number, extras: { [name: string]: number } = {}, shadows: boolean = true): GeometryBatch
	{
		let key = CityContext.chunkOf(x, z) + '|' + material.uuid;
		let entry = this.batches[key];
		if (entry === undefined)
		{
			entry = { batch: new GeometryBatch(extras), material: material, shadows: shadows };
			this.batches[key] = entry;
		}
		return entry.batch;
	}

	/** A box collider, turned by the given rotation, into the district's body. */
	public collider(center: THREE.Vector3, size: THREE.Vector3, quaternion?: THREE.Quaternion): void
	{
		let body = CityContext.districtBody(this.bodies, center);
		let shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
		shape.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
		let offset = new CANNON.Vec3(center.x - body.position.x, center.y - body.position.y, center.z - body.position.z);
		let orientation = quaternion !== undefined
			? new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
			: undefined;
		body.addShape(shape, offset, orientation);
	}

	private static districtBody(bodies: { [key: string]: CANNON.Body }, center: THREE.Vector3): CANNON.Body
	{
		let key = CityContext.chunkOf(center.x, center.z);
		let body = bodies[key];
		if (body === undefined)
		{
			let [cx, cz] = key.split(',').map((v) => (Number(v) + 0.5) * CityContext.CHUNK);
			body = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(cx, 15, cz) });
			let material = new CANNON.Material('cityMat');
			material.friction = 0.3;
			body.material = material;
			bodies[key] = body;
		}
		return body;
	}

	/** Something that stands solid until a car hits it hard enough. */
	public breakable(spec: BreakableSpec): Breakable
	{
		let center = spec.position.clone();
		center.y += spec.size.y / 2;
		let body = CityContext.districtBody(this.breakableBodies, center);
		let shape = new CANNON.Box(new CANNON.Vec3(spec.size.x / 2, spec.size.y / 2, spec.size.z / 2));
		shape.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
		let offset = new CANNON.Vec3(center.x - body.position.x, center.y - body.position.y, center.z - body.position.z);
		let orientation = new CANNON.Quaternion();
		orientation.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spec.yaw);
		body.addShape(shape, offset, orientation);

		let breakable: Breakable = Object.assign({
			id: this.breakables.length,
			shape: shape, body: body, offset: offset, orientation: orientation,
			broken: false, brokenAt: 0
		}, spec);
		this.breakables.push(breakable);
		return breakable;
	}

	/** Takes a breakable's collider out of the world, or puts it back. */
	public setBreakableSolid(breakable: Breakable, solid: boolean): void
	{
		let body = breakable.body;
		let index = body.shapes.indexOf(breakable.shape);
		if (solid && index < 0)
		{
			body.addShape(breakable.shape, breakable.offset, breakable.orientation);
		}
		else if (!solid && index >= 0)
		{
			body.shapes.splice(index, 1);
			body.shapeOffsets.splice(index, 1);
			body.shapeOrientations.splice(index, 1);
			body.updateBoundingRadius();

			// With nothing left, working the box out again would leave the old
			// one in place, and the broadphase would pair things by a box that
			// no longer exists
			if (body.shapes.length === 0)
			{
				body.aabb.lowerBound.copy(body.position);
				body.aabb.upperBound.copy(body.position);
			}
		}
		body.aabbNeedsUpdate = true;
	}

	/** Registers something drawn many times over. Parts share every instance's transform. */
	public defineKind(kind: string, parts: { geometry: THREE.BufferGeometry, material: THREE.Material }[], shadows: boolean = true, drawDistance: number = 260): void
	{
		this.kinds[kind] = { parts: parts, shadows: shadows, drawDistance: drawDistance };
	}

	public hasKind(kind: string): boolean
	{
		return this.kinds[kind] !== undefined;
	}

	public place(kind: string, position: THREE.Vector3, yaw: number = 0, scale: number = 1, color?: THREE.Color): InstanceRef
	{
		let chunk = CityContext.chunkOf(position.x, position.z);
		if (this.instances[kind] === undefined) this.instances[kind] = {};
		if (this.instances[kind][chunk] === undefined) this.instances[kind][chunk] = [];
		let matrix = new THREE.Matrix4().compose(position,
			new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
			new THREE.Vector3(scale, scale, scale));
		let ref: InstanceRef = { kind: kind, chunk: chunk, index: this.instances[kind][chunk].length, matrix: matrix };
		this.instances[kind][chunk].push(matrix);

		if (color !== undefined)
		{
			if (this.instanceColors[kind] === undefined) this.instanceColors[kind] = {};
			if (this.instanceColors[kind][chunk] === undefined) this.instanceColors[kind][chunk] = [];
			this.instanceColors[kind][chunk].push(color);
		}
		return ref;
	}

	/** The geometry and materials a kind is drawn with. */
	public partsOf(kind: string): { geometry: THREE.BufferGeometry, material: THREE.Material }[]
	{
		let definition = this.kinds[kind];
		return definition !== undefined ? definition.parts : [];
	}

	/** Stops drawing one placed copy, or draws it again. */
	public setInstanceHidden(ref: InstanceRef, hidden: boolean): void
	{
		let key = ref.kind + '|' + ref.chunk + '|' + ref.index;
		if (hidden) this.hidden.add(key);
		else this.hidden.delete(key);

		let meshes = this.built[ref.kind] !== undefined ? this.built[ref.kind][ref.chunk] : undefined;
		if (meshes === undefined) return;
		for (const mesh of meshes)
		{
			mesh.setMatrixAt(ref.index, hidden ? CityContext.NOWHERE : ref.matrix);
			mesh.instanceMatrix.needsUpdate = true;
		}
	}

	public placedCount(kind: string): number
	{
		let total = 0;
		let chunks = this.instances[kind] || {};
		for (const chunk in chunks) total += chunks[chunk].length;
		return total;
	}

	/** Turns every batch into a mesh. */
	public buildBatches(): void
	{
		for (const key in this.batches)
		{
			let entry = this.batches[key];
			if (entry.batch.empty) continue;
			let mesh = new THREE.Mesh(entry.batch.build(), entry.material);
			mesh.castShadow = entry.shadows;
			mesh.receiveShadow = true;
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
			this.group.add(mesh);
		}
		this.batches = {};
	}

	/** Turns every placed prop of the given kinds, or of all defined kinds, into instanced meshes. */
	public buildInstances(only?: string[]): THREE.InstancedMesh[]
	{
		let made: THREE.InstancedMesh[] = [];
		for (const kind in this.instances)
		{
			if (only !== undefined && only.indexOf(kind) < 0) continue;
			let definition = this.kinds[kind];
			if (definition === undefined) continue;

			for (const chunk in this.instances[kind])
			{
				let matrices = this.instances[kind][chunk];
				let colors = this.instanceColors[kind] !== undefined ? this.instanceColors[kind][chunk] : undefined;
				if (this.built[kind] === undefined) this.built[kind] = {};
				this.built[kind][chunk] = [];
				for (const part of definition.parts)
				{
					let mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
					matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
					if (colors !== undefined) colors.forEach((color, i) => mesh.setColorAt(i, color));
					mesh.instanceMatrix.needsUpdate = true;
					mesh.computeBoundingSphere();
					// Anything knocked over before the set was built stays down
					matrices.forEach((_, i) =>
					{
						if (this.hidden.has(kind + '|' + chunk + '|' + i)) mesh.setMatrixAt(i, CityContext.NOWHERE);
					});
					this.built[kind][chunk].push(mesh);
					mesh.castShadow = definition.shadows;
					mesh.receiveShadow = true;
					mesh.name = kind;
					mesh.userData.drawDistance = definition.drawDistance;
					this.group.add(mesh);
					this.culled.push(mesh);
					made.push(mesh);
				}
			}
			delete this.instances[kind];
		}
		return made;
	}

	/**
	 * Hides whatever's further from the camera than it's worth drawing. A
	 * hydrant half a kilometre away is a few pixels in the haze, but it's
	 * still a few hundred triangles in the main pass and three shadow passes.
	 */
	public cull(camera: THREE.Vector3): void
	{
		for (const object of this.culled)
		{
			let mesh = object as THREE.Mesh;
			let sphere = mesh.geometry.boundingSphere;
			if ((mesh as any).isInstancedMesh) sphere = (mesh as THREE.InstancedMesh).boundingSphere;
			if (sphere === null || sphere === undefined) continue;
			mesh.visible = camera.distanceTo(sphere.center) - sphere.radius < object.userData.drawDistance;
		}
	}

	public addBodiesTo(world: CANNON.World): void
	{
		for (const bodies of [this.bodies, this.breakableBodies])
		{
			for (const key in bodies)
			{
				let body = bodies[key];
				body.updateBoundingRadius();
				body.computeAABB();
				world.addBody(body);
			}
		}
	}
}
