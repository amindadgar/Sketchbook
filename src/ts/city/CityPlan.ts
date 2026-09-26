import * as THREE from 'three';
import { mulberry32 } from '../core/FunctionLibrary';

/**
 * Where everything in the city goes, worked out once and the same on every
 * client, since a party has to be standing in the same streets.
 *
 * The world is built at the boxman's scale: a person is one unit tall, which
 * makes a real metre about 0.58 of a unit. Everything here is in those units.
 *
 * The city sits on the mainland to the west of the island, joined to it by a
 * bridge. Avenues run north to south, streets east to west, and a coastal
 * highway rings the lot, lifted onto a viaduct past the harbour.
 */

export { mulberry32 };

export type Zone = 'downtown' | 'midtown' | 'residential' | 'park' | 'harbor' | 'parking' | 'plaza';

export interface Block
{
	index: number;
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	zone: Zone;
	seed: number;
}

/** A straight stretch of road between two nodes, drawn with markings. */
export interface RoadSegment
{
	id: number;
	kind: 'avenue' | 'street' | 'boulevard' | 'highway' | 'bridge';
	/** Centreline ends, with height. */
	a: THREE.Vector3;
	b: THREE.Vector3;
	lanes: number;
	laneWidth: number;
	/** Painted median between the two directions; zero is a double yellow line. */
	median: number;
	/** Parking strip each side, beyond the outer lane. */
	parking: number;
	/** Graph node ids at each end. */
	from: number;
	to: number;
	/** Concrete barriers down the edges, for anything raised. */
	barriers: boolean;
	elevated: boolean;
}

export interface RoadNode
{
	id: number;
	position: THREE.Vector3;
	/** Crossing of two or more roads, which gets a paved square and lights. */
	junction: boolean;
	segments: number[];
	signals: boolean;
	/** Half extents of the paved square, along x and z. */
	halfX: number;
	halfZ: number;
}

export function roadWidth(segment: { lanes: number, laneWidth: number, median: number, parking: number }): number
{
	return segment.lanes * segment.laneWidth * 2 + segment.median + segment.parking * 2;
}

export class CityPlan
{
	public static readonly METRE: number = 0.58;
	public static readonly GROUND: number = 15.0;
	public static readonly CURB: number = 0.15;
	public static readonly SIDEWALK: number = 2.6;
	public static readonly FLOOR: number = 2.0;

	/** Land edges. The sea is everywhere else. */
	public static readonly LAND = { minX: -1100, maxX: -360, minZ: -580, maxZ: 580 };

	/** Avenues, west of the coast road, and streets, north to south. */
	public static readonly OCEAN_X: number = -420;
	public static readonly AVENUES: number[] = [-420, -492, -564, -636, -708, -780, -852, -924, -996];
	public static readonly STREETS: number[] = [-480, -420, -360, -300, -240, -180, -120, -60, 0, 60, 120, 180, 240, 300, 360, 420, 480];

	/** The highway ring's legs. The east side of the loop is the coast road. */
	public static readonly RING_WEST: number = -1060;
	public static readonly RING_NORTH: number = -540;
	public static readonly RING_SOUTH: number = 540;
	public static readonly RING_RADIUS: number = 40;

	/** The north leg climbs onto a viaduct past the harbour. */
	public static readonly VIADUCT = { rampStart: -980, top: -890, topEnd: -580, rampEnd: -480, height: 9 };

	/** The bridge to the island leaves the coast road on this street. */
	public static readonly BRIDGE_Z: number = 60;
	public static readonly BRIDGE_END_X: number = -205;
	/** Where the island's walls are, on the side the bridge comes in. */
	public static readonly ISLAND_EDGE: number = -211.9;
	public static readonly ISLAND_RIM: number = 20.96;

	public static readonly DOWNTOWN = new THREE.Vector2(-708, 0);

	/**
	 * Where a game starts: downtown, on the north pavement of the street through
	 * the middle, a step in from its kerb (the street is eight units across).
	 */
	public static readonly START = new THREE.Vector3(-684, 0, -5.4);

	/** The park takes two blocks by two, and the roads between them. */
	public static readonly PARK = { minX: -780, maxX: -636, minZ: 180, maxZ: 300 };

