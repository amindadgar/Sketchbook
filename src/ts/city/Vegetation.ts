import * as THREE from 'three';
import { mulberry32 } from './CityPlan';

/**
 * Street trees and palms, made here rather than downloaded.
 *
 * The free tree models about are film assets, millions of triangles each. A
 * game tree is a trunk and a crown of leaf cards: flat squares with a cluster
 * of leaves painted on and everything else cut away, pointed every which way
 * so the crown reads as a volume from any side. The leaves are painted on a
 * canvas when the game starts, and the cards' normals point out from the
 * middle of the crown so it shades like a rounded mass rather than a heap of
 * flat squares.
 */
export class Vegetation
{
	public static readonly TREE_VARIANTS: number = 3;

	private static leafTexture: THREE.Texture;
	private static frondTexture: THREE.Texture;
	private static barkTexture: THREE.Texture;
	private static palmBarkTexture: THREE.Texture;

	public static leafMaterial(): THREE.MeshStandardMaterial
	{
		let material = new THREE.MeshStandardMaterial({
			map: Vegetation.leaves(),
			alphaTest: 0.45,
			side: THREE.DoubleSide,
			roughness: 0.85,
			metalness: 0
		});
		material.name = 'leaves';
		return material;
	}

	public static frondMaterial(): THREE.MeshStandardMaterial
	{
		let material = new THREE.MeshStandardMaterial({
			map: Vegetation.fronds(),
			alphaTest: 0.4,
			side: THREE.DoubleSide,
			roughness: 0.8,
			metalness: 0
		});
		material.name = 'fronds';
		return material;
	}

	public static barkMaterial(palm: boolean): THREE.MeshStandardMaterial
	{
		let material = new THREE.MeshStandardMaterial({
			map: palm ? Vegetation.palmBark() : Vegetation.bark(),
			roughness: 0.95,
			metalness: 0
		});
		material.name = palm ? 'palm_bark' : 'bark';
		return material;
	}

	/** Trunk and crown of a broadleaf street tree, about nine metres tall. */
	public static tree(variant: number): { trunk: THREE.BufferGeometry, crown: THREE.BufferGeometry }
	{
		let random = mulberry32(1000 + variant * 77);
		let height = 2.1 + random() * 0.6;
		let trunk = Vegetation.taperedCylinder(
			[new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05 * (random() - 0.5), height, 0.05 * (random() - 0.5))],
			0.11, 0.06, 7);

		// A few limbs out of the top of the trunk, into the crown
		let limbs: THREE.BufferGeometry[] = [trunk];
		for (let i = 0; i < 4; i++)
		{
			let angle = (i / 4) * Math.PI * 2 + random();
			let start = new THREE.Vector3(0, height * (0.75 + random() * 0.2), 0);
			let end = start.clone().add(new THREE.Vector3(Math.cos(angle) * 0.8, 0.9 + random() * 0.4, Math.sin(angle) * 0.8));
			limbs.push(Vegetation.taperedCylinder([start, end], 0.05, 0.02, 5));
		}

		let crownCentre = new THREE.Vector3(0, height + 1.15, 0);
		let crown = Vegetation.cardCloud(crownCentre, new THREE.Vector3(1.55, 1.25, 1.55), 56, 1.0, random);

