import * as THREE from 'three';
import { World } from '../world/World';
import { City } from '../city/City';
import { CityPlan } from '../city/CityPlan';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Panel, PanelRow } from '../core/Panel';
import { Blip } from '../core/Minimap';
import { WEAPONS, WeaponSpec } from '../combat/Weapons';
import { Wallet } from '../progress/Wallet';
import { Vehicle } from '../vehicles/Vehicle';
import { EntityType } from '../enums/EntityType';

export type ShopKind = 'guns' | 'repair' | 'dealer';

export interface ShopSite
{
	kind: ShopKind;
	name: string;
	/** Where to stand, or for the garage, the middle of the bay to stop in. */
	position: THREE.Vector3;
	/** Out of the shop towards the street. */
	facing: THREE.Vector3;
	/** How close counts as there. */
	reach: number;
	blip: Blip;
	marker: THREE.Object3D;
}

/**
 * Where money gets spent: two gun shops on the pavement, a garage to drive into
 * and have the car put right, and a dealership lot.
 *
 * Every client finds the same places, picked from the city plan, which is
 * the same everywhere. Each has a sign on the building, a ring on the ground
 * where to stand, and a mark on the map. Stand in the ring and E opens it.
 */
export class ShopSystem implements IUpdatable
{
	// Before the interaction prompt picks what E does
	public updateOrder: number = 30;

	/** Where the two gun shops go, as points the nearest street spot is found for. */
	private static readonly GUN_SHOPS: THREE.Vector2[] = [new THREE.Vector2(-652, -40), new THREE.Vector2(-900, -250)];
	/** The garage and the dealership take the open lots nearest these. */
	private static readonly GARAGE_NEAR: THREE.Vector2 = new THREE.Vector2(-960, 270);
	public static readonly DEALER_NEAR: THREE.Vector2 = new THREE.Vector2(-528, -390);
	private static readonly COLORS: { [kind: string]: string } = { guns: '#e2574c', repair: '#4aa3ff', dealer: '#b37cff' };

	public sites: ShopSite[] = [];
	/** The dealership lot, for vehicles bought to be put in. */
	public dealerLot: { minX: number, maxX: number, minZ: number, maxZ: number };

	private world: World;
	private city: City;
	private open: ShopSite;
	private time: number = 0;
	private dealer: (site: ShopSite) => void;

	constructor(world: World, city: City)
	{
		this.world = world;
		this.city = city;

		for (const near of ShopSystem.GUN_SHOPS) this.addStorefront('guns', 'Bullseye Guns', near);
		this.addGarage();
		this.addDealer();

		world.registerUpdatable(this);
	}

	/** The dealership's counter is somebody else's to fill. */
	public setDealer(open: (site: ShopSite) => void): void
	{
		this.dealer = open;
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		this.time += unscaledTimeStep;
		for (const site of this.sites)
		{
			let pulse = 0.55 + 0.25 * Math.sin(this.time * 3);
			site.marker.traverse((child: any) =>
			{
				if (child.userData.pulse === true) child.material.opacity = pulse;
			});
		}

		let character = this.world.localCharacter;
		if (character === undefined || character.health <= 0)
		{
			this.closeShop();
			return;
		}
		let here = character.getWorldPosition(new THREE.Vector3());

		// Walked away from the counter: the shop closes behind you
		if (this.open !== undefined && (here.distanceTo(this.open.position) > this.open.reach + 3 || !Panel.isOpen))
		{
			this.closeShop();
		}

		let driving = this.drivenVehicle();
		for (const site of this.sites)
		{
			let flat = Math.hypot(here.x - site.position.x, here.z - site.position.z);
			if (flat > site.reach || Math.abs(here.y - site.position.y) > 3) continue;

			if (site.kind === 'repair')
			{
				if (driving === undefined) continue;
				this.offerRepair(site, driving);
			}
			else if (!character.isBusyWithVehicle() && this.open !== site)
			{
				let text = site.kind === 'guns' ? 'Browse guns' : 'Browse vehicles';
				this.world.interactions.offer({ text: text, action: () => this.openShop(site), priority: 2 });
			}
		}
	}

	private drivenVehicle(): Vehicle
	{
		let character = this.world.localCharacter;
		if (character === undefined || character.controlledObject === undefined) return undefined;
		let vehicle = character.controlledObject as unknown as Vehicle;
		return vehicle.entityType === EntityType.Car ? vehicle : undefined;
	}