	public static readonly AVENUE = { lanes: 2, laneWidth: 2.5, median: 0.6, parking: 0 };
	public static readonly OCEAN = { lanes: 2, laneWidth: 2.6, median: 2.4, parking: 0 };
	public static readonly STREET = { lanes: 1, laneWidth: 2.7, median: 0, parking: 1.3 };
	public static readonly HIGHWAY = { lanes: 3, laneWidth: 2.5, median: 1.6, parking: 0.7 };
	public static readonly BRIDGE = { lanes: 2, laneWidth: 2.6, median: 1.2, parking: 0.9 };

	public blocks: Block[] = [];
	public nodes: RoadNode[] = [];
	public segments: RoadSegment[] = [];

	/** The loop a race follows: ring highway and coast road, clockwise from the bridge. */
	public loop: THREE.Vector3[] = [];

	constructor()
	{
		this.layRoads();
		this.layBlocks();
		this.layLoop();
	}

	// Roads

	private nodeAt(x: number, z: number, y: number = CityPlan.GROUND): RoadNode
	{
		for (const node of this.nodes)
		{
			if (Math.abs(node.position.x - x) < 0.01 && Math.abs(node.position.z - z) < 0.01) return node;
		}

		let node: RoadNode = {
			id: this.nodes.length,
			position: new THREE.Vector3(x, y, z),
			junction: false,
			segments: [],
			signals: false,
			halfX: 0,
			halfZ: 0
		};
		this.nodes.push(node);
		return node;
	}

	private addSegment(kind: RoadSegment['kind'], from: RoadNode, to: RoadNode, profile: any,
		options: { barriers?: boolean, elevated?: boolean } = {}): RoadSegment
	{
		let segment: RoadSegment = {
			id: this.segments.length,
			kind: kind,
			a: from.position.clone(),
			b: to.position.clone(),
			lanes: profile.lanes,
			laneWidth: profile.laneWidth,
			median: profile.median,
			parking: profile.parking,
			from: from.id,
			to: to.id,
			barriers: options.barriers === true,
			elevated: options.elevated === true
		};
		this.segments.push(segment);
		from.segments.push(segment.id);
		to.segments.push(segment.id);
		return segment;
	}

	private inPark(x: number, z: number): boolean
	{
		let park = CityPlan.PARK;
		return x > park.minX + 1 && x < park.maxX - 1 && z > park.minZ + 1 && z < park.maxZ - 1;
	}

