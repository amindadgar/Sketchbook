import * as THREE from 'three';
import { Block, CityPlan, mulberry32 } from './CityPlan';
import { CityContext } from './CityContext';
import { StreetFurniture } from './StreetFurniture';
import { CityMaterials } from './CityMaterials';

interface Rect { minX: number; maxX: number; minZ: number; maxZ: number; }

interface BuildingOptions
{
	facade: string;
	style: number;
	bay: number;
	shops?: boolean;
	tint?: THREE.Color;
	cornice?: boolean;
	parapet?: boolean;
	rooftop?: 'none' | 'units' | 'tower';
	gable?: boolean;
	baseY?: number;
}

/**
 * Fills the city blocks: a raised pavement round each one, and whatever its
 * zone puts inside. Downtown gets towers on podiums, midtown a street wall of
 * shops with flats and offices over them, the outskirts apartment blocks round
 * courtyards or streets of houses, the harbour warehouses, and a few blocks
 * are left as a park, a plaza or a car park.
 *
 * Everything comes off a seeded generator per block, so every client builds
 * the same buildings in the same places.
 */
export class BlockBuilder
{
	private context: CityContext;
	private plan: CityPlan;
	private m: CityMaterials;
	private random: () => number;
	/** Where the street lights went, so trees don't grow through them. */
	private lampSpots: THREE.Vector3[];

	/** Where people can stand on the pavements, for the pedestrians. */
	public walkways: Rect[] = [];
	public spawnSpots: { position: THREE.Vector3, facing: THREE.Vector3 }[] = [];

	private static readonly STUCCO: number[] = [0xf2e8d8, 0xf4d9c2, 0xe9e2c6, 0xd9e4ea, 0xf1dcc8, 0xe8e8e2, 0xf3e2b8, 0xdfd3c3];
	private static readonly CONCRETE: number[] = [0xd8d6d0, 0xc9c6bf, 0xbfc3c7, 0xe2ddd3];
	private static readonly METAL: number[] = [0xa9adb0, 0x9b5b42, 0x5f7e93, 0x6e8a6a, 0xc8c3b6];

	constructor(context: CityContext, plan: CityPlan, lampSpots: THREE.Vector3[])
	{
		this.context = context;
		this.plan = plan;
		this.m = context.materials;
		this.lampSpots = lampSpots;
	}

	public build(): void
	{
		for (const block of this.plan.blocks)
		{
			this.random = mulberry32(block.seed);
			if (this.cutByRing(block))
			{
				this.leftover(block);
				continue;
			}

			this.pavement(block);
			let lot = this.inset(block, CityPlan.SIDEWALK);

			switch (block.zone)
			{
				case 'downtown': this.downtown(block, lot); break;
				case 'midtown': this.midtown(block, lot); break;
				case 'residential': this.residential(block, lot); break;
				case 'harbor': this.harbor(block, lot); break;
				case 'park': this.park(block, lot); break;
				case 'plaza': this.plaza(block, lot); break;
				case 'parking': this.parkingLot(block, lot); break;
			}

			if (block.zone !== 'park' && block.zone !== 'harbor') this.streetside(block);
		}
	}

	// Helpers

	private inset(r: Rect, by: number): Rect
	{
		return { minX: r.minX + by, maxX: r.maxX - by, minZ: r.minZ + by, maxZ: r.maxZ - by };
	}

	private between(a: number, b: number): number
	{
		return a + (b - a) * this.random();
	}

	private pick<T>(items: T[]): T
	{
		return items[Math.floor(this.random() * items.length)];
	}

	private get top(): number
	{
		return CityPlan.GROUND + CityPlan.CURB;
	}

	/** Whether the highway's rounded corner runs through a block, which then isn't built on. */
	private cutByRing(block: Block): boolean
	{
		const r = CityPlan.RING_RADIUS + 12;
		let corners = [
			new THREE.Vector2(CityPlan.RING_WEST + CityPlan.RING_RADIUS, CityPlan.RING_NORTH + CityPlan.RING_RADIUS),
			new THREE.Vector2(CityPlan.RING_WEST + CityPlan.RING_RADIUS, CityPlan.RING_SOUTH - CityPlan.RING_RADIUS),
			new THREE.Vector2(CityPlan.OCEAN_X - CityPlan.RING_RADIUS, CityPlan.RING_NORTH + CityPlan.RING_RADIUS),
			new THREE.Vector2(CityPlan.OCEAN_X - CityPlan.RING_RADIUS, CityPlan.RING_SOUTH - CityPlan.RING_RADIUS),
		];
		for (const c of corners)
		{
			let nearestX = THREE.MathUtils.clamp(c.x, block.minX, block.maxX);
			let nearestZ = THREE.MathUtils.clamp(c.y, block.minZ, block.maxZ);
			let farX = Math.max(Math.abs(block.minX - c.x), Math.abs(block.maxX - c.x));
			let farZ = Math.max(Math.abs(block.minZ - c.y), Math.abs(block.maxZ - c.y));
			if (Math.hypot(nearestX - c.x, nearestZ - c.y) < r && Math.hypot(farX, farZ) > CityPlan.RING_RADIUS - 12) return true;
		}
		return false;
	}

