import * as THREE from 'three';
import { CityPlan, mulberry32, roadWidth } from './CityPlan';
import { CityContext } from './CityContext';
import { StreetFurniture } from './StreetFurniture';
import { CityMaterials } from './CityMaterials';

/**
 * The land the city stands on and where it meets the sea: grass under
 * everything, rock revetments round most of the shore, a beach and a
 * boardwalk along the east side facing the island, and a working harbour in
 * the north east with quays, piers, cranes and stacked containers.
 */
export class Waterfront
{
	/** Where the sand starts and how far out it runs, sloping into the sea. */
	public static readonly BEACH = { promenadeWest: -413.6, sandWest: -404, sandEast: -330, sandTop: 15.15, sandBottom: 12.6, north: -300, south: 580 };
	public static readonly HARBOR = { west: -413.6, east: -360, north: -500, south: -300 };

	private context: CityContext;
	private plan: CityPlan;
	private m: CityMaterials;
	private random: () => number = mulberry32(2718);

	public spawnSpots: { position: THREE.Vector3, facing: THREE.Vector3 }[] = [];

	constructor(context: CityContext, plan: CityPlan)
	{
		this.context = context;
		this.plan = plan;
		this.m = context.materials;
	}

	public build(): void
	{
		this.land();
		this.revetments();
		this.beach();
		this.harbor();
		this.northQuay();
		this.bridgeTowers();
	}

	/**
	 * Grass over the whole plot, pushed back in the depth buffer so every road
	 * and pavement drawn on it wins without being lifted off it, and one big
	 * collider under it all.
	 */
	private land(): void
	{
		let L = CityPlan.LAND;
		let B = Waterfront.BEACH;
		let grass = this.m.grass.clone();
		grass.polygonOffset = true;
		grass.polygonOffsetFactor = 2;
		grass.polygonOffsetUnits = 4;
		grass.userData.shaderKey = 'grass-under';

		// Tiled in pieces, so it's culled with the districts it's under
		let lay = (minX: number, maxX: number, minZ: number, maxZ: number) =>
		{
			for (let x = minX; x < maxX; x += CityContext.CHUNK)
			{
				for (let z = minZ; z < maxZ; z += CityContext.CHUNK)
				{
					let x1 = Math.min(x + CityContext.CHUNK, maxX);
					let z1 = Math.min(z + CityContext.CHUNK, maxZ);
					this.context.batch(grass, (x + x1) / 2, (z + z1) / 2, {}, false).flat(x, z, x1, z1, CityPlan.GROUND - 0.002);
				}
			}
		};
		lay(L.minX, B.sandWest, L.minZ, L.maxZ);
		lay(B.sandWest, L.maxX, L.minZ, B.north);

		let depth = 6;
		let collider = (minX: number, maxX: number, minZ: number, maxZ: number) =>
		{
			// The land is too big for one district, so it's laid in district sized slabs
			for (let x = minX; x < maxX; x += CityContext.CHUNK)
			{
				for (let z = minZ; z < maxZ; z += CityContext.CHUNK)
				{
					let x1 = Math.min(x + CityContext.CHUNK, maxX);
					let z1 = Math.min(z + CityContext.CHUNK, maxZ);
					this.context.collider(new THREE.Vector3((x + x1) / 2, CityPlan.GROUND - depth / 2, (z + z1) / 2),
						new THREE.Vector3(x1 - x, depth, z1 - z));
				}
			}
		};
		collider(L.minX, B.sandWest, L.minZ, L.maxZ);
		// The harbour's corner reaches all the way to the water
		collider(B.sandWest, L.maxX, L.minZ, B.north);
	}

