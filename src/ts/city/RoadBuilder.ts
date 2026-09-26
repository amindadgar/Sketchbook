import * as THREE from 'three';
import { CityPlan, RoadNode, RoadSegment, roadWidth } from './CityPlan';
import { CityContext } from './CityContext';
import { StreetFurniture } from './StreetFurniture';

/** A run of road between junctions, drawn as one continuous strip. */
export interface RoadChain
{
	id: number;
	points: THREE.Vector3[];
	segments: RoadSegment[];
	startNode: RoadNode;
	endNode: RoadNode;
	halfWidth: number;
	kind: RoadSegment['kind'];
}

/** A signal head at a junction, facing traffic that arrives along `travel`. */
export interface SignalHead
{
	node: number;
	/** The axis the traffic it faces is moving along. */
	axis: 'x' | 'z';
	travel: THREE.Vector3;
	lamps: THREE.Vector3[];
}

/**
 * Lays every road in the plan: strips with painted lanes, squares with zebra
 * crossings where they meet, and for the raised ones a deck on pillars with
 * barriers down the sides. Street lights line them and the junctions get
 * signals.
 */
export class RoadBuilder
{
	private static readonly DECK: number = 0.9;
	private static readonly BARRIER_HEIGHT: number = 0.85;
	private static readonly BARRIER_WIDTH: number = 0.32;
	private static readonly SEA_FLOOR: number = 8;

	public chains: RoadChain[] = [];
	public signals: SignalHead[] = [];
	/** Every street light's foot, so nothing else is planted on top of one. */
	public lampSpots: THREE.Vector3[] = [];

	private context: CityContext;
	private plan: CityPlan;

	constructor(context: CityContext, plan: CityPlan)
	{
		this.context = context;
		this.plan = plan;
	}

	public build(): void
	{
		this.makeChains();
		for (const chain of this.chains) this.buildChain(chain);
		for (const node of this.plan.nodes) if (node.junction) this.buildJunction(node);
	}

	// Chains

	private passThrough(node: RoadNode): boolean
	{
		return !node.junction && node.segments.length === 2;
	}

	private makeChains(): void
	{
		let used = new Set<number>();
		let nodes = this.plan.nodes;
		let segments = this.plan.segments;

		let walk = (start: RoadNode, first: RoadSegment) =>
		{
			let chainNodes = [start];
			let chainSegments: RoadSegment[] = [];
			let segment = first;
			let node = start;
			while (true)
			{
				used.add(segment.id);
				chainSegments.push(segment);
				let next = nodes[segment.from === node.id ? segment.to : segment.from];
				chainNodes.push(next);
				node = next;
				if (!this.passThrough(node)) break;
				let onward = node.segments.map((id) => segments[id]).find((s) => s.id !== segment.id);
				if (onward === undefined || used.has(onward.id)) break;
				segment = onward;
			}
			return { nodes: chainNodes, segments: chainSegments };
		};

		for (const node of nodes)
		{
			if (this.passThrough(node)) continue;
			for (const id of node.segments)
			{
				if (used.has(id)) continue;
				let run = walk(node, segments[id]);
				this.chains.push({
					id: this.chains.length,
					points: run.nodes.map((n) => n.position.clone()),
					segments: run.segments,
					startNode: run.nodes[0],
					endNode: run.nodes[run.nodes.length - 1],
					halfWidth: Math.max(...run.segments.map((s) => roadWidth(s))) / 2,
					kind: run.segments[0].kind
				});
			}
		}

		// Trim the ends back to the edge of any junction square
		for (const chain of this.chains)
		{
			this.trim(chain, true);
			this.trim(chain, false);
		}
	}

	private trim(chain: RoadChain, atStart: boolean): void
	{
		let node = atStart ? chain.startNode : chain.endNode;
		if (!node.junction) return;
		let points = chain.points;
		let end = atStart ? points[0] : points[points.length - 1];
		let inner = atStart ? points[1] : points[points.length - 2];
		let direction = new THREE.Vector3(inner.x - end.x, 0, inner.z - end.z).normalize();
		let distance = Math.abs(direction.x) > Math.abs(direction.z) ? node.halfX : node.halfZ;
		end.x += direction.x * distance;
		end.z += direction.z * distance;
		end.y = node.position.y;
	}

	// Surfaces

	private static side(direction: THREE.Vector3): THREE.Vector3
	{
		return new THREE.Vector3(direction.z, 0, -direction.x);
	}