	/** The scrap of grass inside a highway bend: a few trees, nothing else. */
	private leftover(block: Block): void
	{
		for (let i = 0; i < 6; i++)
		{
			let x = this.between(block.minX + 4, block.maxX - 4);
			let z = this.between(block.minZ + 4, block.maxZ - 4);
			let ring = this.nearRing(x, z);
			if (ring) continue;
			this.tree(new THREE.Vector3(x, CityPlan.GROUND, z));
		}
	}

	private nearRing(x: number, z: number): boolean
	{
		const r = CityPlan.RING_RADIUS;
		let centres = [
			[CityPlan.RING_WEST + r, CityPlan.RING_NORTH + r], [CityPlan.RING_WEST + r, CityPlan.RING_SOUTH - r],
			[CityPlan.OCEAN_X - r, CityPlan.RING_NORTH + r], [CityPlan.OCEAN_X - r, CityPlan.RING_SOUTH - r]];
		for (const [cx, cz] of centres)
		{
			let d = Math.hypot(x - cx, z - cz);
			if (Math.abs(d - r) < 12) return true;
		}
		return false;
	}

	// Pavement

	/** The raised slab a block stands on: paving on top, a kerb round the edge. */
	private pavement(block: Block): void
	{
		let cx = (block.minX + block.maxX) / 2;
		let cz = (block.minZ + block.maxZ) / 2;
		let surface = block.zone === 'harbor' ? this.m.concrete : this.m.sidewalk;
		this.context.batch(surface, cx, cz, {}, false).flat(block.minX, block.minZ, block.maxX, block.maxZ, this.top);
		this.context.batch(this.m.curb, cx, cz, {}, false).boxSides(block.minX, CityPlan.GROUND - 0.1, block.minZ,
			block.maxX, this.top, block.maxZ, CityPlan.GROUND - 0.1);
		this.context.collider(new THREE.Vector3(cx, this.top - 0.5, cz),
			new THREE.Vector3(block.maxX - block.minX, 1, block.maxZ - block.minZ));
		this.walkways.push({ minX: block.minX, maxX: block.maxX, minZ: block.minZ, maxZ: block.maxZ });
	}

	/** Street trees, hydrants and bins along a block's pavements. */
	private streetside(block: Block): void
	{
		let edges = [
			{ from: new THREE.Vector3(block.minX, 0, block.minZ), to: new THREE.Vector3(block.maxX, 0, block.minZ), inward: new THREE.Vector3(0, 0, 1) },
			{ from: new THREE.Vector3(block.maxX, 0, block.maxZ), to: new THREE.Vector3(block.minX, 0, block.maxZ), inward: new THREE.Vector3(0, 0, -1) },
			{ from: new THREE.Vector3(block.minX, 0, block.maxZ), to: new THREE.Vector3(block.minX, 0, block.minZ), inward: new THREE.Vector3(1, 0, 0) },
			{ from: new THREE.Vector3(block.maxX, 0, block.minZ), to: new THREE.Vector3(block.maxX, 0, block.maxZ), inward: new THREE.Vector3(-1, 0, 0) },
		];
		let trees = block.zone !== 'parking' && block.zone !== 'plaza';

		for (const edge of edges)
		{
			let length = edge.from.distanceTo(edge.to);
			let along = edge.to.clone().sub(edge.from).normalize();
			let facing = edge.inward.clone().negate();

			if (trees)
			{
				for (let d = 8; d < length - 8; d += 11 + this.random() * 3)
				{
					let spot = edge.from.clone().add(along.clone().multiplyScalar(d)).add(edge.inward.clone().multiplyScalar(1.35));
					spot.y = this.top;
					if (this.lampSpots.some((l) => Math.abs(l.x - spot.x) + Math.abs(l.z - spot.z) < 2.5)) continue;
					this.tree(spot);
				}
			}

			// A hydrant most sides, a bin by one corner
			if (this.random() < 0.7)
			{
				let d = this.between(10, length - 10);
				let spot = edge.from.clone().add(along.clone().multiplyScalar(d)).add(edge.inward.clone().multiplyScalar(0.6));
				spot.y = this.top;
				this.prop('fire_hydrant', spot, Math.atan2(facing.x, facing.z), new THREE.Vector3(0.28, 0.5, 0.28));
			}
			if (this.random() < 0.5)
			{
				let spot = edge.from.clone().add(along.clone().multiplyScalar(4.5)).add(edge.inward.clone().multiplyScalar(0.7));
				spot.y = this.top;
				this.prop('metal_trash_can', spot, Math.atan2(along.x, along.z), new THREE.Vector3(0.45, 0.55, 0.35));
			}

			// Somewhere for the pedestrians to appear, on each side
			let middle = edge.from.clone().lerp(edge.to, 0.5).add(edge.inward.clone().multiplyScalar(1.9));
			middle.y = this.top;
			this.spawnSpots.push({ position: middle, facing: along });
		}

		if (this.random() < 0.6)
		{
			let spot = new THREE.Vector3(this.between(block.minX + 6, block.maxX - 6), this.top, block.minZ + 2.2);
			this.prop('utility_box_01', spot, 0, new THREE.Vector3(0.32, 0.65, 0.27));
		}
	}

