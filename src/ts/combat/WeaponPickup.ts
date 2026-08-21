import * as THREE from 'three';

import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { WeaponSpec, buildWeaponModel } from './Weapons';

/**
 * A weapon turning slowly inside a glowing column, the way pickups worked in
 * the older GTA games. Walk into the column and it's yours; the column goes
 * dark and comes back a while later so a spot can't be farmed.
 */
export class WeaponPickup implements IUpdatable
{
	public updateOrder: number = 12;

	private static readonly RADIUS: number = 1.5;
	private static readonly RESPAWN_TIME: number = 20;

	public spec: WeaponSpec;
	public available: boolean = true;
	public position: THREE.Vector3;

	private world: World;
	private group: THREE.Group;
	private model: THREE.Group;
	private column: THREE.Mesh;
	private ring: THREE.Mesh;
	private spin: number = 0;
	private cooldown: number = 0;

	constructor(world: World, spec: WeaponSpec, position: THREE.Vector3)
	{
		this.world = world;
		this.spec = spec;

		this.position = position.clone();
		this.group = new THREE.Group();
		this.group.position.copy(position);

		let color = new THREE.Color(spec.color);

		// Open ended so you can see the gun through it from any angle, and it
		// never writes depth so it can't hide what's behind it
		this.column = new THREE.Mesh(
			new THREE.CylinderGeometry(0.85, 0.85, 1.7, 26, 1, true),
			new THREE.MeshBasicMaterial({
				color: color, transparent: true, opacity: 0.2,
				side: THREE.DoubleSide, depthWrite: false
			})
		);
		this.column.position.y = 0.85;
		this.group.add(this.column);

		this.ring = new THREE.Mesh(
			new THREE.RingGeometry(0.78, 0.95, 32),
			new THREE.MeshBasicMaterial({
				color: color, transparent: true, opacity: 0.55,
				side: THREE.DoubleSide, depthWrite: false
			})
		);
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.position.y = 0.06;
		this.group.add(this.ring);

		this.model = buildWeaponModel(spec);
		this.model.position.y = 0.85;
		this.model.scale.setScalar(1.6);
		this.group.add(this.model);

		this.world.graphicsWorld.add(this.group);
		this.world.registerUpdatable(this);
	}

	public update(timeStep: number): void
	{
		if (!this.available)
		{
			this.cooldown -= timeStep;
			if (this.cooldown <= 0) this.setAvailable(true);
			return;
		}

		this.spin += timeStep;
		this.model.rotation.y = this.spin * 1.4;
		this.model.position.y = 0.85 + Math.sin(this.spin * 2) * 0.07;
		// A slow pulse so it catches the eye from across the map
		(this.column.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(this.spin * 3) * 0.06;
	}

	/** True when the given point is inside the column. */
	public covers(position: THREE.Vector3): boolean
	{
		if (!this.available) return false;

		let dx = position.x - this.group.position.x;
		let dz = position.z - this.group.position.z;
		let dy = position.y - this.group.position.y;

		return (dx * dx + dz * dz) < (WeaponPickup.RADIUS * WeaponPickup.RADIUS) && dy > -2 && dy < 3;
	}

	public consume(): void
	{
		this.setAvailable(false);
		this.cooldown = WeaponPickup.RESPAWN_TIME;
	}

	public dispose(): void
	{
		this.world.unregisterUpdatable(this);
		this.world.graphicsWorld.remove(this.group);
	}

	private setAvailable(value: boolean): void
	{
		this.available = value;
		this.group.visible = value;
	}
}