	private buildChain(chain: RoadChain): void
	{
		let points = chain.points;
		let count = points.length;
		let lefts: THREE.Vector3[] = [];
		let rights: THREE.Vector3[] = [];
		let widths: number[] = [];

		for (let i = 0; i < count; i++)
		{
			let before = i > 0 ? chain.segments[i - 1] : chain.segments[0];
			let after = i < count - 1 ? chain.segments[i] : chain.segments[count - 2];
			let halfWidth = Math.max(roadWidth(before), roadWidth(after)) / 2;
			widths.push(halfWidth);

			let dirIn = i > 0 ? new THREE.Vector3(points[i].x - points[i - 1].x, 0, points[i].z - points[i - 1].z).normalize() : undefined;
			let dirOut = i < count - 1 ? new THREE.Vector3(points[i + 1].x - points[i].x, 0, points[i + 1].z - points[i].z).normalize() : undefined;
			let nIn = dirIn !== undefined ? RoadBuilder.side(dirIn) : undefined;
			let nOut = dirOut !== undefined ? RoadBuilder.side(dirOut) : undefined;
			let miter = nIn !== undefined && nOut !== undefined ? nIn.clone().add(nOut).normalize() : (nIn || nOut);
			let stretch = nIn !== undefined && nOut !== undefined ? 1 / Math.max(0.5, miter.dot(nOut)) : 1;
			lefts.push(points[i].clone().add(miter.clone().multiplyScalar(halfWidth * stretch)));
			rights.push(points[i].clone().sub(miter.clone().multiplyScalar(halfWidth * stretch)));
		}

		let along = 0;
		let lampDue = 10;
		let pillarDue = 6;
		for (let i = 0; i < count - 1; i++)
		{
			let segment = chain.segments[i];
			let a = points[i];
			let b = points[i + 1];
			let length = new THREE.Vector2(b.x - a.x, b.z - a.z).length();
			let raised = Math.max(a.y, b.y) > CityPlan.GROUND + 0.3 || segment.elevated;
			let lift = raised ? 0 : 0.01;
			let material = segment.kind === 'highway' || segment.kind === 'bridge' ? this.context.materials.highway : this.context.materials.asphalt;
			let mid = a.clone().lerp(b, 0.5);
			let batch = this.context.batch(material, mid.x, mid.z, { aRoad: 4, aLane: 2 }, raised);
			let road = [segment.lanes, segment.laneWidth, segment.median, segment.parking];
			let wa = widths[i];
			let wb = widths[i + 1];

			let la = lefts[i].clone().setY(a.y + lift);
			let ra = rights[i].clone().setY(a.y + lift);
			let lb = lefts[i + 1].clone().setY(b.y + lift);
			let rb = rights[i + 1].clone().setY(b.y + lift);

			// Textured by where it is in the world; painted by where it is on the road
			batch.quad(ra, rb, lb, la,
				[[ra.x, -ra.z], [rb.x, -rb.z], [lb.x, -lb.z], [la.x, -la.z]],
				{ aRoad: road, aLane: [-wa, along] });
			batch.patchLast('aLane', [[-wa, along], [-wb, along + length], [wb, along + length], [wa, along]]);

			if (raised) this.buildDeck(chain, segment, la, ra, lb, rb, a, b);

			// Street lights, every so often down each side
			if (!raised && segment.kind !== 'highway')
			{
				while (lampDue < along + length)
				{
					let t = (lampDue - along) / length;
					let at = a.clone().lerp(b, t);
					let direction = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
					this.streetLamp(at, direction, THREE.MathUtils.lerp(wa, wb, t), segment.kind);
					lampDue += segment.kind === 'street' ? 30 : 26;
				}
			}
			else if (segment.kind === 'highway' || segment.kind === 'bridge')
			{
				while (lampDue < along + length)
				{
					let t = (lampDue - along) / length;
					let at = a.clone().lerp(b, t);
					let direction = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
					this.medianLamp(at, direction, segment);
					lampDue += 40;
				}
			}

			if (raised)
			{
				while (pillarDue < along + length)
				{
					let t = (pillarDue - along) / length;
					this.pillar(a.clone().lerp(b, t), new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize(), THREE.MathUtils.lerp(wa, wb, t));
					pillarDue += 30;
				}
			}

			along += length;
		}
	}