	private tree(spot: THREE.Vector3): void
	{
		// Nothing growing where a game starts
		if (Math.hypot(spot.x - CityPlan.START.x, spot.z - CityPlan.START.z) < 7) return;

		let variant = Math.floor(this.random() * 3);
		this.context.place('tree' + variant, spot, this.random() * Math.PI * 2, 0.85 + this.random() * 0.35);
		this.context.collider(spot.clone().setY(spot.y + 1.2), new THREE.Vector3(0.28, 2.4, 0.28));
	}

	private palm(spot: THREE.Vector3): void
	{
		let variant = Math.floor(this.random() * 3);
		this.context.place('palm' + variant, spot, this.random() * Math.PI * 2, 0.9 + this.random() * 0.3);
		this.context.collider(spot.clone().setY(spot.y + 1.5), new THREE.Vector3(0.34, 3, 0.34));
	}

	/** Things a car goes through rather than stopping against, and how heavy each is. */
	private static readonly BREAKABLE_PROPS: { [kind: string]: number } = {
		'fire_hydrant': 2.5, 'metal_trash_can': 1, 'utility_box_01': 3, 'modular_street_seating': 2, 'street_lamp_01': 2.5
	};

	private prop(kind: string, spot: THREE.Vector3, yaw: number, size?: THREE.Vector3, scale: number = 1): void
	{
		let ref = this.context.place(kind, spot, yaw, scale);
		if (size === undefined) return;

		let mass = BlockBuilder.BREAKABLE_PROPS[kind];
		if (mass !== undefined)
		{
			this.context.breakable(StreetFurniture.propBreakable(spot, yaw, size, ref, mass));
			return;
		}
		let rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
		this.context.collider(spot.clone().setY(spot.y + size.y / 2), size, rotation);
	}

	// Buildings

