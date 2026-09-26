import * as THREE from 'three';
import * as CANNON from 'cannon';
import { World } from '../world/World';
import { CityContext, Breakable } from './CityContext';
import { CollisionGroups } from '../enums/CollisionGroups';

interface Debris
{
	body: CANNON.Body;
	object: THREE.Object3D;
	age: number;
}

/**
 * Street lights, signal masts and pavement clutter that a car snaps off
 * instead of stopping dead against.
 *
 * Each one stands in the physics world as a solid box, so people walk round
 * it and a car creeping into it just stops. After every physics step, each
 * moving car looks at what it's about to reach before the next one: anything
 * it's going fast enough to knock over has its box taken out before the two
 * can collide, the car loses a little speed, and a loose copy falls over. On
 * everyone else's screen it falls too, and a while later, once nobody's
 * looking, it's quietly put back.
 */
export class Breakables
{
	private static readonly CELL: number = 12;
	private static readonly DEBRIS_LIFE: number = 45;
	private static readonly MAX_DEBRIS: number = 18;
	/** How long something stays knocked down, at the least. */
	private static readonly RESTORE_AFTER: number = 100;
	/** And how far off everyone has to be before it's put back. */
	private static readonly RESTORE_DISTANCE: number = 150;

	private world: World;
	private context: CityContext;
	private grid: Map<string, Breakable[]> = new Map();
	private broken: Breakable[] = [];
	private debris: Debris[] = [];
	private bounds: WeakMap<CANNON.Body, { min: CANNON.Vec3, max: CANNON.Vec3, radius: number }> = new WeakMap();
	private material: CANNON.Material;
	private onLenses: (lenses: number[], hidden: boolean) => void;

	private static toLocal: CANNON.Vec3 = new CANNON.Vec3();
	private static localVelocity: CANNON.Vec3 = new CANNON.Vec3();
	private static inverse: CANNON.Quaternion = new CANNON.Quaternion();

	constructor(world: World, context: CityContext, onLenses: (lenses: number[], hidden: boolean) => void)
	{
		this.world = world;
		this.context = context;
		this.onLenses = onLenses;
		this.material = new CANNON.Material('debris');
		this.material.friction = 0.4;

		for (const breakable of context.breakables)
		{
			let key = Breakables.cellOf(breakable.position.x, breakable.position.z);
			if (!this.grid.has(key)) this.grid.set(key, []);
			this.grid.get(key).push(breakable);
		}

		world.physicsWorld.addEventListener('postStep', () => this.afterStep());
	}

	private static cellOf(x: number, z: number): string
	{
		return Math.floor(x / Breakables.CELL) + ',' + Math.floor(z / Breakables.CELL);
	}

	/** Knocked over on somebody else's screen. */
	public knockRemote(id: number, velocity: THREE.Vector3): void
	{
		let breakable = this.context.breakables[id];
		if (breakable === undefined || breakable.broken) return;
		this.knock(breakable, velocity, false);
	}

	public update(timeStep: number): void
	{
		for (const piece of this.debris.slice())
		{
			piece.age += timeStep;
			piece.object.position.set(piece.body.interpolatedPosition.x, piece.body.interpolatedPosition.y, piece.body.interpolatedPosition.z);
			piece.object.quaternion.set(piece.body.interpolatedQuaternion.x, piece.body.interpolatedQuaternion.y,
				piece.body.interpolatedQuaternion.z, piece.body.interpolatedQuaternion.w);
			if (piece.age > Breakables.DEBRIS_LIFE || piece.body.position.y < this.world.worldBounds.waterLevel - 6) this.removeDebris(piece);
		}

		if (this.broken.length === 0) return;
		let now = performance.now() / 1000;
		let camera = this.world.camera.position;
		for (const breakable of this.broken.slice())
		{
			if (now - breakable.brokenAt < Breakables.RESTORE_AFTER) continue;
			if (camera.distanceTo(breakable.position) < Breakables.RESTORE_DISTANCE) continue;
			if (this.world.characters.some((c) => c.getWorldPosition(new THREE.Vector3()).distanceTo(breakable.position) < Breakables.RESTORE_DISTANCE)) continue;
			// Nor while a car left parked on the spot would end up with it inside
			if (this.vehicleOver(breakable)) continue;
			this.restore(breakable);
		}
	}

	private vehicleOver(breakable: Breakable): boolean
	{
		let reach = Math.max(breakable.size.x, breakable.size.z) / 2 + 0.5;
		return (this.world.vehicles as any[]).some((vehicle) =>
		{
			let body: CANNON.Body = vehicle.collision;
			if (body === undefined || body.world === null) return false;
			let dx = body.position.x - breakable.position.x;
			let dz = body.position.z - breakable.position.z;
			let r = this.boundsOf(body).radius + reach;
			return dx * dx + dz * dz < r * r;
		});
	}

	// Hitting things

