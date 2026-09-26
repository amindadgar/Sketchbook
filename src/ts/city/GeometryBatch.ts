import * as THREE from 'three';

/**
 * Collects triangles for one material in one part of the city and turns them
 * into a single mesh at the end, so the whole of a district's brickwork is
 * one draw call. Extra per-vertex attributes are declared up front and each
 * face supplies a value for them.
 */
export class GeometryBatch
{
	private positions: number[] = [];
	private normals: number[] = [];
	private uvs: number[] = [];
	private indices: number[] = [];
	private extras: { [name: string]: { size: number, data: number[] } } = {};

	constructor(extras: { [name: string]: number } = {})
	{
		for (const name in extras)
		{
			this.extras[name] = { size: extras[name], data: [] };
		}
	}

	public get empty(): boolean
	{
		return this.indices.length === 0;
	}

	public get vertexCount(): number
	{
		return this.positions.length / 3;
	}

	private pushVertex(p: THREE.Vector3, n: THREE.Vector3, uv: number[], extras: { [name: string]: number[] }): void
	{
		this.positions.push(p.x, p.y, p.z);
		this.normals.push(n.x, n.y, n.z);
		this.uvs.push(uv[0], uv[1]);
		for (const name in this.extras)
		{
			let value = extras[name];
			let extra = this.extras[name];
			for (let i = 0; i < extra.size; i++) extra.data.push(value !== undefined ? value[i] : 0);
		}
	}

	/**
	 * A quad a-b-c-d, counter-clockwise seen from its front, with a UV for each
	 * corner. The normal is worked out from the corners unless given.
	 */
	public quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
		uvs: number[][], extras: { [name: string]: number[] } = {}, normal?: THREE.Vector3): void
	{
		let n = normal !== undefined ? normal : new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
		let base = this.vertexCount;
		this.pushVertex(a, n, uvs[0], extras);
		this.pushVertex(b, n, uvs[1], extras);
		this.pushVertex(c, n, uvs[2], extras);
		this.pushVertex(d, n, uvs[3], extras);
		this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}

	/** Sets an extra attribute per corner on the quad just added, where one value per face won't do. */
	public patchLast(name: string, corners: number[][]): void
	{
		let extra = this.extras[name];
		let start = extra.data.length - extra.size * corners.length;
		corners.forEach((value, k) =>
		{
			for (let i = 0; i < extra.size; i++) extra.data[start + k * extra.size + i] = value[i];
		});
	}

	public triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, uvs: number[][], extras: { [name: string]: number[] } = {}): void
	{
		let n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
		let base = this.vertexCount;
		this.pushVertex(a, n, uvs[0], extras);
		this.pushVertex(b, n, uvs[1], extras);
		this.pushVertex(c, n, uvs[2], extras);
		this.indices.push(base, base + 1, base + 2);
	}

	/**
	 * An upward facing rectangle between two corners at a height, textured by
	 * where it is in the world so neighbouring pieces line up.
	 */
	public flat(minX: number, minZ: number, maxX: number, maxZ: number, y: number, extras: { [name: string]: number[] } = {}): void
	{
		this.quad(
			new THREE.Vector3(minX, y, maxZ), new THREE.Vector3(maxX, y, maxZ),
			new THREE.Vector3(maxX, y, minZ), new THREE.Vector3(minX, y, minZ),
			[[minX, -maxZ], [maxX, -maxZ], [maxX, -minZ], [minX, -minZ]], extras, new THREE.Vector3(0, 1, 0));
	}

	/**
	 * The sides of an axis aligned box, UVs running along each side and up it
	 * from the given base height, so windows line up between the tiers of a
	 * stepped tower. Top and bottom are optional.
	 */
	public boxSides(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
		baseY: number, extras: { [name: string]: number[] } = {}, uOffset: number = 0): void
	{
		let v0 = minY - baseY;
		let v1 = maxY - baseY;
		let w = maxX - minX;
		let d = maxZ - minZ;
		let P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

		// South (+z), east (+x), north (-z), west (-x): u carries on round the corner
		let u = uOffset;
		this.quad(P(minX, minY, maxZ), P(maxX, minY, maxZ), P(maxX, maxY, maxZ), P(minX, maxY, maxZ),
			[[u, v0], [u + w, v0], [u + w, v1], [u, v1]], extras, new THREE.Vector3(0, 0, 1));
		u += w;
		this.quad(P(maxX, minY, maxZ), P(maxX, minY, minZ), P(maxX, maxY, minZ), P(maxX, maxY, maxZ),
			[[u, v0], [u + d, v0], [u + d, v1], [u, v1]], extras, new THREE.Vector3(1, 0, 0));
		u += d;
		this.quad(P(maxX, minY, minZ), P(minX, minY, minZ), P(minX, maxY, minZ), P(maxX, maxY, minZ),
			[[u, v0], [u + w, v0], [u + w, v1], [u, v1]], extras, new THREE.Vector3(0, 0, -1));
		u += w;
		this.quad(P(minX, minY, minZ), P(minX, minY, maxZ), P(minX, maxY, maxZ), P(minX, maxY, minZ),
			[[u, v0], [u + d, v0], [u + d, v1], [u, v1]], extras, new THREE.Vector3(-1, 0, 0));
	}

	/** Every face of a box turned about Y, textured in world units. */
	public orientedBox(center: THREE.Vector3, size: THREE.Vector3, quaternion: THREE.Quaternion, extras: { [name: string]: number[] } = {}): void
	{
		let hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
		let corner = (x: number, y: number, z: number) => new THREE.Vector3(x * hx, y * hy, z * hz).applyQuaternion(quaternion).add(center);
		let faces: number[][][] = [
			[[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
			[[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
			[[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
			[[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
			[[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
			[[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
		];
		let spans = [[size.x, size.y], [size.x, size.y], [size.z, size.y], [size.z, size.y], [size.x, size.z], [size.x, size.z]];
		faces.forEach((face, i) =>
		{
			let [su, sv] = spans[i];
			let pts = face.map((c) => corner(c[0], c[1], c[2]));
			this.quad(pts[0], pts[1], pts[2], pts[3], [[0, 0], [su, 0], [su, sv], [0, sv]], extras);
		});
	}

	public build(): THREE.BufferGeometry
	{
		let geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
		geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
		geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
		for (const name in this.extras)
		{
			let extra = this.extras[name];
			geometry.setAttribute(name, new THREE.Float32BufferAttribute(extra.data, extra.size));
		}
		let index = this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1);
		geometry.setIndex(index);
		geometry.computeBoundingSphere();
		geometry.computeBoundingBox();
		return geometry;
	}
}