	/**
	 * A box of a building standing on the pavement. Walls get windows by
	 * style, the top a gravel roof inside a parapet, and optionally a cornice,
	 * rooftop plant and a gabled roof.
	 */
	private building(r: Rect, height: number, o: BuildingOptions): void
	{
		let base = o.baseY !== undefined ? o.baseY : this.top;
		let topY = base + height;
		let cx = (r.minX + r.maxX) / 2;
		let cz = (r.minZ + r.maxZ) / 2;
		let material = this.m.facades[o.facade];
		let tint = o.tint || new THREE.Color(1, 1, 1);
		let seed = Math.floor(this.random() * 1000);
		let extras = { aFacade: 4, aTint: 3 };
		let walls = this.context.batch(material, cx, cz, extras);

		walls.boxSides(r.minX, base, r.minZ, r.maxX, topY, r.maxZ, this.top,
			{ aFacade: [CityPlan.FLOOR, o.bay, o.style + (o.shops ? 10 : 0), seed], aTint: [tint.r, tint.g, tint.b] });
		this.context.collider(new THREE.Vector3(cx, (base + topY) / 2, cz), new THREE.Vector3(r.maxX - r.minX, topY - base, r.maxZ - r.minZ));

		let blank = { aFacade: [CityPlan.FLOOR, o.bay, 4, seed], aTint: [tint.r * 0.9, tint.g * 0.9, tint.b * 0.9] };

		if (o.gable)
		{
			this.gable(r, topY, material, blank);
			return;
		}

		this.context.batch(this.m.roof, cx, cz).flat(r.minX, r.minZ, r.maxX, r.maxZ, topY);

		if (o.parapet !== false)
		{
			let t = 0.25;
			let h = 0.7;
			walls.boxSides(r.minX, topY, r.minZ, r.maxX, topY + h, r.minZ + t, this.top, blank);
			walls.boxSides(r.minX, topY, r.maxZ - t, r.maxX, topY + h, r.maxZ, this.top, blank);
			walls.boxSides(r.minX, topY, r.minZ + t, r.minX + t, topY + h, r.maxZ - t, this.top, blank);
			walls.boxSides(r.maxX - t, topY, r.minZ + t, r.maxX, topY + h, r.maxZ - t, this.top, blank);
		}

		if (o.cornice)
		{
			let out = 0.3;
			walls.boxSides(r.minX - out, topY - 0.45, r.minZ - out, r.maxX + out, topY, r.maxZ + out, this.top, blank);
			this.context.batch(this.m.roof, cx, cz).flat(r.minX - out, r.minZ - out, r.maxX + out, r.maxZ + out, topY - 0.001);
		}

		let rooftop = o.rooftop || 'units';
		let w = r.maxX - r.minX;
		let d = r.maxZ - r.minZ;
		if (rooftop === 'units' && w > 6 && d > 6)
		{
			let units = 1 + Math.floor(this.random() * 3);
			for (let i = 0; i < units; i++)
			{
				let spot = new THREE.Vector3(this.between(r.minX + 2, r.maxX - 2), topY, this.between(r.minZ + 2, r.maxZ - 2));
				this.context.place('ac', spot, this.random() < 0.5 ? 0 : Math.PI / 2);
			}
			if (this.random() < 0.3 && height < 40)
			{
				this.context.place('tank', new THREE.Vector3(this.between(r.minX + 2, r.maxX - 2), topY, this.between(r.minZ + 2, r.maxZ - 2)), 0);
			}
		}
		else if (rooftop === 'tower')
		{
			// Plant room, and an aerial on top of that
			let plant = this.inset(r, Math.min(w, d) * 0.28);
			this.building(plant, 4, { facade: o.facade, style: 4, bay: o.bay, tint: tint, parapet: false, rooftop: 'none', baseY: topY });
			if (this.random() < 0.6) this.context.place('antenna', new THREE.Vector3(cx, topY + 4, cz), 0, 1 + this.random());
		}
	}

	/** A pitched roof along the longer side, tiles on the slopes and wall in the ends. */
	private gable(r: Rect, eaves: number, wallMaterial: THREE.Material, blank: any): void
	{
		let cx = (r.minX + r.maxX) / 2;
		let cz = (r.minZ + r.maxZ) / 2;
		let alongX = (r.maxX - r.minX) >= (r.maxZ - r.minZ);
		let span = alongX ? r.maxZ - r.minZ : r.maxX - r.minX;
		let ridge = eaves + span * 0.38;
		let over = 0.35;
		let roof = this.context.batch(this.m.roofTiles, cx, cz);
		let wall = this.context.batch(wallMaterial, cx, cz, { aFacade: 4, aTint: 3 });
		let V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

		if (alongX)
		{
			let x0 = r.minX - over, x1 = r.maxX + over;
			let slope = Math.hypot(span / 2 + over, ridge - eaves);
			roof.quad(V(x0, eaves - 0.2, r.maxZ + over), V(x1, eaves - 0.2, r.maxZ + over), V(x1, ridge, cz), V(x0, ridge, cz), [[0, 0], [x1 - x0, 0], [x1 - x0, slope], [0, slope]]);
			roof.quad(V(x1, eaves - 0.2, r.minZ - over), V(x0, eaves - 0.2, r.minZ - over), V(x0, ridge, cz), V(x1, ridge, cz), [[0, 0], [x1 - x0, 0], [x1 - x0, slope], [0, slope]]);
			wall.triangle(V(r.maxX, eaves, r.maxZ), V(r.maxX, eaves, r.minZ), V(r.maxX, ridge, cz), [[0, eaves], [span, eaves], [span / 2, ridge]], blank);
			wall.triangle(V(r.minX, eaves, r.minZ), V(r.minX, eaves, r.maxZ), V(r.minX, ridge, cz), [[0, eaves], [span, eaves], [span / 2, ridge]], blank);
		}
		else
		{
			let z0 = r.minZ - over, z1 = r.maxZ + over;
			let slope = Math.hypot(span / 2 + over, ridge - eaves);
			roof.quad(V(r.maxX + over, eaves - 0.2, z1), V(r.maxX + over, eaves - 0.2, z0), V(cx, ridge, z0), V(cx, ridge, z1), [[0, 0], [z1 - z0, 0], [z1 - z0, slope], [0, slope]]);
			roof.quad(V(r.minX - over, eaves - 0.2, z0), V(r.minX - over, eaves - 0.2, z1), V(cx, ridge, z1), V(cx, ridge, z0), [[0, 0], [z1 - z0, 0], [z1 - z0, slope], [0, slope]]);
			wall.triangle(V(r.minX, eaves, r.maxZ), V(r.maxX, eaves, r.maxZ), V(cx, ridge, r.maxZ), [[0, eaves], [span, eaves], [span / 2, ridge]], blank);
			wall.triangle(V(r.maxX, eaves, r.minZ), V(r.minX, eaves, r.minZ), V(cx, ridge, r.minZ), [[0, eaves], [span, eaves], [span / 2, ridge]], blank);
		}
	}