		return { trunk: mergeGeometries(limbs), crown: crown };
	}

	/** A palm about twelve metres tall, leaning a little and fronds drooping. */
	public static palm(variant: number): { trunk: THREE.BufferGeometry, crown: THREE.BufferGeometry }
	{
		let random = mulberry32(5000 + variant * 31);
		let height = 6.2 + random() * 1.4;
		let lean = new THREE.Vector3(random() - 0.5, 0, random() - 0.5).normalize().multiplyScalar(0.5 + random() * 0.4);

		let spine: THREE.Vector3[] = [];
		for (let i = 0; i <= 8; i++)
		{
			let t = i / 8;
			spine.push(new THREE.Vector3(lean.x * t * t, t * height, lean.z * t * t));
		}
		let trunk = Vegetation.taperedCylinder(spine, 0.16, 0.1, 8);

		let top = spine[spine.length - 1];
		let fronds: THREE.BufferGeometry[] = [];
		let count = 9;
		for (let i = 0; i < count; i++)
		{
			let yaw = (i / count) * Math.PI * 2 + random() * 0.3;
			fronds.push(Vegetation.frond(top, yaw, 2.4 + random() * 0.6, 0.55 + random() * 0.35, random));
		}
		return { trunk: trunk, crown: mergeGeometries(fronds) };
	}

	/** A shrub: just a low cloud of leaf cards. */
	public static shrub(variant: number): THREE.BufferGeometry
	{
		let random = mulberry32(9000 + variant);
		return Vegetation.cardCloud(new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(0.7, 0.45, 0.7), 12, 0.75, random);
	}

	// Geometry

	private static taperedCylinder(spine: THREE.Vector3[], bottom: number, top: number, sides: number): THREE.BufferGeometry
	{
		let positions: number[] = [];
		let normals: number[] = [];
		let uvs: number[] = [];
		let indices: number[] = [];
		let length = 0;

		for (let i = 0; i < spine.length; i++)
		{
			let t = i / (spine.length - 1);
			let radius = THREE.MathUtils.lerp(bottom, top, t);
			let direction = i < spine.length - 1 ? spine[i + 1].clone().sub(spine[i]) : spine[i].clone().sub(spine[i - 1]);
			if (i > 0) length += spine[i].distanceTo(spine[i - 1]);
			direction.normalize();
			let side = new THREE.Vector3(1, 0, 0);
			if (Math.abs(direction.x) > 0.9) side.set(0, 0, 1);
			let a = new THREE.Vector3().crossVectors(direction, side).normalize();
			let b = new THREE.Vector3().crossVectors(direction, a).normalize();

			for (let s = 0; s <= sides; s++)
			{
				let angle = (s / sides) * Math.PI * 2;
				let normal = a.clone().multiplyScalar(Math.cos(angle)).add(b.clone().multiplyScalar(Math.sin(angle)));
				let point = spine[i].clone().add(normal.clone().multiplyScalar(radius));
				positions.push(point.x, point.y, point.z);
				normals.push(normal.x, normal.y, normal.z);
				uvs.push(s / sides, length * 1.5);
			}
		}

		for (let i = 0; i < spine.length - 1; i++)
		{
			for (let s = 0; s < sides; s++)
			{
				let row = i * (sides + 1);
				let next = (i + 1) * (sides + 1);
				indices.push(row + s, next + s, row + s + 1, row + s + 1, next + s, next + s + 1);
			}
		}

		let geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
		geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
		geometry.setIndex(indices);
		return geometry;
	}

	/** Leaf cards scattered through an ellipsoid, normals out from its centre. */
	private static cardCloud(centre: THREE.Vector3, radii: THREE.Vector3, count: number, size: number, random: () => number): THREE.BufferGeometry
	{
		let positions: number[] = [];
		let normals: number[] = [];
		let uvs: number[] = [];
		let indices: number[] = [];

		for (let i = 0; i < count; i++)
		{
			// Biased outward, where cards show; the middle is only ever seen through gaps
			let direction = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
			let reach = Math.pow(random(), 0.4);
			let offset = direction.clone().multiply(radii).multiplyScalar(reach);
			let at = centre.clone().add(offset);
			let s = size * (0.7 + random() * 0.6);

			let facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI));
			let corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
			let base = positions.length / 3;
			corners.forEach(([cx, cy], k) =>
			{
				let p = new THREE.Vector3(cx * s / 2, cy * s / 2, 0).applyQuaternion(facing).add(at);
				let n = p.clone().sub(centre).divide(radii).normalize();
				// Lift the normals a little: light from above should reach the underside too
				n.y += 0.35;
				n.normalize();
				positions.push(p.x, p.y, p.z);
				normals.push(n.x, n.y, n.z);
				uvs.push((cx + 1) / 2, (cy + 1) / 2);
			});
			indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
		}

		let geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
		geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
		geometry.setIndex(indices);
		return geometry;
	}

	/** One frond: a strip arching out and down from the crown. */
	private static frond(top: THREE.Vector3, yaw: number, length: number, droop: number, random: () => number): THREE.BufferGeometry
	{
		let positions: number[] = [];
		let normals: number[] = [];
		let uvs: number[] = [];
		let indices: number[] = [];
		const segments = 7;
		let out = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
		let across = new THREE.Vector3(-out.z, 0, out.x);
		let rise = 0.35 + random() * 0.3;

		for (let i = 0; i <= segments; i++)
		{
			let t = i / segments;
			// Up and out first, then over and down
			let along = out.clone().multiplyScalar(t * length);
			let height = rise * t * length - droop * t * t * length * 1.2;
			let centre = top.clone().add(along).add(new THREE.Vector3(0, height, 0));
			let width = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08));
			let tilt = new THREE.Vector3(0, 0.25 * width, 0);
			let left = centre.clone().add(across.clone().multiplyScalar(width)).sub(tilt);
			let right = centre.clone().sub(across.clone().multiplyScalar(width)).sub(tilt);
			positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
			normals.push(0, 1, 0, 0, 1, 0);
			uvs.push(0, t, 1, t);
		}

		for (let i = 0; i < segments; i++)
		{
			let a = i * 2;
			indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
		}

		let geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
		geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
		geometry.setIndex(indices);
		return geometry;
	}

	// Textures, painted on a canvas

	private static leaves(): THREE.Texture
	{
		if (Vegetation.leafTexture !== undefined) return Vegetation.leafTexture;

		let size = 256;
		let canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		let ctx = canvas.getContext('2d');
		let random = mulberry32(31337);

		// A rough disc of leaves, densest in the middle
		for (let i = 0; i < 900; i++)
		{
			let angle = random() * Math.PI * 2;
			let r = Math.pow(random(), 0.6) * size * 0.47;
			let x = size / 2 + Math.cos(angle) * r;
			let y = size / 2 + Math.sin(angle) * r;
			let shade = 0.55 + random() * 0.45;
			let hue = 88 + random() * 36;
			ctx.fillStyle = 'hsl(' + hue + ', ' + (38 + random() * 22) + '%, ' + (16 + shade * 20) + '%)';
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(random() * Math.PI * 2);
			ctx.beginPath();
			ctx.ellipse(0, 0, 4.5 + random() * 3.5, 2.2 + random() * 1.4, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}

		Vegetation.leafTexture = Vegetation.canvasTexture(canvas, true);
		return Vegetation.leafTexture;
	}

	private static fronds(): THREE.Texture
	{
		if (Vegetation.frondTexture !== undefined) return Vegetation.frondTexture;

		let width = 128;
		let height = 512;
		let canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		let ctx = canvas.getContext('2d');
		let random = mulberry32(777);

		// Leaflets off both sides of a central rib, angled toward the tip
		for (let y = 8; y < height - 6; y += 5)
		{
			let t = y / height;
			let reach = (width / 2 - 4) * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05));
			for (const side of [-1, 1])
			{
				ctx.strokeStyle = 'hsl(' + (90 + random() * 25) + ', 45%, ' + (20 + random() * 16) + '%)';
				ctx.lineWidth = 2.4;
				ctx.beginPath();
				ctx.moveTo(width / 2, y);
				ctx.lineTo(width / 2 + side * reach, y + 14 + random() * 6);
				ctx.stroke();
			}
		}
		ctx.strokeStyle = '#6b6a3a';
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.moveTo(width / 2, 0);
		ctx.lineTo(width / 2, height);
		ctx.stroke();

		Vegetation.frondTexture = Vegetation.canvasTexture(canvas, true);
		return Vegetation.frondTexture;
	}

	private static bark(): THREE.Texture
	{
		if (Vegetation.barkTexture !== undefined) return Vegetation.barkTexture;

		let canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 128;
		let ctx = canvas.getContext('2d');
		let random = mulberry32(99);
		ctx.fillStyle = '#4a3f35';
		ctx.fillRect(0, 0, 64, 128);
		for (let i = 0; i < 160; i++)
		{
			ctx.fillStyle = 'rgba(' + (30 + random() * 50) + ',' + (25 + random() * 40) + ',' + (20 + random() * 30) + ',0.6)';
			ctx.fillRect(random() * 64, random() * 128, 1 + random() * 3, 6 + random() * 20);
		}
		Vegetation.barkTexture = Vegetation.canvasTexture(canvas, false);
		return Vegetation.barkTexture;
	}

	private static palmBark(): THREE.Texture
	{
		if (Vegetation.palmBarkTexture !== undefined) return Vegetation.palmBarkTexture;

		let canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 64;
		let ctx = canvas.getContext('2d');
		ctx.fillStyle = '#7d6b52';
		ctx.fillRect(0, 0, 64, 64);
		// The rings a palm's fallen fronds leave
		for (let y = 0; y < 64; y += 8)
		{
			ctx.fillStyle = 'rgba(60, 48, 34, 0.8)';
			ctx.fillRect(0, y, 64, 3);
			ctx.fillStyle = 'rgba(150, 132, 100, 0.5)';
			ctx.fillRect(0, y + 3, 64, 2);
		}
		Vegetation.palmBarkTexture = Vegetation.canvasTexture(canvas, false);
		return Vegetation.palmBarkTexture;
	}

	private static canvasTexture(canvas: HTMLCanvasElement, clamp: boolean): THREE.Texture
	{
		let texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.wrapS = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
		texture.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
		texture.anisotropy = 4;
		return texture;
	}
}

/** Joins non-indexed or indexed geometries with the same attributes into one. */
export function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry
{
	let positions: number[] = [];
	let normals: number[] = [];
	let uvs: number[] = [];
	let indices: number[] = [];
	for (const part of parts)
	{
		let base = positions.length / 3;
		let p = part.getAttribute('position');
		let n = part.getAttribute('normal');
		let uv = part.getAttribute('uv');
		for (let i = 0; i < p.count; i++)
		{
			positions.push(p.getX(i), p.getY(i), p.getZ(i));
			normals.push(n.getX(i), n.getY(i), n.getZ(i));
			uvs.push(uv !== undefined ? uv.getX(i) : 0, uv !== undefined ? uv.getY(i) : 0);
		}
		let index = part.getIndex();
		if (index !== null) for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + base);
		else for (let i = 0; i < p.count; i++) indices.push(i + base);
	}
	let geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	return geometry;
}