	/** Rock armour sloping into the sea along the west, north and south shores. */
	private revetments(): void
	{
		let L = CityPlan.LAND;
		const reach = 12;
		const drop = 4;

		let slope = (from: THREE.Vector3, to: THREE.Vector3, outward: THREE.Vector3) =>
		{
			let length = from.distanceTo(to);
			let mid = from.clone().lerp(to, 0.5);
			let batch = this.context.batch(this.m.rocks, mid.x, mid.z, {}, false);
			let a = from.clone().setY(CityPlan.GROUND);
			let b = to.clone().setY(CityPlan.GROUND);
			let c = to.clone().add(outward.clone().multiplyScalar(reach)).setY(CityPlan.GROUND - drop);
			let d = from.clone().add(outward.clone().multiplyScalar(reach)).setY(CityPlan.GROUND - drop);
			let slant = Math.hypot(reach, drop);

			// Wound so it faces up, whichever way round the shore runs
			let facesUp = new THREE.Vector3().subVectors(d, a).cross(new THREE.Vector3().subVectors(b, a)).y > 0;
			if (facesUp) batch.quad(a, d, c, b, [[0, 0], [0, slant], [length, slant], [length, 0]]);
			else batch.quad(a, b, c, d, [[0, 0], [length, 0], [length, slant], [0, slant]]);

			// A slab under the slope: local x down the slope, z along the shore, y up out of it
			let down = outward.clone().multiplyScalar(reach).add(new THREE.Vector3(0, -drop, 0)).normalize();
			let along = to.clone().sub(from).normalize();
			let up = new THREE.Vector3().crossVectors(along, down);
			if (up.y < 0)
			{
				along.negate();
				up.negate();
			}
			let rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(down, up, along));
			let centre = mid.clone().add(outward.clone().multiplyScalar(reach / 2)).setY(CityPlan.GROUND - drop / 2).sub(up.clone().multiplyScalar(1));
			this.context.collider(centre, new THREE.Vector3(slant, 2, length), rotation);
		};