	private tintFrom(colors: number[]): THREE.Color
	{
		return new THREE.Color(this.pick(colors));
	}

	/** Height scale: everything gets taller toward the middle of downtown. */
	private centrality(block: Block): number
	{
		let cx = (block.minX + block.maxX) / 2;
		let cz = (block.minZ + block.maxZ) / 2;
		let distance = Math.hypot(cx - CityPlan.DOWNTOWN.x, cz - CityPlan.DOWNTOWN.y);
		return THREE.MathUtils.clamp(1 - distance / 420, 0, 1);
	}

	// Zones

	private downtown(block: Block, lot: Rect): void
	{
		let c = this.centrality(block);
		let podiumFacade = this.pick(['concrete', 'tiles', 'concrete']);
		let podiumHeight = CityPlan.FLOOR * (2 + Math.floor(this.random() * 3));
		let tint = this.tintFrom(BlockBuilder.CONCRETE);
		this.building(lot, podiumHeight, { facade: podiumFacade, style: 1, bay: 3, shops: true, tint: tint, rooftop: 'none' });

		let w = lot.maxX - lot.minX;
		let d = lot.maxZ - lot.minZ;
		let towers = this.random() < 0.65 ? 1 : 2;
		let base = this.top + podiumHeight;

		for (let t = 0; t < towers; t++)
		{
			let tw = w * (towers === 1 ? this.between(0.5, 0.72) : this.between(0.36, 0.44));
			let td = d * this.between(0.5, 0.78);
			let cx = towers === 1
				? (lot.minX + lot.maxX) / 2 + this.between(-0.1, 0.1) * w
				: lot.minX + w * (t === 0 ? 0.26 : 0.74);
			let cz = (lot.minZ + lot.maxZ) / 2 + this.between(-0.08, 0.08) * d;
			let height = Math.round((40 + c * 110 + this.random() * 40) / CityPlan.FLOOR) * CityPlan.FLOOR;
			if (towers === 2) height *= 0.75;

			let glass = this.random() < 0.65;
			let facade = glass ? 'glass' : this.pick(['tiles', 'concrete']);
			let style = glass ? 2 : 1;
			let bay = glass ? 1.6 : 2.6;
			let towerTint = glass ? new THREE.Color(this.pick([0x6c7784, 0x8a8f86, 0x5d6670, 0xb0a894])) : this.tintFrom(BlockBuilder.CONCRETE);

			// One to three tiers, each set back from the last
			let tiers = height > 90 ? 3 : height > 55 ? 2 : 1;
			let y = base;
			let half = new THREE.Vector2(tw / 2, td / 2);
			for (let k = 0; k < tiers; k++)
			{
				let share = tiers === 1 ? 1 : k === 0 ? this.between(0.5, 0.62) : k === tiers - 1 ? 1 : 0.6;
				let remaining = base + height - y;
				let tierHeight = k === tiers - 1 ? remaining : Math.round(remaining * share / CityPlan.FLOOR) * CityPlan.FLOOR;
				let r = { minX: cx - half.x, maxX: cx + half.x, minZ: cz - half.y, maxZ: cz + half.y };
				let last = k === tiers - 1;
				this.building(r, tierHeight, {
					facade: facade, style: style, bay: bay, tint: towerTint, baseY: y,
					rooftop: last ? 'tower' : 'none', parapet: true
				});
				y += tierHeight;
				half.multiplyScalar(this.between(0.72, 0.86));
			}
		}
	}

