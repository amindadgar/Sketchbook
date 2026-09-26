import * as THREE from 'three';
import { HumanModel } from '../characters/HumanModel';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGLTFLoader } from '../core/Loaders';
import { ISpawnPoint } from '../interfaces/ISpawnPoint';
import { World } from '../world/World';
import { Helicopter } from '../vehicles/Helicopter';
import { Airplane } from '../vehicles/Airplane';
import { Car } from '../vehicles/Car';
import * as Utils from '../core/FunctionLibrary';
import { Vehicle } from '../vehicles/Vehicle';
import { Character } from '../characters/Character';
import { FollowPath } from '../characters/character_ai/FollowPath';
import { LoadingManager } from '../core/LoadingManager';
import { IWorldEntity } from '../interfaces/IWorldEntity';

export class VehicleSpawnPoint implements ISpawnPoint
{
	public type: string;
	public driver: string;
	public firstAINode: string;

	/** For a vehicle added in the middle of a game, where there's no loading screen to go through. */
	private static loader: GLTFLoader = createGLTFLoader();

	private object: THREE.Object3D;

	constructor(object: THREE.Object3D)
	{
		this.object = object;
	}

	/** What the vehicle is known by across a party: the spawn point's name. */
	public get name(): string
	{
		return this.object.name;
	}

	public getWorldPosition(target: THREE.Vector3): THREE.Vector3
	{
		return this.object.getWorldPosition(target);
	}

	public getWorldQuaternion(target: THREE.Quaternion): THREE.Quaternion
	{
		return this.object.getWorldQuaternion(target);
	}

	/**
	 * 'driver' overrides the one the world file gives, for this launch only:
	 * null for an empty car, which is how a party takes over the seats the
	 * computer drivers would otherwise have. Without a loading manager the
	 * model is fetched quietly, for a car turning up mid game.
	 */
	public spawn(loadingManager: LoadingManager, world: World, driver?: string): void
	{
		// Anything arriving after another launch has begun belongs to a world
		// that's gone, and adding it would put two vehicles under one id
		let generation = world.scenarioGeneration;
		let seatedDriver = driver !== undefined ? driver : this.driver;

		let load = (path: string, done: (gltf: any) => void) =>
		{
			if (loadingManager !== undefined) loadingManager.loadGLTF(path, done);
			else VehicleSpawnPoint.loader.load(path, done);
		};

		load('build/assets/' + this.type + '.glb', (model: any) =>
		{
			if (world.scenarioGeneration !== generation) return;

			let vehicle: Vehicle = this.getNewVehicleByType(model, this.type);
			vehicle.spawnPoint = this.object;

			let worldPos = new THREE.Vector3();
			let worldQuat = new THREE.Quaternion();
			this.object.getWorldPosition(worldPos);
			this.object.getWorldQuaternion(worldQuat);

			vehicle.setPosition(worldPos.x, worldPos.y + 1, worldPos.z);
			vehicle.collision.quaternion.copy(Utils.cannonQuat(worldQuat));
			world.add(vehicle);

			if (seatedDriver !== undefined && seatedDriver !== null)
			{
				load(HumanModel.PLAYER, (charModel) =>
				{
					if (world.scenarioGeneration !== generation) return;

					let character = new Character(charModel);
					world.add(character);
					character.teleportToVehicle(vehicle, vehicle.seats[0]);

					if (seatedDriver === 'player')
					{
						character.takeControl();
					}
					else if (seatedDriver === 'ai')
					{
						if (this.firstAINode !== undefined)
						{
							let nodeFound = false;
							for (const pathName in world.paths) {
								if (world.paths.hasOwnProperty(pathName)) {
									const path = world.paths[pathName];
									
									for (const nodeName in path.nodes) {
										if (Object.prototype.hasOwnProperty.call(path.nodes, nodeName)) {
											const node = path.nodes[nodeName];
											
											if (node.object.name === this.firstAINode)
											{
												character.setBehaviour(new FollowPath(node, 10));
												nodeFound = true;
											}
										}
									}
								}
							}

							if (!nodeFound)
							{
								console.error('Path node ' + this.firstAINode + 'not found.');
							}
						}
					}
				});
			}
		});
	}

	private getNewVehicleByType(model: any, type: string): Vehicle
	{
		switch (type)
		{
			case 'car': return new Car(model);
			case 'heli': return new Helicopter(model);
			case 'airplane': return new Airplane(model);
		}
	}
}