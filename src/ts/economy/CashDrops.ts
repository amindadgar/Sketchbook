import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Wallet } from '../progress/Wallet';

interface Drop
{
	amount: number;
	object: THREE.Object3D;
	position: THREE.Vector3;
	age: number;
	/** How long it lies there before it's gone. */
	life: number;
	/** Given out by the relay, for a drop everyone in a party can see and only one can take. */
	networkId?: number;
	/** Asked the relay for it and waiting to hear, for this long. */
	claimed?: number;
	onTaken?: () => void;
	reason: string;
}

/**
 * Money lying on the ground: a mugged pedestrian's wallet, a cash bag out of
 * a security van, what a player dropped when they died. Walk over it, or
 * drive over it, and it's yours.
 *
 * A drop made on this screen is this screen's. A dead player's is the
 * party's: the relay numbers it and tells everyone where it is, and whoever
 * asks for it first gets it, the relay deciding, so two players can't both
 * pick up the same money.
 */
export class CashDrops implements IUpdatable
{
	public updateOrder: number = 21;

	private static geometry: THREE.BufferGeometry;
	private static material: THREE.MeshStandardMaterial;
	private static glowMaterial: THREE.SpriteMaterial;

	private world: World;
	private drops: Drop[] = [];
	private time: number = 0;
	private generation: number;

	constructor(world: World)
	{
		this.world = world;
		world.registerUpdatable(this);
	}

	/** Money on the ground here, for this player alone. What comes back can take it away again. */
	public drop(position: THREE.Vector3, amount: number, reason: string, life: number = 60, onTaken?: () => void): object
	{
		return this.add(position, amount, reason, life, undefined, onTaken);
	}

	/** Gone, if it's still there: a job's loot once the job is over. */
	public take(handle: object): void
	{
		let drop = this.drops.find((d) => d === handle);
		if (drop !== undefined) this.remove(drop);
	}

	/** A drop the relay has told everyone about. */
	public networkDrop(id: number, position: THREE.Vector3, amount: number): void
	{
		if (this.drops.some((d) => d.networkId === id)) return;
		this.add(position, amount, 'dropped by a player', 90, id);
	}

	/** The relay says somebody got it. The money's theirs if they're us. */
	public networkTaken(id: number, byMe: boolean): void
	{
		let drop = this.drops.find((d) => d.networkId === id);
		if (drop === undefined) return;
		if (byMe) this.world.wallet.add(drop.amount, 'picked up');
		this.remove(drop);
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		this.time += unscaledTimeStep;

		// A relaunch clears the streets
		if (this.generation !== this.world.scenarioGeneration)
		{
			this.generation = this.world.scenarioGeneration;
			this.clear();
		}

		let character = this.world.localCharacter;
		let here = character !== undefined && character.health > 0 ? character.getWorldPosition(new THREE.Vector3()) : undefined;
		let reach = character !== undefined && character.isBusyWithVehicle() ? 2.2 : 1.2;

		for (const drop of this.drops.slice())
		{
			drop.age += timeStep;
			// Turning, and bobbing, so it can be seen from a car
			drop.object.rotation.y = this.time * 2 + drop.position.x;
			drop.object.position.y = drop.position.y + 0.12 + Math.sin(this.time * 3 + drop.position.z) * 0.04;

			// The party's money goes with the party
			if (drop.networkId !== undefined && !this.world.party.active)
			{
				this.remove(drop);
				continue;
			}
			if (drop.claimed !== undefined)
			{
				// No answer: ask again next time it's walked over
				drop.claimed += unscaledTimeStep;
				if (drop.claimed > 4) drop.claimed = undefined;
				continue;
			}
			if (drop.age > drop.life)
			{
				this.remove(drop);
				continue;
			}
			if (here === undefined) continue;
			let dx = here.x - drop.position.x;
			let dz = here.z - drop.position.z;
			if (dx * dx + dz * dz > reach * reach || Math.abs(here.y - drop.position.y) > 2) continue;

			if (drop.networkId !== undefined)
			{
				// Ask; the relay says who got it
				drop.claimed = 0;
				this.world.party.sendTake(drop.networkId);
				continue;
			}
			this.world.wallet.add(drop.amount, drop.reason);
			if (drop.onTaken !== undefined) drop.onTaken();
			this.remove(drop);
		}
	}

	/** Everything on the ground, gone: for a relaunch. */
	public clear(): void
	{
		for (const drop of this.drops.slice()) this.remove(drop);
	}

	private add(position: THREE.Vector3, amount: number, reason: string, life: number, networkId?: number, onTaken?: () => void): Drop
	{
		amount = Math.round(amount);
		if (!(amount > 0)) return undefined;
		let object = CashDrops.model(amount);
		object.position.copy(position);
		this.world.graphicsWorld.add(object);
		let drop: Drop = { amount: amount, object: object, position: position.clone(), age: 0, life: life, networkId: networkId, onTaken: onTaken, reason: reason };
		this.drops.push(drop);
		return drop;
	}

	private remove(drop: Drop): void
	{
		let i = this.drops.indexOf(drop);
		if (i >= 0) this.drops.splice(i, 1);
		this.world.graphicsWorld.remove(drop.object);
	}

	/** A stack of notes with a band round it and a green glow, bigger for more. */
	private static model(amount: number): THREE.Object3D
	{
		if (CashDrops.geometry === undefined)
		{
			CashDrops.geometry = new THREE.BoxGeometry(0.16, 0.06, 0.08);
			CashDrops.material = new THREE.MeshStandardMaterial({ color: 0x5fae5a, roughness: 0.8, emissive: 0x1a4a18, emissiveIntensity: 0.6 });
			let canvas = document.createElement('canvas');
			canvas.width = canvas.height = 64;
			let ctx = canvas.getContext('2d');
			let gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
			gradient.addColorStop(0, 'rgba(140, 255, 140, 0.9)');
			gradient.addColorStop(1, 'rgba(60, 200, 80, 0)');
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, 64, 64);
			let texture = new THREE.CanvasTexture(canvas);
			texture.colorSpace = THREE.SRGBColorSpace;
			CashDrops.glowMaterial = new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
		}
		let group = new THREE.Group();
		group.name = 'cash';
		let stacks = amount >= 500 ? 3 : amount >= 100 ? 2 : 1;
		for (let i = 0; i < stacks; i++)
		{
			let stack = new THREE.Mesh(CashDrops.geometry, CashDrops.material);
			stack.position.set((i - (stacks - 1) / 2) * 0.1, i % 2 === 0 ? 0 : 0.06, 0);
			stack.rotation.y = i * 0.5;
			stack.castShadow = true;
			group.add(stack);
		}
		let glow = new THREE.Sprite(CashDrops.glowMaterial);
		glow.scale.setScalar(0.55);
		glow.position.y = 0.12;
		glow.userData.noOcclusion = true;
		group.add(glow);
		group.userData.label = '$' + Wallet.format(amount);
		return group;
	}
}
