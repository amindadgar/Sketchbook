import * as THREE from 'three';
import { City } from '../city/City';
import { CityPlan, RoadNode } from '../city/CityPlan';
import { RoadChain } from '../city/RoadBuilder';

/** A path something can follow: points, and how far along each is. */
export class Route
{
	public id: number;
	public points: THREE.Vector3[];
	public lengths: number[] = [0];
	public length: number;

	constructor(id: number, points: THREE.Vector3[])
	{
		this.id = id;
		this.points = points;
		for (let i = 1; i < points.length; i++)
		{
			this.lengths.push(this.lengths[i - 1] + points[i].distanceTo(points[i - 1]));
		}
		this.length = this.lengths[this.lengths.length - 1];
	}

	/** Position and heading at a distance along the route. */
	public sample(distance: number, position: THREE.Vector3, direction?: THREE.Vector3): THREE.Vector3
	{
		let d = THREE.MathUtils.clamp(distance, 0, this.length);
		let i = 1;
		while (i < this.lengths.length - 1 && this.lengths[i] < d) i++;
		let a = this.points[i - 1];
		let b = this.points[i];
		let span = this.lengths[i] - this.lengths[i - 1];
		let t = span > 0 ? (d - this.lengths[i - 1]) / span : 0;
		position.copy(a).lerp(b, t);
		if (direction !== undefined) direction.subVectors(b, a).setY(0).normalize();
		return position;
	}
}

/** One lane of one road, one way, with where it can lead. */
export class Lane extends Route
{
	public next: Lane[] = [];
	/** Junction at the far end, if any, and the axis traffic arrives along. */
	public endNode: RoadNode;
	public axis: 'x' | 'z';
	public speed: number;
	/** A curve across a junction rather than a stretch of road. */
	public turn: boolean = false;
	/** Whether the lane after this one is across a junction with lights. */
	public signalled: boolean = false;
	/** Joins a bigger road without lights, so it stops and looks first. */
	public giveWay: boolean = false;
}

/** A loop of pavement round a block, and crossings off its corners. */
export class Walk extends Route
{
	/** Crossings starting at each corner of the loop, by corner index. */
	public crossings: { [corner: number]: Crossing[] } = {};
	/** Distance along the loop of each corner. */
	public corners: number[] = [];
}

export class Crossing extends Route
{
	public to: Walk;
	public toCorner: number;
	/** Where on the walk it arrives, when that isn't a corner: a driver's dash for the pavement. */
	public toDistance: number;
	/** The junction it crosses at, and which way the traffic it crosses moves. */
	public node: RoadNode;
	public trafficAxis: 'x' | 'z';
}

/**
 * Where the city's people and cars can go, worked out from the roads and
 * blocks: a loop of pavement round every block with crossings between them at
 * the junctions, and every lane of every road with the turns that join them.
 */
export class Navigation
{
	/** In from the kerb that people walk, clear of the trees and lamps and short of the buildings. */
	private static readonly WALK_INSET: number = 2.05;

	public lanes: Lane[] = [];
	public walks: Walk[] = [];

	private city: City;
	private routeId: number = 0;

	constructor(city: City)
	{
		this.city = city;
		this.buildLanes();
		this.buildWalks();
	}

	// Traffic