		for (let z = L.minZ; z < L.maxZ; z += 80)
		{
			slope(new THREE.Vector3(L.minX, 0, z), new THREE.Vector3(L.minX, 0, Math.min(z + 80, L.maxZ)), new THREE.Vector3(-1, 0, 0));
		}
		for (let x = L.minX; x < Waterfront.BEACH.sandWest; x += 80)
		{
			let x1 = Math.min(x + 80, Waterfront.BEACH.sandWest);
			slope(new THREE.Vector3(x, 0, L.maxZ), new THREE.Vector3(x1, 0, L.maxZ), new THREE.Vector3(0, 0, 1));
			if (x1 <= -780) slope(new THREE.Vector3(x, 0, L.minZ), new THREE.Vector3(x1, 0, L.minZ), new THREE.Vector3(0, 0, -1));
		}
	}

	/**
	 * The boardwalk along the coast road and the sand below it, which runs
	 * down under the water so the shore line is wherever the sea says it is.
	 */
	private beach(): void
	{
		let B = Waterfront.BEACH;
		let top = CityPlan.GROUND + CityPlan.CURB;

		for (let z = B.north; z < B.south; z += 80)
		{
			let z1 = Math.min(z + 80, B.south);
			let cz = (z + z1) / 2;

			// Boardwalk: planks on a kerbed slab
			this.context.batch(this.m.planks, -408, cz, {}, false).flat(B.promenadeWest, z, B.sandWest, z1, top);
			this.context.batch(this.m.curb, -408, cz, {}, false).boxSides(B.promenadeWest, CityPlan.GROUND - 0.1, z, B.sandWest, top, z1, CityPlan.GROUND - 0.1);
			this.context.collider(new THREE.Vector3((B.promenadeWest + B.sandWest) / 2, top - 0.5, cz), new THREE.Vector3(B.sandWest - B.promenadeWest, 1, z1 - z));

			// Sand, falling gently away into the sea
			let sand = this.context.batch(this.m.sand, -370, cz, {}, false);
			let a = new THREE.Vector3(B.sandWest, B.sandTop - 0.02, z1);
			let b = new THREE.Vector3(B.sandEast, B.sandBottom, z1);
			let c = new THREE.Vector3(B.sandEast, B.sandBottom, z);
			let d = new THREE.Vector3(B.sandWest, B.sandTop - 0.02, z);
			sand.quad(a, b, c, d, [[a.x, -a.z], [b.x, -b.z], [c.x, -c.z], [d.x, -d.z]]);

			let run = B.sandEast - B.sandWest;
			let fall = B.sandTop - B.sandBottom;
			let slant = Math.hypot(run, fall);
			let rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.atan2(fall, run));
			let centre = new THREE.Vector3((B.sandWest + B.sandEast) / 2, (B.sandTop + B.sandBottom) / 2 - 1, cz);
			this.context.collider(centre, new THREE.Vector3(slant, 2, z1 - z), rotation);
		}

		// Palms and old style lamps down the boardwalk, benches facing the sea
		for (let z = B.north + 6; z < B.south - 6; z += 14)
		{
			if (Math.abs(z - CityPlan.BRIDGE_Z) < 12) continue;
			let spot = new THREE.Vector3(B.sandWest - 1.4, CityPlan.GROUND + CityPlan.CURB, z);
			let variant = Math.floor(this.random() * 3);
			this.context.place('palm' + variant, spot, this.random() * 6, 0.9 + this.random() * 0.35);
			this.context.collider(spot.clone().setY(spot.y + 1.5), new THREE.Vector3(0.34, 3, 0.34));

			if (Math.round((z - B.north) / 14) % 2 === 0)
			{
				let lamp = new THREE.Vector3(B.promenadeWest + 1.4, spot.y, z + 7);
				let ref = this.context.place('street_lamp_01', lamp, 0, 1.6);
				this.context.breakable(StreetFurniture.propBreakable(lamp, 0, new THREE.Vector3(0.2, 3.6, 0.2), ref, 2.5));
			}
			else
			{
				let bench = new THREE.Vector3(B.sandWest - 3.4, spot.y, z + 7);
				let ref = this.context.place('modular_street_seating', bench, Math.PI / 2);
				this.context.breakable(StreetFurniture.propBreakable(bench, 0, new THREE.Vector3(0.45, 0.5, 1.3), ref, 2));
			}
		}

		for (let z = B.north + 40; z < B.south - 20; z += 90)
		{
			this.spawnSpots.push({ position: new THREE.Vector3(-408, CityPlan.GROUND + CityPlan.CURB, z), facing: new THREE.Vector3(0, 0, 1) });
		}
	}

	/** The quay between the coast road and the water north of the beach, with its piers. */
	private harbor(): void
	{
		let H = Waterfront.HARBOR;
		let top = CityPlan.GROUND + CityPlan.CURB;
		let cx = (H.west + H.east) / 2;
		let cz = (H.north + H.south) / 2;

		this.context.batch(this.m.concrete, cx, cz, {}, false).flat(H.west, H.north, H.east, H.south, top);
		this.context.batch(this.m.curb, cx, cz, {}, false).boxSides(H.west, CityPlan.GROUND - 0.1, H.north, H.east, top, H.south, CityPlan.GROUND - 0.1);
		this.context.collider(new THREE.Vector3(cx, top - 0.5, cz), new THREE.Vector3(H.east - H.west, 1, H.south - H.north));

		// The quay wall, straight down into the water, from the north shore round
		let north = CityPlan.LAND.minZ;
		let wall = this.context.batch(this.m.concrete, H.east, cz);
		wall.quad(new THREE.Vector3(H.east, 9, H.south), new THREE.Vector3(H.east, 9, north), new THREE.Vector3(H.east, top, north), new THREE.Vector3(H.east, top, H.south),
			[[0, 9], [H.south - north, 9], [H.south - north, top], [0, top]]);

		// Stacks of containers, two cranes, bollards along the edge
		this.containers(H.west + 8, H.east - 10, H.north + 8, H.south - 8, top);
		for (const z of [-460, -360])
		{
			this.crane(new THREE.Vector3(H.east - 5, top, z));
		}
		for (let z = H.north + 4; z < H.south; z += 9)
		{
			this.context.place('bollard', new THREE.Vector3(H.east - 0.6, top, z), 0);
			this.context.collider(new THREE.Vector3(H.east - 0.6, top + 0.25, z), new THREE.Vector3(0.4, 0.5, 0.4));
		}

		for (const z of [-470, -330])
		{
			this.pier(H.east, z, 70, 9);
		}
	}

	/** Along the north shore past the ring road, under the viaduct, more docks. */
	private northQuay(): void
	{
		let top = CityPlan.GROUND + CityPlan.CURB;
		let south = CityPlan.RING_NORTH - roadWidth(CityPlan.HIGHWAY) / 2;
		let north = CityPlan.LAND.minZ;
		let west = -780;
		let east = CityPlan.LAND.maxX;
		let cx = (west + east) / 2;

		for (let x = west; x < east; x += CityContext.CHUNK)
		{
			let x1 = Math.min(x + CityContext.CHUNK, east);
			this.context.batch(this.m.concrete, (x + x1) / 2, (north + south) / 2, {}, false).flat(x, north, x1, south, top);
			this.context.batch(this.m.curb, (x + x1) / 2, (north + south) / 2, {}, false)
				.boxSides(x, CityPlan.GROUND - 0.1, north, x1, top, south, CityPlan.GROUND - 0.1);
			this.context.collider(new THREE.Vector3((x + x1) / 2, top - 0.5, (north + south) / 2), new THREE.Vector3(x1 - x, 1, south - north));
			let wall = this.context.batch(this.m.concrete, (x + x1) / 2, north);
			wall.quad(new THREE.Vector3(x, 9, north), new THREE.Vector3(x1, 9, north), new THREE.Vector3(x1, top, north), new THREE.Vector3(x, top, north),
				[[x, 9], [x1, 9], [x1, top], [x, top]]);
		}

		// Paved under the whole raised stretch of the ring, rather than grass nobody mows
		let underNorth = CityPlan.RING_NORTH - roadWidth(CityPlan.HIGHWAY) / 2 - 0.5;
		let underSouth = CityPlan.RING_NORTH + roadWidth(CityPlan.HIGHWAY) / 2 + 0.5;
		let v = CityPlan.VIADUCT;
		for (let x = v.rampStart; x < v.rampEnd; x += CityContext.CHUNK)
		{
			let x1 = Math.min(x + CityContext.CHUNK, v.rampEnd);
			this.context.batch(this.m.parking, (x + x1) / 2, CityPlan.RING_NORTH, { aRoad: 4, aLane: 2 }, false)
				.flat(x, underNorth, x1, underSouth, CityPlan.GROUND + 0.004, { aRoad: [0, 0, 0, 0], aLane: [0, 0] });
		}

		this.containers(west + 10, east - 10, north + 4, south - 6, top);
		for (const x of [-720, -600, -500])
		{
			this.pier(x, north, 60, 8, true);
		}
		for (let x = west + 4; x < east; x += 10)
		{
			this.context.place('bollard', new THREE.Vector3(x, top, north + 0.6), 0);
		}
	}

	/** Rows of stacked shipping containers in the usual colours. */
	private containers(minX: number, maxX: number, minZ: number, maxZ: number, top: number): void
	{
		const colors = [0xb03a2e, 0x2e6fb0, 0x2f8a52, 0xc98b2b, 0x7b7f86, 0xd6d2c4, 0x7a3fa0, 0x1f4f6b];
		let size = new THREE.Vector3(3.6, 1.5, 1.4);
		let material = this.containerMaterial();
		for (let x = minX; x + size.x < maxX; x += size.x + 0.4)
		{
			if (this.random() < 0.25) { x += 6; continue; }
			for (let z = minZ; z + size.z < maxZ; z += size.z + 0.3)
			{
				if (this.random() < 0.35) continue;
				let stack = 1 + Math.floor(this.random() * 3);
				for (let s = 0; s < stack; s++)
				{
					let centre = new THREE.Vector3(x + size.x / 2, top + size.y * (s + 0.5), z + size.z / 2);
					let color = new THREE.Color(colors[Math.floor(this.random() * colors.length)]);
					let batch = this.context.batch(material, centre.x, centre.z, { color: 3 });
					batch.orientedBox(centre, size, new THREE.Quaternion(), { color: [color.r, color.g, color.b] });
				}
				this.context.collider(new THREE.Vector3(x + size.x / 2, top + size.y * stack / 2, z + size.z / 2), new THREE.Vector3(size.x, size.y * stack, size.z));
			}
		}
	}

	private containerMaterialCache: THREE.MeshStandardMaterial;

	private containerMaterial(): THREE.MeshStandardMaterial
	{
		if (this.containerMaterialCache === undefined)
		{
			let material = this.m.metal.clone();
			material.vertexColors = true;
			material.userData.shaderKey = 'containers';
			this.containerMaterialCache = material;
		}
		return this.containerMaterialCache;
	}

	/** A dockside gantry crane, portal legs straddling the quay and a jib out over the water. */
	private crane(foot: THREE.Vector3): void
	{
		let steel = this.context.batch(this.containerMaterial(), foot.x, foot.z, { color: 3 });
		let color = [0.85, 0.55, 0.12];
		let box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, solid: boolean = true) =>
		{
			let centre = new THREE.Vector3(cx, cy, cz);
			let size = new THREE.Vector3(sx, sy, sz);
			steel.orientedBox(centre, size, new THREE.Quaternion(), { color: color });
			if (solid) this.context.collider(centre, size);
		};
		let h = 18;
		for (const dx of [-5, 5])
		{
			for (const dz of [-3, 3])
			{
				box(foot.x + dx, foot.y + h / 2, foot.z + dz, 0.7, h, 0.7);
			}
		}
		box(foot.x, foot.y + h, foot.z, 12, 1.2, 7.4, false);
		box(foot.x + 14, foot.y + h + 0.3, foot.z, 34, 0.9, 1.4, false);
		box(foot.x - 7, foot.y + h + 1.6, foot.z, 5, 2.4, 3, false);
		box(foot.x, foot.y + h + 5, foot.z, 0.5, 9, 0.5, false);
	}

	/** A timber pier on piles, running out from the shore. */
	private pier(x: number, z: number, length: number, width: number, northward: boolean = false): void
	{
		let top = CityPlan.GROUND + CityPlan.CURB;
		let minX = northward ? x - width / 2 : x;
		let maxX = northward ? x + width / 2 : x + length;
		let minZ = northward ? z - length : z - width / 2;
		let maxZ = northward ? z : z + width / 2;
		let cx = (minX + maxX) / 2;
		let cz = (minZ + maxZ) / 2;

		this.context.batch(this.m.planks, cx, cz, {}, false).flat(minX, minZ, maxX, maxZ, top);
		this.context.batch(this.m.planks, cx, cz).boxSides(minX, top - 0.4, minZ, maxX, top, maxZ, top);
		this.context.collider(new THREE.Vector3(cx, top - 0.25, cz), new THREE.Vector3(maxX - minX, 0.5, maxZ - minZ));

		let posts = this.context.batch(this.m.planks, cx, cz);
		for (let s = 3; s < length; s += 6)
		{
			for (const side of [-1, 1])
			{
				let px = northward ? x + side * (width / 2 - 0.4) : x + s;
				let pz = northward ? z - s : z + side * (width / 2 - 0.4);
				posts.boxSides(px - 0.2, 9, pz - 0.2, px + 0.2, top - 0.3, pz + 0.2, 9);
				// Railings, which also keep cars from driving off the side
				let railX = northward ? x + side * (width / 2 - 0.1) : x + s;
				let railZ = northward ? z - s : z + side * (width / 2 - 0.1);
				posts.boxSides(railX - 0.07, top, railZ - 0.07, railX + 0.07, top + 0.9, railZ + 0.07, top);
			}
		}
		// Rails along both sides
		for (const side of [-1, 1])
		{
			let rx = northward ? x + side * (width / 2 - 0.1) : cx;
			let rz = northward ? cz : z + side * (width / 2 - 0.1);
			let size = northward ? new THREE.Vector3(0.12, 0.12, length) : new THREE.Vector3(length, 0.12, 0.12);
			posts.orientedBox(new THREE.Vector3(rx, top + 0.9, rz), size, new THREE.Quaternion());
			this.context.collider(new THREE.Vector3(rx, top + 0.5, rz), new THREE.Vector3(Math.max(size.x, 0.2), 1, Math.max(size.z, 0.2)));
		}
		this.spawnSpots.push({ position: new THREE.Vector3(cx, top, cz), facing: new THREE.Vector3(northward ? 0 : 1, 0, northward ? -1 : 0) });
	}

	/**
	 * Two towers holding the bridge up, with cables fanned down to the deck.
	 * They stand clear of the roadway, so they're scenery to drive past.
	 */
	private bridgeTowers(): void
	{
		let plan = this.plan;
		let z = CityPlan.BRIDGE_Z;
		let half = roadWidth(CityPlan.BRIDGE) / 2 + 1.2;
		let concrete = this.context.batch(this.m.concrete, -290, z);
		let steel = this.context.batch(this.m.darkMetal, -290, z);
		for (const x of [-320, -250])
		{
			let deck = plan.bridgeHeight(x);
			let topY = deck + 26;
			for (const side of [-1, 1])
			{
				let centre = new THREE.Vector3(x, (8 + topY) / 2, z + side * half);
				concrete.orientedBox(centre, new THREE.Vector3(2.2, topY - 8, 2.2), new THREE.Quaternion());
				this.context.collider(centre, new THREE.Vector3(2.2, topY - 8, 2.2));
			}
			concrete.orientedBox(new THREE.Vector3(x, topY - 1, z), new THREE.Vector3(2, 2, half * 2 + 2.2), new THREE.Quaternion());
			concrete.orientedBox(new THREE.Vector3(x, deck - 1.8, z), new THREE.Vector3(2.4, 1.6, half * 2 + 2.2), new THREE.Quaternion());

			// Cables fanned to the deck edges on both sides of each tower
			for (const side of [-1, 1])
			{
				for (let k = 1; k <= 4; k++)
				{
					for (const dir of [-1, 1])
					{
						let anchor = new THREE.Vector3(x + dir * k * 8, plan.bridgeHeight(x + dir * k * 8) + 0.4, z + side * (half - 0.8));
						let from = new THREE.Vector3(x, topY - 2 - k * 1.2, z + side * half);
						let mid = from.clone().lerp(anchor, 0.5);
						let length = from.distanceTo(anchor);
						let direction = anchor.clone().sub(from).normalize();
						let rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
						steel.orientedBox(mid, new THREE.Vector3(0.09, length, 0.09), rotation);
					}
				}
			}
		}
	}
}