	private openShop(site: ShopSite): void
	{
		this.open = site;
		if (site.kind === 'guns') this.showGuns(site);
		else if (site.kind === 'dealer' && this.dealer !== undefined) this.dealer(site);
	}

	private closeShop(): void
	{
		if (this.open === undefined) return;
		this.open = undefined;
		Panel.close();
	}

	// Guns

	private showGuns(site: ShopSite): void
	{
		let rows = WEAPONS.map((weapon) => this.gunRow(weapon, site));
		let subtitle = 'You have $' + Wallet.format(this.world.wallet.cash) + '.  Bought guns are yours to keep, even after dying.';
		if (Panel.isOpen && this.open === site) Panel.refresh(subtitle, rows);
		else Panel.open(site.name, subtitle, rows, () => { if (this.open === site) this.open = undefined; });
	}

	private gunRow(weapon: WeaponSpec, site: ShopSite): PanelRow
	{
		let wallet = this.world.wallet;
		let owned = wallet.ownsGun(weapon.id);
		let carried = this.world.combat.carries(weapon.id);
		let kind = weapon.pellets > 1 ? 'shotgun' : weapon.automatic ? 'automatic' : 'semi-automatic';
		let detail = kind + ', ' + weapon.damage + (weapon.pellets > 1 ? ' x ' + weapon.pellets : '') + ' damage, '
			+ weapon.magazine + ' round magazine, range ' + Math.round(weapon.range / CityPlan.METRE) + ' m';

		if (owned || carried)
		{
			return {
				title: weapon.name + (owned ? '  (owned)' : '  (carried)'),
				detail: detail,
				aside: '$' + Wallet.format(weapon.ammoPrice),
				button: owned || carried ? 'Ammo' : 'Buy',
				enabled: wallet.canAfford(weapon.ammoPrice),
				onClick: () =>
				{
					if (!wallet.spend(weapon.ammoPrice)) return;
					if (!this.world.combat.addAmmo(weapon.id)) this.world.combat.giveWeapon(weapon.id, true);
					this.world.notices.say(weapon.name + ' ammo', 'good', '+' + weapon.magazine + ' rounds');
					this.showGuns(site);
				}
			};
		}

		return {
			title: weapon.name,
			detail: detail,
			aside: '$' + Wallet.format(weapon.price),
			button: 'Buy',
			enabled: wallet.canAfford(weapon.price),
			onClick: () =>
			{
				if (!wallet.spend(weapon.price)) return;
				wallet.addGun(weapon.id);
				this.world.combat.giveWeapon(weapon.id, true);
				this.world.notices.say('Bought the ' + weapon.name, 'good', 'yours to keep');
				this.showGuns(site);
			}
		};
	}

	// The garage

	private offerRepair(site: ShopSite, vehicle: Vehicle): void
	{
		let speed = vehicle.collision.velocity.length();
		if (speed > 1.5) return;
		let damage = 100 - vehicle.integrity;
		if (damage < 1)
		{
			this.world.interactions.offer({ text: 'Nothing to fix', action: () => this.world.notices.say('Not a scratch on it'), priority: 1 });
			return;
		}
		let price = ShopSystem.repairPrice(vehicle);
		this.world.interactions.offer({
			text: 'Repair  $' + Wallet.format(price),
			priority: 2,
			action: () =>
			{
				if (!this.world.wallet.spend(price))
				{
					this.world.notices.say('Not enough cash', 'bad', 'repairs are $' + Wallet.format(price));
					return;
				}
				vehicle.repair();
				this.world.notices.say('Good as new', 'good', site.name);
			}
		});
	}

	/** Forty for looking, then eight a point of damage. */
	public static repairPrice(vehicle: Vehicle): number
	{
		return Math.round(40 + (100 - vehicle.integrity) * 8);
	}

	// Where the shops go