	private midtown(block: Block, lot: Rect): void
	{
		let c = this.centrality(block);
		let w = lot.maxX - lot.minX;
		let d = lot.maxZ - lot.minZ;
		let columns = 2 + Math.floor(this.random() * 3);
		let rows = 2;

		for (let i = 0; i < columns; i++)
		{
			for (let j = 0; j < rows; j++)
			{
				if (this.random() < 0.06) continue;
				let x0 = lot.minX + (w * i) / columns;
				let x1 = lot.minX + (w * (i + 1)) / columns;
				let z0 = lot.minZ + (d * j) / rows;
				let z1 = lot.minZ + (d * (j + 1)) / rows;
				// A little air between neighbours, never on the street front
				let gap = this.random() < 0.3 ? 1.2 : 0;
				let r = { minX: x0 + (i > 0 ? gap : 0), maxX: x1 - (i < columns - 1 ? gap : 0), minZ: z0 + (j > 0 ? 0.6 : 0), maxZ: z1 - (j < rows - 1 ? 0.6 : 0) };

				let floors = Math.round(3 + c * 9 + this.random() * (4 + c * 6));
				let facade = this.pick(['brick', 'brick', 'tan', 'stucco', 'stucco', 'concrete', 'tiles']);
				let tint = facade === 'stucco' ? this.tintFrom(BlockBuilder.STUCCO)
					: facade === 'concrete' ? this.tintFrom(BlockBuilder.CONCRETE)
					: new THREE.Color(1, 1, 1).multiplyScalar(this.between(0.85, 1.05));
				let style = facade === 'tiles' ? 1 : (this.random() < 0.8 ? 0 : 1);
				this.building(r, floors * CityPlan.FLOOR, {
					facade: facade, style: style, bay: style === 0 ? this.between(1.8, 2.4) : 3,
					shops: this.random() < 0.75, tint: tint,
					cornice: facade === 'brick' || facade === 'tan' || (facade === 'stucco' && this.random() < 0.5)
				});
			}
		}
	}

	private residential(block: Block, lot: Rect): void
	{
		if (this.random() < 0.5)
		{
			this.apartments(block, lot);
		}
		else
		{
			this.houses(block, lot);
		}
	}

	/** Four blocks of flats round a green courtyard. */
	private apartments(block: Block, lot: Rect): void
	{
		let depth = 11;
		let floors = 3 + Math.floor(this.random() * 3);
		let facade = this.pick(['brick', 'tan', 'stucco', 'stucco']);
		let tint = facade === 'stucco' ? this.tintFrom(BlockBuilder.STUCCO) : new THREE.Color(1, 1, 1);
		let options: BuildingOptions = { facade: facade, style: 0, bay: 2.2, tint: tint, cornice: facade !== 'stucco', shops: this.random() < 0.3 };
		let h = floors * CityPlan.FLOOR;

		this.building({ minX: lot.minX, maxX: lot.maxX, minZ: lot.minZ, maxZ: lot.minZ + depth }, h, options);
		this.building({ minX: lot.minX, maxX: lot.maxX, minZ: lot.maxZ - depth, maxZ: lot.maxZ }, h, options);
		this.building({ minX: lot.minX, maxX: lot.minX + depth, minZ: lot.minZ + depth + 0.5, maxZ: lot.maxZ - depth - 0.5 }, h - CityPlan.FLOOR, options);
		this.building({ minX: lot.maxX - depth, maxX: lot.maxX, minZ: lot.minZ + depth + 0.5, maxZ: lot.maxZ - depth - 0.5 }, h - CityPlan.FLOOR, options);

		let yard = { minX: lot.minX + depth, maxX: lot.maxX - depth, minZ: lot.minZ + depth, maxZ: lot.maxZ - depth };
		if (yard.maxX - yard.minX > 4 && yard.maxZ - yard.minZ > 4)
		{
			let cx = (yard.minX + yard.maxX) / 2;
			let cz = (yard.minZ + yard.maxZ) / 2;
			this.context.batch(this.m.grass, cx, cz, {}, false).flat(yard.minX, yard.minZ, yard.maxX, yard.maxZ, this.top + 0.01);
			for (let i = 0; i < 3; i++)
			{
				this.tree(new THREE.Vector3(this.between(yard.minX + 2, yard.maxX - 2), this.top, this.between(yard.minZ + 2, yard.maxZ - 2)));
			}
		}
	}