	private layRoads(): void
	{
		const avenues = CityPlan.AVENUES;
		const streets = CityPlan.STREETS;
		const north = streets[0];
		const south = streets[streets.length - 1];

		// Avenues, north to south, one segment per block. The coast road and
		// the westernmost avenue carry on to the ring; the rest stop at the
		// first street, where the harbour and the viaduct take over
		for (const x of avenues)
		{
			let profile = x === CityPlan.OCEAN_X ? CityPlan.OCEAN : CityPlan.AVENUE;
			let kind: RoadSegment['kind'] = x === CityPlan.OCEAN_X ? 'boulevard' : 'avenue';
			let stops = [...streets];
			if (x === CityPlan.OCEAN_X || x === avenues[avenues.length - 1])
			{
				stops = [CityPlan.RING_NORTH + (x === CityPlan.OCEAN_X ? CityPlan.RING_RADIUS : 0), ...streets,
					CityPlan.RING_SOUTH - (x === CityPlan.OCEAN_X ? CityPlan.RING_RADIUS : 0)];
			}
			else
			{
				stops = [...streets, CityPlan.RING_SOUTH];
			}

			for (let i = 0; i + 1 < stops.length; i++)
			{
				let midZ = (stops[i] + stops[i + 1]) / 2;
				if (this.inPark(x, midZ)) continue;
				this.addSegment(kind, this.nodeAt(x, stops[i]), this.nodeAt(x, stops[i + 1]), profile);
			}
		}

		// Streets, east to west, from the coast road to the ring
		const west = CityPlan.RING_WEST;
		for (const z of streets)
		{
			let stops = [...avenues, west];
			for (let i = 0; i + 1 < stops.length; i++)
			{
				let midX = (stops[i] + stops[i + 1]) / 2;
				if (this.inPark(midX, z)) continue;
				this.addSegment('street', this.nodeAt(stops[i], z), this.nodeAt(stops[i + 1], z), CityPlan.STREET);
			}
		}

		// The ring: west leg, and the south leg all the way to the coast road
		const r = CityPlan.RING_RADIUS;
		let westStops = [CityPlan.RING_NORTH + r, ...streets, CityPlan.RING_SOUTH - r];
		for (let i = 0; i + 1 < westStops.length; i++)
		{
			this.addSegment('highway', this.nodeAt(west, westStops[i]), this.nodeAt(west, westStops[i + 1]), CityPlan.HIGHWAY);
		}

		let southStops = [west + r, ...avenues.slice().reverse().filter((x) => x > west + r && x < CityPlan.OCEAN_X - r), CityPlan.OCEAN_X - r];
		for (let i = 0; i + 1 < southStops.length; i++)
		{
			this.addSegment('highway', this.nodeAt(southStops[i], CityPlan.RING_SOUTH), this.nodeAt(southStops[i + 1], CityPlan.RING_SOUTH), CityPlan.HIGHWAY);
		}

		// North leg, over the viaduct, with nothing joining it in between
		let v = CityPlan.VIADUCT;
		let northY = (x: number) => CityPlan.GROUND + this.viaductHeight(x);
		// Short pieces up and down the ramps so the deck follows their curve
		let northStops = [west + r, avenues[avenues.length - 1]];
		for (let x = v.rampStart; x < v.top; x += 10) northStops.push(x);
		northStops.push(v.top, (v.top * 2 + v.topEnd) / 3, (v.top + v.topEnd * 2) / 3, v.topEnd);
		for (let x = v.topEnd + 10; x < v.rampEnd; x += 10) northStops.push(x);
		northStops.push(v.rampEnd, CityPlan.OCEAN_X - r);
		for (let i = 0; i + 1 < northStops.length; i++)
		{
			let a = this.nodeAt(northStops[i], CityPlan.RING_NORTH, northY(northStops[i]));
			let b = this.nodeAt(northStops[i + 1], CityPlan.RING_NORTH, northY(northStops[i + 1]));
			let raised = this.viaductHeight((northStops[i] + northStops[i + 1]) / 2) > 0.5;
			this.addSegment('highway', a, b, CityPlan.HIGHWAY, { barriers: raised, elevated: raised });
		}

		// Corners, as short chords round a quarter circle
		this.addCorner(west + r, CityPlan.RING_NORTH + r, Math.PI, 'NW');
		this.addCorner(west + r, CityPlan.RING_SOUTH - r, Math.PI / 2, 'SW');
		this.addCorner(CityPlan.OCEAN_X - r, CityPlan.RING_NORTH + r, -Math.PI / 2, 'NE');
		this.addCorner(CityPlan.OCEAN_X - r, CityPlan.RING_SOUTH - r, 0, 'SE');

		// The bridge, off the coast road on the bridge street
		let start = this.nodeAt(CityPlan.OCEAN_X, CityPlan.BRIDGE_Z);
		let shore = this.nodeAt(-360, CityPlan.BRIDGE_Z, this.bridgeHeight(-360));
		// Level with the island's rim a little before its edge, so there's no lip
		let edge = this.nodeAt(CityPlan.ISLAND_EDGE - 3, CityPlan.BRIDGE_Z, CityPlan.ISLAND_RIM + 0.01);
		let end = this.nodeAt(CityPlan.BRIDGE_END_X, CityPlan.BRIDGE_Z, CityPlan.ISLAND_RIM + 0.01);
		this.addSegment('bridge', start, shore, CityPlan.BRIDGE, { barriers: true });
		this.addSegment('bridge', shore, edge, CityPlan.BRIDGE, { barriers: true, elevated: true });
		this.addSegment('bridge', edge, end, CityPlan.BRIDGE, { barriers: false, elevated: true });

		// Junctions: anywhere three or more roads meet, or two at a right angle
		for (const node of this.nodes)
		{
			if (node.segments.length < 2) continue;

			let widthX = 0;
			let widthZ = 0;
			let crossing = false;
			let directions = new Set<string>();
			for (const id of node.segments)
			{
				let segment = this.segments[id];
				let alongX = Math.abs(segment.b.x - segment.a.x) > Math.abs(segment.b.z - segment.a.z);
				directions.add(alongX ? 'x' : 'z');
				let width = roadWidth(segment);
				if (alongX) widthZ = Math.max(widthZ, width);
				else widthX = Math.max(widthX, width);
			}
			crossing = directions.size > 1 || node.segments.length > 2;
			if (!crossing || node.position.y > CityPlan.GROUND + 0.5) continue;
			if (this.segments[node.segments[0]].kind === 'highway' && node.segments.every((id) => this.segments[id].kind === 'highway')) continue;

			node.junction = true;
			node.halfX = Math.max(widthX, 4) / 2;
			node.halfZ = Math.max(widthZ, 4) / 2;
			// The highway ring isn't signalled where streets run into it; they
			// give way. Everywhere inside the grid gets lights.
			node.signals = node.segments.length >= 3 && node.position.x > CityPlan.RING_WEST + 1
				&& node.position.z > CityPlan.RING_NORTH + 1 && node.position.z < CityPlan.RING_SOUTH - 1;
		}
	}