	/** After each physics step: whatever each moving car is about to hit, and whether it goes over. */
	private afterStep(): void
	{
		let dt = this.world.physicsWorld.dt || 1 / 60;
		for (const vehicle of this.world.vehicles as any[])
		{
			let body: CANNON.Body = vehicle.collision;
			if (body === undefined || body.world === null) continue;
			let speed = body.velocity.length();
			if (speed < 1.5) continue;

			let bounds = this.boundsOf(body);
			let reach = bounds.radius + speed * dt * 2 + 0.8;
			let p = body.position;
			let x0 = Math.floor((p.x - reach) / Breakables.CELL), x1 = Math.floor((p.x + reach) / Breakables.CELL);
			let z0 = Math.floor((p.z - reach) / Breakables.CELL), z1 = Math.floor((p.z + reach) / Breakables.CELL);

			for (let cx = x0; cx <= x1; cx++)
			{
				for (let cz = z0; cz <= z1; cz++)
				{
					let list = this.grid.get(cx + ',' + cz);
					if (list === undefined) continue;
					for (const breakable of list)
					{
						if (breakable.broken || speed < breakable.strength) continue;
						if (!this.aboutToHit(body, bounds, breakable, dt)) continue;

						// Knocked over here whoever is driving, so this copy isn't stopped
						// by it, but only told to everyone by the client driving the car
						let velocity = new THREE.Vector3(body.velocity.x, body.velocity.y, body.velocity.z);
						let ours = vehicle.controllingCharacter !== undefined
							? vehicle.controllingCharacter === this.world.localCharacter
							: !vehicle.isRemoteDriven();
						this.knock(breakable, velocity, ours);
						body.velocity.scale(breakable.keep, body.velocity);
						speed = body.velocity.length();
					}
				}
			}
		}
	}

	/**
	 * Whether the car's box, carried on a step and a half at the speed it's
	 * going, reaches the thing's box. In the car's own frame, so a car at an
	 * angle doesn't clip what it's only passing.
	 */
	private aboutToHit(body: CANNON.Body, bounds: { min: CANNON.Vec3, max: CANNON.Vec3 }, breakable: Breakable, dt: number): boolean
	{
		let p = body.position;
		let bottom = breakable.position.y;
		let top = bottom + breakable.size.y;
		if (top < p.y + bounds.min.y - 0.2 || bottom > p.y + bounds.max.y + 0.2) return false;

		let dx = breakable.position.x - p.x;
		let dz = breakable.position.z - p.z;
		// Only what's ahead of the way it's moving, reversing included
		if (dx * body.velocity.x + dz * body.velocity.z <= 0) return false;

		body.quaternion.conjugate(Breakables.inverse);
		let local = Breakables.inverse.vmult(new CANNON.Vec3(dx, 0, dz), Breakables.toLocal);
		let velocity = Breakables.inverse.vmult(body.velocity, Breakables.localVelocity);

		let radius = Math.max(breakable.size.x, breakable.size.z) / 2;
		let ahead = dt * 1.5;
		let mx = Math.abs(velocity.x) * ahead + radius + 0.05;
		let mz = Math.abs(velocity.z) * ahead + radius + 0.05;
		return local.x > bounds.min.x - mx && local.x < bounds.max.x + mx
			&& local.z > bounds.min.z - mz && local.z < bounds.max.z + mz;
	}

	/** The car's boxes, as one box in its own frame. */
	private boundsOf(body: CANNON.Body): { min: CANNON.Vec3, max: CANNON.Vec3, radius: number }
	{
		let known = this.bounds.get(body);
		if (known !== undefined) return known;

		let min = new CANNON.Vec3(Infinity, Infinity, Infinity);
		let max = new CANNON.Vec3(-Infinity, -Infinity, -Infinity);
		body.shapes.forEach((shape: any, i) =>
		{
			if (shape.halfExtents === undefined) return;
			let offset = body.shapeOffsets[i];
			let half = shape.halfExtents;
			min.set(Math.min(min.x, offset.x - half.x), Math.min(min.y, offset.y - half.y), Math.min(min.z, offset.z - half.z));
			max.set(Math.max(max.x, offset.x + half.x), Math.max(max.y, offset.y + half.y), Math.max(max.z, offset.z + half.z));
		});
		if (min.x === Infinity)
		{
			min.set(-0.6, -0.4, -1.2);
			max.set(0.6, 0.4, 1.2);
		}
		let radius = Math.max(-min.x, max.x, -min.z, max.z);
		let result = { min: min, max: max, radius: radius };
		this.bounds.set(body, result);
		return result;
	}

	/** Takes it out of the world and drops a loose copy where it stood. */
	private knock(breakable: Breakable, velocity: THREE.Vector3, local: boolean): void
	{
		breakable.broken = true;
		breakable.brokenAt = performance.now() / 1000;
		this.broken.push(breakable);

		this.context.setBreakableSolid(breakable, false);
		for (const instance of breakable.instances) this.context.setInstanceHidden(instance.ref, true);
		if (breakable.lenses !== undefined) this.onLenses(breakable.lenses, true);

		this.dropPiece(breakable, velocity);

		let strength = Math.min(1, velocity.length() / 20);
		this.world.sfx.thud(breakable.position.clone().setY(breakable.position.y + 0.8), 0.35 + strength * 0.5);

		if (local && this.world.party !== undefined) this.world.party.sendBreak(breakable.id, velocity);
	}