	/**
	 * The spot on the pavement nearest a point in front of a building, and the
	 * way into the building from it. Jobs use it for shops of their own.
	 */
	public storefrontSpot(near: THREE.Vector2, zones: string[] = ['downtown', 'midtown', 'residential']): { position: THREE.Vector3, inward: THREE.Vector3 }
	{
		let best: { position: THREE.Vector3, inward: THREE.Vector3 };
		let bestDistance = Infinity;
		for (const spot of this.city.spawnSpots)
		{
			let d = Math.hypot(spot.position.x - near.x, spot.position.z - near.y);
			if (d >= bestDistance) continue;
			let block = this.blockAt(spot.position);
			if (block === undefined || zones.indexOf(block.zone) < 0) continue;
			// Into the block, square to the pavement
			let across = new THREE.Vector3(-spot.facing.z, 0, spot.facing.x);
			let toMiddle = new THREE.Vector3((block.minX + block.maxX) / 2 - spot.position.x, 0, (block.minZ + block.maxZ) / 2 - spot.position.z);
			if (across.dot(toMiddle) < 0) across.negate();
			best = { position: spot.position.clone(), inward: across.normalize() };
			bestDistance = d;
		}
		return best;
	}

	/** A shop front on the pavement nearest a point, on a block with a building on it. */
	private addStorefront(kind: ShopKind, name: string, near: THREE.Vector2): void
	{
		let best = this.storefrontSpot(near);
		if (best === undefined) return;

		let facing = best.inward.clone().negate();
		let marker = new THREE.Group();
		marker.add(ShopSystem.ring(ShopSystem.COLORS[kind], 1.1));
		// The sign over the door, on the front of the building
		let sign = ShopSystem.sign(name, kind === 'guns' ? 'GUNS & AMMO' : '', ShopSystem.COLORS[kind]);
		sign.position.copy(best.inward).multiplyScalar(0.62).setY(2.9);
		sign.lookAt(sign.position.clone().add(facing));
		marker.add(sign);
		marker.position.copy(best.position);
		this.world.graphicsWorld.add(marker);

		this.addSite(kind, name, best.position, facing, 1.6, marker);
	}