	private buildLanes(): void
	{
		let chains = this.city.roads.chains.filter((chain) => chain.kind !== 'bridge');
		let ends: { lane: Lane, node: RoadNode, chain: RoadChain }[] = [];
		let starts: { lane: Lane, node: RoadNode, chain: RoadChain }[] = [];

		for (const chain of chains)
		{
			let segment = chain.segments[0];
			for (const forward of [true, false])
			{
				let points = forward ? chain.points : chain.points.slice().reverse();
				let startNode = forward ? chain.startNode : chain.endNode;
				let endNode = forward ? chain.endNode : chain.startNode;

				for (let k = 0; k < segment.lanes; k++)
				{
					let offset = segment.median / 2 + (k + 0.5) * segment.laneWidth;
					let lanePoints = Navigation.offsetLine(points, offset, 0.05);
					let lane = new Lane(this.routeId++, lanePoints);
					lane.endNode = endNode;
					let last = lanePoints[lanePoints.length - 1];
					let before = lanePoints[lanePoints.length - 2];
					lane.axis = Math.abs(last.x - before.x) > Math.abs(last.z - before.z) ? 'x' : 'z';
					lane.speed = chain.kind === 'highway' ? 15 : chain.kind === 'street' ? 7.5 : 9.5;
					lane.signalled = endNode.signals;
					(lane as any).index = k;
					(lane as any).lanes = segment.lanes;
					(lane as any).chain = chain;
					this.lanes.push(lane);
					ends.push({ lane: lane, node: endNode, chain: chain });
					starts.push({ lane: lane, node: startNode, chain: chain });
				}
			}
		}

		// Joins: at each node, from every lane arriving to the lanes leaving by other roads
		let startsAt = new Map<number, { lane: Lane, chain: RoadChain }[]>();
		for (const s of starts)
		{
			if (!startsAt.has(s.node.id)) startsAt.set(s.node.id, []);
			startsAt.get(s.node.id).push(s);
		}

		for (const end of ends)
		{
			let options = startsAt.get(end.node.id) || [];
			let incoming = end.lane;
			let inDirection = Navigation.endDirection(incoming.points);
			let index = (incoming as any).index;
			let lanes = (incoming as any).lanes;

			for (const option of options)
			{
				if (option.chain === end.chain) continue;
				let outgoing = option.lane;
				let outDirection = Navigation.startDirection(outgoing.points);
				let cross = inDirection.x * outDirection.z - inDirection.z * outDirection.x;
				let dot = inDirection.dot(outDirection);
				let kind = dot > 0.8 ? 'straight' : cross > 0 ? 'right' : 'left';
				let outIndex = (outgoing as any).index;
				let outLanes = (outgoing as any).lanes;

				// Lane 0 is the one next to the centre line. Straight on keeps its
				// lane; right turns go kerb lane to kerb lane, left turns inside
				// lane to inside lane
				let fits = kind === 'straight'
					? Math.min(index, outLanes - 1) === outIndex
					: kind === 'right'
						? index === lanes - 1 && outIndex === outLanes - 1
						: index === 0 && outIndex === 0;
				if (!fits) continue;

				let a = incoming.points[incoming.points.length - 1];
				let b = outgoing.points[0];
				let turn = new Lane(this.routeId++, Navigation.curve(a, inDirection, b, outDirection));
				turn.turn = true;
				turn.speed = kind === 'straight' ? incoming.speed : 5;
				turn.endNode = undefined;
				turn.axis = incoming.axis;
				turn.next = [outgoing];
				incoming.next.push(turn);
				this.lanes.push(turn);
			}

			// A street running into the ring or the coast road has no lights there
			if (!end.node.signals && end.node.junction && end.chain.kind === 'street')
			{
				incoming.giveWay = true;
			}
		}

		// Dead ends turn round, so nobody drives off the end of the world
		for (const end of ends)
		{
			if (end.lane.next.length > 0) continue;
			let back = this.lanes.find((l) => !l.turn && (l as any).chain === end.chain && l !== end.lane
				&& l.points[0].distanceTo(end.lane.points[end.lane.points.length - 1]) < 14);
			if (back !== undefined) end.lane.next.push(back);
		}
	}

	private static startDirection(points: THREE.Vector3[]): THREE.Vector3
	{
		return new THREE.Vector3().subVectors(points[1], points[0]).setY(0).normalize();
	}

	private static endDirection(points: THREE.Vector3[]): THREE.Vector3
	{
		let n = points.length;
		return new THREE.Vector3().subVectors(points[n - 1], points[n - 2]).setY(0).normalize();
	}

	/** A line moved sideways by an offset to the right of its direction, mitred at the bends. */
	public static offsetLine(points: THREE.Vector3[], offset: number, lift: number): THREE.Vector3[]
	{
		let result: THREE.Vector3[] = [];
		for (let i = 0; i < points.length; i++)
		{
			let dirIn = i > 0 ? new THREE.Vector3().subVectors(points[i], points[i - 1]).setY(0).normalize() : undefined;
			let dirOut = i < points.length - 1 ? new THREE.Vector3().subVectors(points[i + 1], points[i]).setY(0).normalize() : undefined;
			let right = (d: THREE.Vector3) => new THREE.Vector3(-d.z, 0, d.x);
			let normal: THREE.Vector3;
			let stretch = 1;
			if (dirIn !== undefined && dirOut !== undefined)
			{
				normal = right(dirIn).add(right(dirOut)).normalize();
				stretch = 1 / Math.max(0.5, normal.dot(right(dirOut)));
			}
			else normal = right(dirIn || dirOut);
			let p = points[i].clone().add(normal.multiplyScalar(offset * stretch));
			p.y += lift;
			result.push(p);
		}
		return result;
	}