	/**
	 * Under a raised road: the deck's edges and underside, concrete barriers
	 * along the top, and a collider that's the deck itself, turned to its
	 * slope. Anything only a little off the ground is an embankment instead,
	 * solid down to it.
	 */
	private buildDeck(chain: RoadChain, segment: RoadSegment, la: THREE.Vector3, ra: THREE.Vector3, lb: THREE.Vector3, rb: THREE.Vector3,
		a: THREE.Vector3, b: THREE.Vector3): void
	{
		let m = this.context.materials;
		let mid = a.clone().lerp(b, 0.5);
		let lowest = Math.min(a.y, b.y) - CityPlan.GROUND;
		let embankment = lowest < 2.2 && (a.x < CityPlan.LAND.maxX || b.x < CityPlan.LAND.maxX);
		let depth = embankment ? Math.max(a.y, b.y) - CityPlan.GROUND + 0.2 : RoadBuilder.DECK;
		let concrete = this.context.batch(m.concrete, mid.x, mid.z);

		// Sides and underside
		let down = (p: THREE.Vector3) => p.clone().setY(embankment ? CityPlan.GROUND - 0.2 : p.y - depth);
		concrete.quad(down(la), down(lb), lb, la, [[0, down(la).y], [la.distanceTo(lb), down(lb).y], [la.distanceTo(lb), lb.y], [0, la.y]]);
		concrete.quad(down(rb), down(ra), ra, rb, [[0, down(rb).y], [ra.distanceTo(rb), down(ra).y], [ra.distanceTo(rb), ra.y], [0, rb.y]]);
		if (!embankment) concrete.quad(down(la), down(ra), down(rb), down(lb), [[la.x, la.z], [ra.x, ra.z], [rb.x, rb.z], [lb.x, lb.z]]);

		// The deck as a collider: a box under the surface, turned to it
		let forward = b.clone().sub(a);
		let length = forward.length();
		forward.normalize();
		let right = new THREE.Vector3(0, 1, 0).cross(forward).normalize();
		let up = forward.clone().cross(right).normalize();
		let rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
		let width = la.distanceTo(ra);
		let centre = mid.clone().sub(up.clone().multiplyScalar(depth / 2));
		this.context.collider(centre, new THREE.Vector3(width, depth, length + 0.05), rotation);

		// Barriers down both edges
		if (segment.barriers)
		{
			for (const sideSign of [-1, 1])
			{
				let offset = right.clone().multiplyScalar(sideSign * (width / 2 - RoadBuilder.BARRIER_WIDTH / 2));
				let barrierCentre = mid.clone().add(offset).add(up.clone().multiplyScalar(RoadBuilder.BARRIER_HEIGHT / 2));
				let size = new THREE.Vector3(RoadBuilder.BARRIER_WIDTH, RoadBuilder.BARRIER_HEIGHT, length + 0.05);
				concrete.orientedBox(barrierCentre, size, rotation);
				this.context.collider(barrierCentre, size, rotation);
			}
		}
	}