	/** A street of detached houses with front gardens. */
	private houses(block: Block, lot: Rect): void
	{
		let w = lot.maxX - lot.minX;
		let d = lot.maxZ - lot.minZ;
		let cx = (lot.minX + lot.maxX) / 2;
		let cz = (lot.minZ + lot.maxZ) / 2;
		this.context.batch(this.m.grass, cx, cz, {}, false).flat(lot.minX, lot.minZ, lot.maxX, lot.maxZ, this.top + 0.01);

		let across = Math.max(2, Math.floor(w / 13));
		let plot = w / across;
		for (const row of [0, 1])
		{
			for (let i = 0; i < across; i++)
			{
				let x0 = lot.minX + plot * i + 1.8;
				let x1 = lot.minX + plot * (i + 1) - 1.8;
				let houseDepth = this.between(8, 10);
				// Set back from the pavement behind a front garden
				let front = 4 + this.random() * 2;
				let r = row === 0
					? { minX: x0, maxX: x1, minZ: lot.minZ + front, maxZ: lot.minZ + front + houseDepth }
					: { minX: x0, maxX: x1, maxZ: lot.maxZ - front, minZ: lot.maxZ - front - houseDepth };
				if (r.maxZ - r.minZ > d / 2) continue;
				let floors = this.random() < 0.7 ? 2 : 1;
				this.building(r, floors * CityPlan.FLOOR * 0.9, {
					facade: this.random() < 0.75 ? 'stucco' : 'tan', style: 0, bay: 2.4,
					tint: this.tintFrom(BlockBuilder.STUCCO), gable: true
				});
				if (this.random() < 0.6)
				{
					let gardenZ = row === 0 ? lot.minZ + front / 2 : lot.maxZ - front / 2;
					this.context.place('shrub', new THREE.Vector3(this.between(x0, x1), this.top, gardenZ), this.random() * 6);
				}
				if (this.random() < 0.4)
				{
					let backZ = row === 0 ? r.maxZ + 3 : r.minZ - 3;
					this.tree(new THREE.Vector3((x0 + x1) / 2, this.top, backZ));
				}
			}
		}
	}

	/** Sheds for the docks: big, plain, and mostly shut. */
	private harbor(block: Block, lot: Rect): void
	{
		let w = lot.maxX - lot.minX;
		let count = w > 40 ? 2 : 1;
		for (let i = 0; i < count; i++)
		{
			let x0 = lot.minX + (w * i) / count + (i > 0 ? 3 : 0);
			let x1 = lot.minX + (w * (i + 1)) / count - (i < count - 1 ? 3 : 0);
			let r = { minX: x0, maxX: x1, minZ: lot.minZ + 2, maxZ: lot.maxZ - this.between(2, 8) };
			this.building(r, this.between(6, 9), {
				facade: 'warehouse', style: 3, bay: 4, tint: this.tintFrom(BlockBuilder.METAL),
				parapet: false, rooftop: this.random() < 0.5 ? 'units' : 'none'
			});
		}
	}

	private plaza(block: Block, lot: Rect): void
	{
		let cx = (lot.minX + lot.maxX) / 2;
		let cz = (lot.minZ + lot.maxZ) / 2;
		// Fountain: a basin, water, a column
		let basin = this.context.batch(this.m.concrete, cx, cz);
		basin.boxSides(cx - 5, this.top, cz - 5, cx + 5, this.top + 0.6, cz + 5, this.top);
		this.context.batch(this.m.concrete, cx, cz).flat(cx - 5, cz - 5, cx + 5, cz + 5, this.top + 0.6);
		this.context.collider(new THREE.Vector3(cx, this.top + 0.3, cz), new THREE.Vector3(10, 0.6, 10));
		basin.boxSides(cx - 0.6, this.top, cz - 0.6, cx + 0.6, this.top + 3, cz + 0.6, this.top);

		for (let i = 0; i < 4; i++)
		{
			let angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
			this.prop('modular_street_seating', new THREE.Vector3(cx + Math.cos(angle) * 9, this.top, cz + Math.sin(angle) * 9),
				-angle + Math.PI / 2, new THREE.Vector3(1.3, 0.5, 0.45));
			this.prop('street_lamp_01', new THREE.Vector3(cx + Math.cos(angle + 0.4) * 12, this.top, cz + Math.sin(angle + 0.4) * 12), angle, new THREE.Vector3(0.2, 2.2, 0.2), 1.6);
		}
		for (let x = lot.minX + 4; x < lot.maxX - 3; x += 9)
		{
			for (const z of [lot.minZ + 4, lot.maxZ - 4])
			{
				this.prop('planter_box_01', new THREE.Vector3(x, this.top, z), 0, new THREE.Vector3(0.55, 0.3, 0.25), 1.6);
				this.tree(new THREE.Vector3(x + 4.5, this.top, z));
			}
		}
	}

	private parkingLot(block: Block, lot: Rect): void
	{
		let cx = (lot.minX + lot.maxX) / 2;
		let cz = (lot.minZ + lot.maxZ) / 2;
		// Plain tarmac: a junction square with no crossings is exactly that
		let batch = this.context.batch(this.m.parking, cx, cz, { aRoad: 4, aLane: 2 }, false);
		let hx = (lot.maxX - lot.minX) / 2;
		let hz = (lot.maxZ - lot.minZ) / 2;
		let y = this.top + 0.01;
		batch.quad(new THREE.Vector3(lot.minX, y, lot.maxZ), new THREE.Vector3(lot.maxX, y, lot.maxZ),
			new THREE.Vector3(lot.maxX, y, lot.minZ), new THREE.Vector3(lot.minX, y, lot.minZ),
			[[lot.minX, -lot.maxZ], [lot.maxX, -lot.maxZ], [lot.maxX, -lot.minZ], [lot.minX, -lot.minZ]],
			{ aRoad: [hx, hz, 0, 0], aLane: [0, 0] }, new THREE.Vector3(0, 1, 0));
		for (let x = lot.minX + 3; x < lot.maxX; x += 12)
		{
			this.prop('planter_box_01', new THREE.Vector3(x, y, cz), 0, new THREE.Vector3(0.55, 0.3, 0.25), 1.6);
		}
	}

