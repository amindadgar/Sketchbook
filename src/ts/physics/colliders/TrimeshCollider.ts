import * as CANNON from 'cannon';
import * as THREE from 'three';
import * as Utils from '../../core/FunctionLibrary';
import {ICollider} from '../../interfaces/ICollider';
import {Object3D} from 'three';

export class TrimeshCollider implements ICollider
{
	/**
	 * cannon keeps a trimesh's indices in an Int16Array, so a shape can't
	 * address more vertices than this. Bigger meshes are cut into several
	 * shapes on the one body.
	 */
	private static readonly MAX_VERTICES: number = 32767;

	public mesh: any;
	public options: any;
	public body: CANNON.Body;
	public debugModel: any;

	constructor(mesh: Object3D, options: any)
	{
		this.mesh = mesh.clone();

		let defaults = {
			mass: 0,
			position: mesh.position,
			rotation: mesh.quaternion,
			friction: 0.3
		};
		options = Utils.setDefaults(options, defaults);
		this.options = options;

		let mat = new CANNON.Material('triMat');
		mat.friction = options.friction;

		let physBox = new CANNON.Body({
			mass: options.mass,
			position: options.position,
			quaternion: options.rotation
		});

		TrimeshCollider.shapesFromMesh(mesh as THREE.Mesh).forEach((shape) => physBox.addShape(shape));

		physBox.material = mat;

		this.body = physBox;
	}

	/**
	 * The mesh's triangles in its own frame, with its scale baked in, since a
	 * cannon shape can be moved and turned but not scaled. Local, like the
	 * position and rotation the body is given.
	 */
	public static shapesFromMesh(mesh: THREE.Mesh): CANNON.Shape[]
	{
		let geometry = mesh.geometry as THREE.BufferGeometry;
		let position = geometry.getAttribute('position');
		if (position === undefined || position.count === 0) return [];

		let scale = mesh.scale;

		let index = geometry.getIndex();
		let triangleCount = index !== null ? index.count / 3 : position.count / 3;
		let corner = (i: number) => index !== null ? index.getX(i) : i;

		// Indexed and small enough: one shape sharing vertices, as authored
		if (position.count <= TrimeshCollider.MAX_VERTICES)
		{
			let vertices: number[] = [];
			for (let i = 0; i < position.count; i++)
			{
				vertices.push(position.getX(i) * scale.x, position.getY(i) * scale.y, position.getZ(i) * scale.z);
			}

			let indices: number[] = [];
			for (let i = 0; i < triangleCount * 3; i++) indices.push(corner(i));

			return [new (CANNON as any).Trimesh(vertices, indices)];
		}

		// Otherwise unshared, in slices of whole triangles
		let shapes: CANNON.Shape[] = [];
		let perShape = Math.floor(TrimeshCollider.MAX_VERTICES / 3);

		for (let first = 0; first < triangleCount; first += perShape)
		{
			let last = Math.min(triangleCount, first + perShape);
			let vertices: number[] = [];
			let indices: number[] = [];

			for (let t = first; t < last; t++)
			{
				for (let k = 0; k < 3; k++)
				{
					let v = corner(t * 3 + k);
					indices.push(vertices.length / 3);
					vertices.push(position.getX(v) * scale.x, position.getY(v) * scale.y, position.getZ(v) * scale.z);
				}
			}

			shapes.push(new (CANNON as any).Trimesh(vertices, indices));
		}

		return shapes;
	}
}