	/** Across a junction: a curve leaving along one direction and arriving along another. */
	private static curve(a: THREE.Vector3, aDir: THREE.Vector3, b: THREE.Vector3, bDir: THREE.Vector3): THREE.Vector3[]
	{
		let gap = a.distanceTo(b);
		let c1 = a.clone().add(aDir.clone().multiplyScalar(gap * 0.4));
		let c2 = b.clone().sub(bDir.clone().multiplyScalar(gap * 0.4));
		let curve = new THREE.CubicBezierCurve3(a, c1, c2, b);
		return curve.getPoints(8);
	}

	// Pedestrians

	private buildWalks(): void
	{
		let walkways = this.city.blocks.walkways;
		let blocks = this.city.plan.blocks.filter((b) => b.zone !== 'harbor');
		let inset = Navigation.WALK_INSET;
		let top = CityPlan.GROUND + CityPlan.CURB + 0.02;

		for (const block of blocks)
		{
			// Only blocks that got a pavement: the scraps inside highway bends didn't
			let paved = walkways.some((w) => Math.abs(w.minX - block.minX) < 0.01 && Math.abs(w.minZ - block.minZ) < 0.01);
			if (!paved) continue;

			// Clockwise from the north west corner, seen from above
			let corners = [
				new THREE.Vector3(block.minX + inset, top, block.minZ + inset),
				new THREE.Vector3(block.maxX - inset, top, block.minZ + inset),
				new THREE.Vector3(block.maxX - inset, top, block.maxZ - inset),
				new THREE.Vector3(block.minX + inset, top, block.maxZ - inset),
			];
			let walk = new Walk(this.routeId++, corners.concat([corners[0].clone()]));
			walk.corners = [0, 1, 2, 3].map((i) => walk.lengths[i]);
			(walk as any).block = block;
			this.walks.push(walk);
		}

		// Crossings: from each corner to the facing corner of the block across
		// each road, where there's a junction between them
		for (const walk of this.walks)
		{
			for (let c = 0; c < 4; c++)
			{
				let from = walk.points[c];
				walk.crossings[c] = [];
				for (const other of this.walks)
				{
					if (other === walk) continue;
					for (let oc = 0; oc < 4; oc++)
					{
						let to = other.points[oc];
						let dx = Math.abs(to.x - from.x);
						let dz = Math.abs(to.z - from.z);
						// Straight across one road, nothing diagonal and nothing far
						// Nobody walks across the highway
						let acrossX = dz < 0.5 && dx > 4 && dx < 19;
						let acrossZ = dx < 0.5 && dz > 4 && dz < 19;
						if (!acrossX && !acrossZ) continue;

						let node = this.junctionBetween(from, to);
						if (node === undefined) continue;
						let crossing = new Crossing(this.routeId++, [from.clone(), from.clone().setY(CityPlan.GROUND + 0.03), to.clone().setY(CityPlan.GROUND + 0.03), to.clone()]);
						crossing.to = other;
						crossing.toCorner = oc;
						crossing.node = node;
						// Walking along x crosses a road whose traffic runs along z
						crossing.trafficAxis = acrossX ? 'z' : 'x';
						walk.crossings[c].push(crossing);
					}
				}
			}
		}
	}

	private junctionBetween(a: THREE.Vector3, b: THREE.Vector3): RoadNode
	{
		let mid = a.clone().lerp(b, 0.5);
		let best: RoadNode;
		let distance = 30;
		for (const node of this.city.plan.nodes)
		{
			if (!node.junction) continue;
			let d = Math.hypot(node.position.x - mid.x, node.position.z - mid.z);
			if (d < distance)
			{
				distance = d;
				best = node;
			}
		}
		return best;
	}
}