	private restore(breakable: Breakable): void
	{
		breakable.broken = false;
		this.broken.splice(this.broken.indexOf(breakable), 1);
		this.context.setBreakableSolid(breakable, true);
		for (const instance of breakable.instances) this.context.setInstanceHidden(instance.ref, false);
		if (breakable.lenses !== undefined) this.onLenses(breakable.lenses, false);
	}

	// The loose piece

	private dropPiece(breakable: Breakable, velocity: THREE.Vector3): void
	{
		let yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), breakable.yaw);
		let base = new THREE.Matrix4().compose(breakable.position, yaw, new THREE.Vector3(1, 1, 1));
		let toBase = base.clone().invert();

		// What it looks like: the same parts it was drawn with, relative to its base
		let shape = new THREE.Group();
		let box = new THREE.Box3();
		for (const instance of breakable.instances)
		{
			if (!instance.falls) continue;
			let placed = new THREE.Matrix4().multiplyMatrices(toBase, instance.ref.matrix);
			for (const part of this.context.partsOf(instance.ref.kind))
			{
				let mesh = new THREE.Mesh(part.geometry, part.material);
				mesh.matrixAutoUpdate = false;
				mesh.matrix.copy(placed);
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				shape.add(mesh);

				if (part.geometry.boundingBox === null) part.geometry.computeBoundingBox();
				box.union(part.geometry.boundingBox.clone().applyMatrix4(placed));
			}
		}
		// Props from the file still loading aren't drawn yet, so there's nothing to drop
		if (shape.children.length === 0) return;

		let pieces = breakable.pieces;
		if (breakable.fit === true && !box.isEmpty())
		{
			let size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.1, 0.1, 0.1));
			pieces = [{ center: box.getCenter(new THREE.Vector3()), size: size }];
		}

		// A pole has its foot knocked out from under it and its top comes back
		// over the car; anything small is just punted along ahead of it. Both
		// start leaning, so nothing stands there balanced on its flat end
		let flat = new THREE.Vector3(velocity.x, 0, velocity.z);
		let speed = flat.length();
		if (speed < 0.5)
		{
			flat.set(Math.cos(breakable.id), 0, Math.sin(breakable.id));
			speed = 3;
		}
		let direction = flat.clone().normalize();
		let tall = breakable.size.y > 2;
		let falls = tall ? direction.clone().negate() : direction;
		let axis = new THREE.Vector3(0, 1, 0).cross(falls).normalize();
		let rotation = new THREE.Quaternion().setFromAxisAngle(axis, 0.25).multiply(yaw);

		// Turning about the middle of its main piece, and set down so its foot
		// stays where it stood
		let centre = pieces[0].center.clone();
		let body = new CANNON.Body({ mass: breakable.mass });
		body.material = this.material;
		for (const piece of pieces)
		{
			let box = new CANNON.Box(new CANNON.Vec3(piece.size.x / 2, piece.size.y / 2, piece.size.z / 2));
			box.collisionFilterGroup = CollisionGroups.Default;
			box.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
			body.addShape(box, new CANNON.Vec3(piece.center.x - centre.x, piece.center.y - centre.y, piece.center.z - centre.z));
		}
		let start = centre.clone().applyQuaternion(rotation).add(breakable.position);
		body.position.set(start.x, start.y + 0.03, start.z);
		body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
		// Where it was a moment ago too, or the first frame is drawn blended
		// from the middle of the world
		body.previousPosition.copy(body.position);
		(body as any).previousQuaternion.copy(body.quaternion);
		body.interpolatedPosition.copy(body.position);
		body.interpolatedQuaternion.copy(body.quaternion);
		body.linearDamping = 0.05;
		body.angularDamping = 0.15;

		let carried = tall ? 0.75 : 1.05;
		body.velocity.set(direction.x * speed * carried, tall ? 1.5 : 2.2, direction.z * speed * carried);
		let spin = axis.multiplyScalar(Math.min(tall ? 6 : 9, 2 + speed * 0.3));
		body.angularVelocity.set(spin.x, Math.sin(breakable.id * 7.1) * 0.6, spin.z);

		let object = new THREE.Group();
		object.name = 'debris';
		shape.position.set(-centre.x, -centre.y, -centre.z);
		object.add(shape);
		object.position.copy(start);
		object.quaternion.copy(rotation);

		this.world.graphicsWorld.add(object);
		this.world.physicsWorld.addBody(body);
		this.debris.push({ body: body, object: object, age: 0 });

		while (this.debris.length > Breakables.MAX_DEBRIS) this.removeDebris(this.debris[0]);
	}

	private removeDebris(piece: Debris): void
	{
		this.world.graphicsWorld.remove(piece.object);
		this.world.physicsWorld.remove(piece.body);
		this.debris.splice(this.debris.indexOf(piece), 1);
	}
}