	/** A column under a raised road, down to the ground or the sea bed. */
	private pillar(at: THREE.Vector3, direction: THREE.Vector3, halfWidth: number): void
	{
		// The last few metres of the bridge lie on the island itself
		if (at.x > CityPlan.ISLAND_EDGE - 2) return;
		let overSea = at.x > CityPlan.LAND.maxX + 2 || at.z < CityPlan.LAND.minZ || at.z > CityPlan.LAND.maxZ;
		let base = overSea ? RoadBuilder.SEA_FLOOR : CityPlan.GROUND;
		let top = at.y - RoadBuilder.DECK;
		if (top - base < 1.5) return;
		let m = this.context.materials;
		let yaw = Math.atan2(direction.x, direction.z);
		let rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
		let concrete = this.context.batch(m.concrete, at.x, at.z);

		let column = new THREE.Vector3(Math.min(halfWidth * 1.1, 6), top - base, 1.3);
		let centre = new THREE.Vector3(at.x, (top + base) / 2, at.z);
		if (halfWidth > 6)
		{
			// Wide decks sit on two columns and a crosshead
			for (const s of [-1, 1])
			{
				let offset = new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar(s * halfWidth * 0.5);
				let c = centre.clone().add(offset);
				concrete.orientedBox(c, new THREE.Vector3(1.4, top - base, 1.4), rotation);
				this.context.collider(c, new THREE.Vector3(1.4, top - base, 1.4), rotation);
			}
			let head = new THREE.Vector3(at.x, top - 0.45, at.z);
			concrete.orientedBox(head, new THREE.Vector3(1.6, 0.9, halfWidth * 1.9), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2));
		}
		else
		{
			concrete.orientedBox(centre, new THREE.Vector3(1.6, top - base, 1.6), rotation);
			this.context.collider(centre, new THREE.Vector3(1.6, top - base, 1.6), rotation);
		}
	}

	private streetLamp(at: THREE.Vector3, direction: THREE.Vector3, halfWidth: number, kind: string): void
	{
		let normal = RoadBuilder.side(direction);
		for (const s of [-1, 1])
		{
			let outward = normal.clone().multiplyScalar(s);
			let position = at.clone().add(outward.clone().multiplyScalar(halfWidth + 0.75));
			position.y = CityPlan.GROUND + CityPlan.CURB;
			if (Math.hypot(position.x - CityPlan.START.x, position.z - CityPlan.START.z) < 5) continue;
			let facing = outward.clone().negate();
			let yaw = Math.atan2(facing.x, facing.z);
			let lamp = this.context.place('lamp', position, yaw);
			this.lampSpots.push(position);

			let pool = position.clone().add(facing.clone().multiplyScalar(StreetFurniture.LAMP_REACH + 0.2));
			pool.y = CityPlan.GROUND + 0.03;
			let light = this.context.place('lightPool', pool, 0, kind === 'street' ? 0.9 : 1.1);

			this.context.breakable(StreetFurniture.lampBreakable(position, yaw, 1, [
				{ ref: lamp, falls: true }, { ref: light, falls: false }]));
		}
	}

	/** A double-headed lamp down the middle of the highway. */
	private medianLamp(at: THREE.Vector3, direction: THREE.Vector3, segment: RoadSegment): void
	{
		let normal = RoadBuilder.side(direction);
		let base = at.clone();
		base.y = at.y + (at.y > CityPlan.GROUND + 0.3 ? 0 : 0.01);
		let instances = [];
		for (const s of [-1, 1])
		{
			let facing = normal.clone().multiplyScalar(s);
			instances.push({ ref: this.context.place('lamp', base, Math.atan2(facing.x, facing.z), 1.15), falls: true });
			let pool = base.clone().add(facing.clone().multiplyScalar((StreetFurniture.LAMP_REACH + 0.2) * 1.15));
			pool.y = base.y + 0.03;
			instances.push({ ref: this.context.place('lightPool', pool, 0, 1.2), falls: false });
		}
		// Arms both ways, so the loose piece has a head at each end
		this.context.breakable(StreetFurniture.lampBreakable(base, Math.atan2(normal.x, normal.z), 1.15, instances, true));
	}

	// Junctions

	private buildJunction(node: RoadNode): void
	{
		let m = this.context.materials;
		let p = node.position;
		let batch = this.context.batch(m.junction, p.x, p.z, { aRoad: 4, aLane: 2 }, false);
		let y = CityPlan.GROUND + 0.012;

		// Which sides roads come in from, for the crossings
		let sides = 0;
		for (const id of node.segments)
		{
			let segment = this.plan.segments[id];
			let other = segment.from === node.id ? segment.b : segment.a;
			let dx = other.x - p.x;
			let dz = other.z - p.z;
			if (Math.abs(dx) > Math.abs(dz)) sides |= dx > 0 ? 1 : 2;
			else sides |= dz > 0 ? 4 : 8;
		}
		let road = [node.halfX, node.halfZ, sides, 0];

		let minX = p.x - node.halfX, maxX = p.x + node.halfX;
		let minZ = p.z - node.halfZ, maxZ = p.z + node.halfZ;
		batch.quad(
			new THREE.Vector3(minX, y, maxZ), new THREE.Vector3(maxX, y, maxZ),
			new THREE.Vector3(maxX, y, minZ), new THREE.Vector3(minX, y, minZ),
			[[minX, -maxZ], [maxX, -maxZ], [maxX, -minZ], [minX, -minZ]],
			{ aRoad: road, aLane: [0, 0] }, new THREE.Vector3(0, 1, 0));
		batch.patchLast('aLane', [[-node.halfX, node.halfZ], [node.halfX, node.halfZ], [node.halfX, -node.halfZ], [-node.halfX, -node.halfZ]]);

		if (node.signals) this.buildSignals(node);
	}

	/** One mast per road coming in, on the near right corner, arm out over its lanes. */
	private buildSignals(node: RoadNode): void
	{
		let p = node.position;
		for (const id of node.segments)
		{
			let segment = this.plan.segments[id];
			let other = segment.from === node.id ? segment.b : segment.a;
			// Traffic on this road arrives travelling from `other` toward the junction
			let travel = new THREE.Vector3(p.x - other.x, 0, p.z - other.z).normalize();
			let right = new THREE.Vector3().crossVectors(travel, new THREE.Vector3(0, 1, 0)).normalize();
			let alongX = Math.abs(travel.x) > Math.abs(travel.z);
			let reach = alongX ? node.halfX : node.halfZ;
			let halfWidth = roadWidth(segment) / 2;

			let position = p.clone()
				.sub(travel.clone().multiplyScalar(reach + 0.4))
				.add(right.clone().multiplyScalar(halfWidth + 0.8));
			position.y = CityPlan.GROUND + CityPlan.CURB;
			let facing = travel.clone().negate();
			let yaw = Math.atan2(facing.x, facing.z);
			let mast = this.context.place('signal', position, yaw);
			let index = this.signals.length;
			this.context.breakable(StreetFurniture.signalBreakable(position, yaw, mast, [index * 3, index * 3 + 1, index * 3 + 2]));

			let rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
			this.signals.push({
				node: node.id,
				axis: alongX ? 'x' : 'z',
				travel: travel,
				lamps: StreetFurniture.SIGNAL_LAMPS.map((l) => l.clone().applyQuaternion(rotation).add(position))
			});
		}
	}
}