	/** Quarter circle of highway, centre (cx, cz), from the given angle, in eight pieces. */
	private addCorner(cx: number, cz: number, startAngle: number, name: string): void
	{
		const pieces = 8;
		const r = CityPlan.RING_RADIUS;
		let previous: RoadNode;
		for (let i = 0; i <= pieces; i++)
		{
			let angle = startAngle + (i / pieces) * (Math.PI / 2);
			let node = this.nodeAt(cx + Math.cos(angle) * r, cz + Math.sin(angle) * r);
			if (previous !== undefined)
			{
				let profile = name === 'NE' || name === 'SE' ? CityPlan.HIGHWAY : CityPlan.HIGHWAY;
				this.addSegment('highway', previous, node, profile);
			}
			previous = node;
		}
	}

	/** Height of the viaduct deck above the ground at a point on the north leg. */
	public viaductHeight(x: number): number
	{
		let v = CityPlan.VIADUCT;
		if (x <= v.rampStart || x >= v.rampEnd) return 0;
		if (x < v.top) return v.height * smooth((x - v.rampStart) / (v.top - v.rampStart));
		if (x > v.topEnd) return v.height * smooth((v.rampEnd - x) / (v.rampEnd - v.topEnd));
		return v.height;
	}

	/** The bridge climbs in a straight line from the coast road to the island's rim. */
	public bridgeHeight(x: number): number
	{
		let startX = CityPlan.OCEAN_X + roadWidth(CityPlan.OCEAN) / 2;
		let t = THREE.MathUtils.clamp((x - startX) / (CityPlan.ISLAND_EDGE - 3 - startX), 0, 1);
		return THREE.MathUtils.lerp(CityPlan.GROUND, CityPlan.ISLAND_RIM + 0.01, t);
	}

	// Blocks

	private layBlocks(): void
	{
		const avenues = CityPlan.AVENUES;
		const streets = CityPlan.STREETS;
		let random = mulberry32(90210);

		let columns = [...avenues, CityPlan.RING_WEST];
		let rows = [CityPlan.RING_NORTH, ...streets, CityPlan.RING_SOUTH];

		for (let c = 0; c + 1 < columns.length; c++)
		{
			for (let r = 0; r + 1 < rows.length; r++)
			{
				let eastX = columns[c];
				let westX = columns[c + 1];
				let northZ = rows[r];
				let southZ = rows[r + 1];

				let eastHalf = this.halfWidthAt(eastX, true);
				let westHalf = this.halfWidthAt(westX, true);
				let northHalf = this.halfWidthAt(northZ, false);
				let southHalf = this.halfWidthAt(southZ, false);

				let block: Block = {
					index: this.blocks.length,
					minX: westX + westHalf,
					maxX: eastX - eastHalf,
					minZ: northZ + northHalf,
					maxZ: southZ - southHalf,
					zone: 'midtown',
					seed: Math.floor(random() * 1e9)
				};

				// Blocks the ring's corners cut through aren't built on
				let cornerCut = (c === columns.length - 2 && (r === 0 || r === rows.length - 2))
					|| (c === 0 && (r === 0 || r === rows.length - 2));

				let cx = (block.minX + block.maxX) / 2;
				let cz = (block.minZ + block.maxZ) / 2;
				block.zone = this.zoneFor(cx, cz, r, rows.length, random);
				if (cornerCut) block.zone = 'parking';

				this.blocks.push(block);
			}
		}

		// The park is one block where four were
		let park = CityPlan.PARK;
		this.blocks = this.blocks.filter((b) => !(b.zone === 'park'));
		this.blocks.push({
			index: this.blocks.length,
			minX: park.minX + this.halfWidthAt(park.minX, true),
			maxX: park.maxX - this.halfWidthAt(park.maxX, true),
			minZ: park.minZ + this.halfWidthAt(park.minZ, false),
			maxZ: park.maxZ - this.halfWidthAt(park.maxZ, false),
			zone: 'park',
			seed: 4242
		});
		this.blocks.forEach((block, i) => block.index = i);
	}

