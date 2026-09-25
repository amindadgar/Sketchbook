import { ISpawnPoint } from '../interfaces/ISpawnPoint';
import * as THREE from 'three';
import { World } from './World';
import { Character } from '../characters/Character';
import { LoadingManager } from '../core/LoadingManager';
import * as Utils from '../core/FunctionLibrary';
import * as CANNON from 'cannon';
import { CollisionGroups } from '../enums/CollisionGroups';

export class CharacterSpawnPoint implements ISpawnPoint
{
	private object: THREE.Object3D;

	constructor(object: THREE.Object3D)
	{
		this.object = object;
	}
	
	public spawn(loadingManager: LoadingManager, world: World): void
	{
		// A download that lands after another launch has begun is for a world
		// that has already gone
		let generation = world.scenarioGeneration;

		loadingManager.loadGLTF('build/assets/boxman.glb', (model) =>
		{
			if (world.scenarioGeneration !== generation) return;

			let player = new Character(model);
			
			let worldPos = new THREE.Vector3();
			this.object.getWorldPosition(worldPos);
			if (world.party !== undefined && world.party.active) this.spreadOut(worldPos, world);
			player.setPosition(worldPos.x, worldPos.y, worldPos.z);
			
			let forward = Utils.getForward(this.object);
			player.setOrientation(forward, true);
			
			world.add(player);
			player.takeControl();
		});
	}

	/**
	 * A scenario has one spawn point and a party would stand inside each other
	 * on it, so each player is stepped a little way off it, in a direction of
	 * their own. Only onto ground at about the same height with nothing in the
	 * way, since a spawn point is placed where it is for a reason.
	 */
	private spreadOut(position: THREE.Vector3, world: World): void
	{
		const radius = 1.5;
		// Golden angle apart, so consecutive ids never land on top of each other
		let angle = world.party.client.id * 2.39996;
		let candidate = new THREE.Vector3(
			position.x + Math.cos(angle) * radius,
			position.y,
			position.z + Math.sin(angle) * radius);

		let options = { collisionFilterMask: ~CollisionGroups.Characters, skipBackfaces: true };

		// Clear line from the spawn point to the spot
		let clear = new CANNON.RaycastResult();
		world.physicsWorld.raycastClosest(Utils.cannonVector(position), Utils.cannonVector(candidate), options, clear);
		if (clear.hasHit) return;

		let below = (point: THREE.Vector3): number =>
		{
			let result = new CANNON.RaycastResult();
			world.physicsWorld.raycastClosest(
				new CANNON.Vec3(point.x, point.y + 2, point.z),
				new CANNON.Vec3(point.x, point.y - 3, point.z),
				options, result);
			return result.hasHit ? result.hitPointWorld.y : undefined;
		};

		let groundHere = below(position);
		let groundThere = below(candidate);
		if (groundHere === undefined || groundThere === undefined) return;
		if (Math.abs(groundThere - groundHere) > 1.5) return;

		position.set(candidate.x, groundThere + (position.y - groundHere), candidate.z);
	}
}