	/** A bay painted on an open lot to drive into, with a sign on a post. */
	private addGarage(): void
	{
		let lot = this.lotNear(ShopSystem.GARAGE_NEAR);
		if (lot === undefined) return;
		let cx = (lot.minX + lot.maxX) / 2;
		let cz = (lot.minZ + lot.maxZ) / 2;
		// The half of the lot clear of the planters down its middle
		let bay = new THREE.Vector3(cx, CityPlan.GROUND + CityPlan.CURB + 0.02, cz + (lot.maxZ - lot.minZ) * 0.22);
		let marker = new THREE.Group();
		marker.add(ShopSystem.bay(ShopSystem.COLORS.repair, 7, 10));
		let post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 8), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6 }));
		post.position.set(-4.2, 2, -5.5);
		marker.add(post);
		let sign = ShopSystem.sign('Fix & Spray', 'REPAIRS', ShopSystem.COLORS.repair);
		sign.position.set(-4.2, 4.3, -5.5);
		sign.lookAt(new THREE.Vector3(-4.2, 4.3, 10));
		marker.add(sign);
		marker.position.copy(bay);
		this.world.graphicsWorld.add(marker);

		this.addSite('repair', 'Fix & Spray', bay, new THREE.Vector3(0, 0, 1), 5, marker);
	}

	/** A counter at the corner of an open lot, where bought vehicles are left. */
	private addDealer(): void
	{
		let lot = this.lotNear(ShopSystem.DEALER_NEAR);
		if (lot === undefined) return;
		this.dealerLot = lot;
		let cx = (lot.minX + lot.maxX) / 2;
		let counter = new THREE.Vector3(cx, CityPlan.GROUND + CityPlan.CURB + 0.02, lot.maxZ - 3);
		let marker = new THREE.Group();
		marker.add(ShopSystem.ring(ShopSystem.COLORS.dealer, 1.1));
		let post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 8), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6 }));
		post.position.set(1.8, 2, 0);
		marker.add(post);
		let sign = ShopSystem.sign('Northside Motors', 'CARS & BIKES', ShopSystem.COLORS.dealer);
		sign.position.set(1.8, 4.3, 0);
		sign.lookAt(new THREE.Vector3(1.8, 4.3, 10));
		marker.add(sign);
		marker.position.copy(counter);
		this.world.graphicsWorld.add(marker);

		this.addSite('dealer', 'Northside Motors', counter, new THREE.Vector3(0, 0, 1), 1.6, marker);
	}

	private addSite(kind: ShopKind, name: string, position: THREE.Vector3, facing: THREE.Vector3, reach: number, marker: THREE.Object3D): void
	{
		let blip: Blip = { position: position.clone(), color: ShopSystem.COLORS[kind], label: name, shape: 'square' };
		this.world.blips.push(blip);
		this.sites.push({ kind: kind, name: name, position: position.clone(), facing: facing, reach: reach, blip: blip, marker: marker });
	}

	public blockAt(p: THREE.Vector3): { minX: number, maxX: number, minZ: number, maxZ: number, zone: string }
	{
		return this.city.plan.blocks.find((b) => p.x >= b.minX - 0.5 && p.x <= b.maxX + 0.5 && p.z >= b.minZ - 0.5 && p.z <= b.maxZ + 0.5);
	}

	/** The lot of the open parking block nearest a point, inside its pavement. */
	public lotNear(near: THREE.Vector2): { minX: number, maxX: number, minZ: number, maxZ: number }
	{
		let best: { minX: number, maxX: number, minZ: number, maxZ: number };
		let bestDistance = Infinity;
		for (const block of this.city.plan.blocks)
		{
			if (block.zone !== 'parking' || block.maxX - block.minX < 30 || block.maxZ - block.minZ < 30) continue;
			let d = Math.hypot((block.minX + block.maxX) / 2 - near.x, (block.minZ + block.maxZ) / 2 - near.y);
			if (d < bestDistance)
			{
				bestDistance = d;
				best = block;
			}
		}
		if (best === undefined) return undefined;
		let s = CityPlan.SIDEWALK;
		return { minX: best.minX + s, maxX: best.maxX - s, minZ: best.minZ + s, maxZ: best.maxZ - s };
	}

	// Looks

	/** A glowing ring on the ground to stand in. */
	public static ring(color: string, radius: number): THREE.Object3D
	{
		let group = new THREE.Group();
		let ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.78, radius, 40), new THREE.MeshBasicMaterial({
			color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide
		}));
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.04;
		ring.userData.pulse = true;
		ring.userData.noOcclusion = true;
		group.add(ring);
		let glow = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, 1.4, 32, 1, true), new THREE.MeshBasicMaterial({
			color: new THREE.Color(color), transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
		}));
		glow.position.y = 0.7;
		glow.userData.noOcclusion = true;
		group.add(glow);
		return group;
	}

	/** An outlined rectangle on the ground to drive into. */
	public static bay(color: string, width: number, length: number): THREE.Object3D
	{
		let group = new THREE.Group();
		let material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, opacity: 0.7, depthWrite: false });
		let line = (w: number, l: number, x: number, z: number) =>
		{
			let mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, l), material);
			mesh.rotation.x = -Math.PI / 2;
			mesh.position.set(x, 0.03, z);
			mesh.userData.pulse = true;
			mesh.userData.noOcclusion = true;
			group.add(mesh);
		};
		line(width, 0.25, 0, -length / 2);
		line(width, 0.25, 0, length / 2);
		line(0.25, length, -width / 2, 0);
		line(0.25, length, width / 2, 0);
		let fill = new THREE.Mesh(new THREE.PlaneGeometry(width, length), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.1, depthWrite: false }));
		fill.rotation.x = -Math.PI / 2;
		fill.position.y = 0.025;
		fill.userData.noOcclusion = true;
		group.add(fill);
		return group;
	}

	/** A lit sign: the name, and what's sold underneath. Readable at night too. */
	public static sign(name: string, line: string, color: string): THREE.Mesh
	{
		let canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 160;
		let ctx = canvas.getContext('2d');
		ctx.fillStyle = '#15171c';
		ctx.fillRect(0, 0, 512, 160);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 512, 12);
		ctx.fillRect(0, 148, 512, 12);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#ffffff';
		ctx.font = '700 58px Solway, Trebuchet MS, sans-serif';
		ctx.fillText(name, 256, line.length > 0 ? 66 : 80);
		if (line.length > 0)
		{
			ctx.fillStyle = color;
			ctx.font = '700 30px Solway, Trebuchet MS, sans-serif';
			ctx.fillText(line, 256, 120);
		}
		let texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.anisotropy = 4;
		// Basic, so it's as bright at night as by day: a sign lights itself
		let mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
		mesh.userData.noOcclusion = true;
		return mesh;
	}
}