	/** Half the width of whatever road runs along a grid line. */
	private halfWidthAt(coordinate: number, isAvenue: boolean): number
	{
		if (isAvenue)
		{
			if (coordinate === CityPlan.RING_WEST) return roadWidth(CityPlan.HIGHWAY) / 2;
			if (coordinate === CityPlan.OCEAN_X) return roadWidth(CityPlan.OCEAN) / 2;
			return roadWidth(CityPlan.AVENUE) / 2;
		}
		if (coordinate === CityPlan.RING_NORTH || coordinate === CityPlan.RING_SOUTH) return roadWidth(CityPlan.HIGHWAY) / 2;
		return roadWidth(CityPlan.STREET) / 2;
	}

	private zoneFor(x: number, z: number, row: number, rows: number, random: () => number): Zone
	{
		let park = CityPlan.PARK;
		if (x > park.minX && x < park.maxX && z > park.minZ && z < park.maxZ) return 'park';

		// Along the north shore, between the first street and the ring
		if (row === 0) return 'harbor';

		let distance = Math.hypot((x - CityPlan.DOWNTOWN.x) * 1.1, z - CityPlan.DOWNTOWN.y);
		if (distance < 150) return 'downtown';
		if (distance < 300) return random() < 0.08 ? 'plaza' : 'midtown';
		if (random() < 0.06) return 'parking';
		return 'residential';
	}

	/** A clockwise circuit of the ring and the coast road, for the race. */
	private layLoop(): void
	{
		const r = CityPlan.RING_RADIUS;
		let points: THREE.Vector3[] = [];
		let lane = CityPlan.HIGHWAY.laneWidth * 1.5 + CityPlan.HIGHWAY.median / 2;

		let push = (x: number, z: number) => points.push(new THREE.Vector3(x, CityPlan.GROUND + this.viaductOrZero(x, z), z));

		// Down the coast road (south), keeping to the right hand lanes
		for (let z = CityPlan.RING_NORTH + r; z <= CityPlan.RING_SOUTH - r; z += 30) push(CityPlan.OCEAN_X - lane, z);
		arc(CityPlan.OCEAN_X - r, CityPlan.RING_SOUTH - r, r - lane, 0, Math.PI / 2, push);
		for (let x = CityPlan.OCEAN_X - r - 30; x >= CityPlan.RING_WEST + r; x -= 30) push(x, CityPlan.RING_SOUTH - lane);
		arc(CityPlan.RING_WEST + r, CityPlan.RING_SOUTH - r, r - lane, Math.PI / 2, Math.PI, push);
		for (let z = CityPlan.RING_SOUTH - r - 30; z >= CityPlan.RING_NORTH + r; z -= 30) push(CityPlan.RING_WEST + lane, z);
		arc(CityPlan.RING_WEST + r, CityPlan.RING_NORTH + r, r - lane, Math.PI, Math.PI * 1.5, push);
		for (let x = CityPlan.RING_WEST + r + 30; x <= CityPlan.OCEAN_X - r; x += 30) push(x, CityPlan.RING_NORTH + lane);
		arc(CityPlan.OCEAN_X - r, CityPlan.RING_NORTH + r, r - lane, -Math.PI / 2, 0, push);

		this.loop = points;
	}

	private viaductOrZero(x: number, z: number): number
	{
		return Math.abs(z - CityPlan.RING_NORTH) < 12 ? this.viaductHeight(x) : 0;
	}
}

function arc(cx: number, cz: number, radius: number, from: number, to: number, push: (x: number, z: number) => void): void
{
	const steps = 6;
	for (let i = 1; i < steps; i++)
	{
		let angle = from + (to - from) * (i / steps);
		push(cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius);
	}
}

function smooth(t: number): number
{
	t = THREE.MathUtils.clamp(t, 0, 1);
	return t * t * (3 - 2 * t);
}