	/** Grass, paths round and across, a pond, and plenty of trees. */
	private park(block: Block, lot: Rect): void
	{
		let cx = (block.minX + block.maxX) / 2;
		let cz = (block.minZ + block.maxZ) / 2;
		let y = this.top + 0.01;
		this.context.batch(this.m.grass, cx, cz, {}, false).flat(lot.minX, lot.minZ, lot.maxX, lot.maxZ, y);

		let paths = this.context.batch(this.m.sidewalk, cx, cz, {}, false);
		let pw = 1.6;
		paths.flat(lot.minX, cz - pw, lot.maxX, cz + pw, y + 0.01);
		paths.flat(cx - pw, lot.minZ, cx + pw, lot.maxZ, y + 0.01);
		paths.flat(lot.minX + 6, lot.minZ + 6, lot.maxX - 6, lot.minZ + 6 + pw * 2, y + 0.012);
		paths.flat(lot.minX + 6, lot.maxZ - 6 - pw * 2, lot.maxX - 6, lot.maxZ - 6, y + 0.012);
		paths.flat(lot.minX + 6, lot.minZ + 6, lot.minX + 6 + pw * 2, lot.maxZ - 6, y + 0.012);
		paths.flat(lot.maxX - 6 - pw * 2, lot.minZ + 6, lot.maxX - 6, lot.maxZ - 6, y + 0.012);
		this.walkways.push({ minX: lot.minX, maxX: lot.maxX, minZ: cz - pw, maxZ: cz + pw });
		this.walkways.push({ minX: cx - pw, maxX: cx + pw, minZ: lot.minZ, maxZ: lot.maxZ });

		// The pond, off in one quarter
		let px = cx + (lot.maxX - cx) * 0.5;
		let pz = cz + (lot.maxZ - cz) * 0.5;
		let pond = new THREE.Mesh(new THREE.CircleGeometry(11, 40), new THREE.MeshStandardMaterial({ color: 0x1b3b44, roughness: 0.04, metalness: 0.1 }));
		pond.rotation.x = -Math.PI / 2;
		pond.position.set(px, y + 0.02, pz);
		pond.receiveShadow = true;
		this.context.group.add(pond);
		let rim = new THREE.Mesh(new THREE.RingGeometry(11, 11.8, 40), this.m.concrete);
		rim.rotation.x = -Math.PI / 2;
		rim.position.set(px, y + 0.06, pz);
		rim.receiveShadow = true;
		this.context.group.add(rim);

		for (let i = 0; i < 70; i++)
		{
			let x = this.between(lot.minX + 3, lot.maxX - 3);
			let z = this.between(lot.minZ + 3, lot.maxZ - 3);
			if (Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4) continue;
			if (Math.hypot(x - px, z - pz) < 14) continue;
			if (this.random() < 0.15) this.palm(new THREE.Vector3(x, y, z));
			else this.tree(new THREE.Vector3(x, y, z));
		}

		for (let t = -1; t <= 1; t += 2)
		{
			for (let k = 1; k <= 3; k++)
			{
				let along = (lot.maxX - lot.minX) * 0.14 * k;
				this.prop('modular_street_seating', new THREE.Vector3(cx + t * along, y, cz + pw + 1.2), Math.PI, new THREE.Vector3(1.3, 0.5, 0.45));
				this.prop('street_lamp_01', new THREE.Vector3(cx + t * along + 3, y, cz - pw - 0.8), 0, new THREE.Vector3(0.2, 2.2, 0.2), 1.6);
				this.prop('street_lamp_01', new THREE.Vector3(cx - pw - 0.8, y, cz + t * along), 0, new THREE.Vector3(0.2, 2.2, 0.2), 1.6);
			}
		}
		this.spawnSpots.push({ position: new THREE.Vector3(cx + 10, y, cz), facing: new THREE.Vector3(1, 0, 0) });
		this.spawnSpots.push({ position: new THREE.Vector3(cx, y, cz + 10), facing: new THREE.Vector3(0, 0, 1) });
	}
}
