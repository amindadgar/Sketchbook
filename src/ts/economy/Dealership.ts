import * as THREE from 'three';
import { World } from '../world/World';
import { ShopSystem, ShopSite } from './ShopSystem';
import { Panel, PanelRow } from '../core/Panel';
import { Wallet } from '../progress/Wallet';
import { VEHICLE_MODELS, VehicleModel } from '../vehicles/VehicleCatalogue';
import { TrafficCar } from '../npc/TrafficCar';
import { Vehicle } from '../vehicles/Vehicle';
import { CityPlan } from '../city/CityPlan';

/**
 * Northside Motors: every car and bike there is, for money, in a colour of
 * your choosing.
 *
 * A bought one is left on the lot beside the counter, and it's yours for
 * good: come back and it's brought round again for nothing, in whatever
 * colour's picked. One at a time: the last one taken out goes back when the
 * next comes out, if nobody's in it.
 */
export class Dealership
{
	private static readonly COLOR_NAMES: string[] = ['White', 'Black', 'Silver', 'Grey', 'Navy', 'Red', 'Beige', 'Green', 'Plum', 'Blue'];

	private world: World;
	private shops: ShopSystem;
	private site: ShopSite;
	private color: number = 5;
	private showing: boolean = false;
	/** The one out on the road now. */
	private current: Vehicle;
	/** Everything ever brought round, which has papers: no chop shop will take one. */
	private handedOut: WeakSet<Vehicle> = new WeakSet();

	constructor(world: World, shops: ShopSystem)
	{
		this.world = world;
		this.shops = shops;
		shops.setDealer((site) => this.show(site));
	}

	private show(site: ShopSite): void
	{
		this.site = site;
		let wallet = this.world.wallet;
		let rows: PanelRow[] = [{
			title: 'Paint: ' + Dealership.COLOR_NAMES[this.color],
			detail: 'For anything that takes paint. A taxi and a police car keep their livery',
			aside: '',
			button: 'Next colour',
			onClick: () =>
			{
				this.color = (this.color + 1) % TrafficCar.COLORS.length;
				this.show(site);
			}
		}];
		for (const model of VEHICLE_MODELS) rows.push(this.row(model));

		let subtitle = 'You have $' + Wallet.format(wallet.cash) + '.  Anything bought here is yours to take out again for nothing.';
		// Refreshed in place when it's this panel that's up, otherwise opened over whatever was
		if (Panel.isOpen && this.showing) Panel.refresh(subtitle, rows);
		else
		{
			// After opening: opening closes whatever was up, and that may be an older one of these
			Panel.open(site.name, subtitle, rows, () => this.showing = false);
			this.showing = true;
		}
	}

	private row(model: VehicleModel): PanelRow
	{
		let wallet = this.world.wallet;
		let owned = wallet.ownsVehicle(model.id);
		let speed = Math.round(22 * model.gearing / CityPlan.METRE * 3.6);
		let detail = model.blurb + '. Tops out near ' + speed + ' km/h' + (model.kind === 'bike' ? ', one seat' : '');
		if (owned)
		{
			return {
				title: model.name + '  (owned)',
				detail: detail,
				aside: 'free',
				button: 'Take out',
				highlight: true,
				onClick: () => this.takeOut(model)
			};
		}
		return {
			title: model.name,
			detail: detail,
			aside: '$' + Wallet.format(model.price),
			button: 'Buy',
			enabled: wallet.canAfford(model.price),
			onClick: () =>
			{
				if (!wallet.spend(model.price)) return;
				wallet.addVehicle({ model: model.id, color: this.color });
				this.world.notices.say('Bought the ' + model.name, 'good', 'it\'s yours to keep');
				this.takeOut(model);
			}
		};
	}

	/** Brought round to the lot, facing the street. */
	private takeOut(model: VehicleModel): void
	{
		let lot = this.shops.dealerLot;
		if (lot === undefined || this.world.npcs === undefined) return;
		this.putAway();

		let x = (lot.minX + lot.maxX) / 2 + 5;
		let z = lot.maxZ - 9;
		let at = new THREE.Vector3(x, CityPlan.GROUND + CityPlan.CURB, z);
		// A taken car left in the way is moved on first. The world's own cars
		// belong to everyone in a party, so those are only driven round
		for (const vehicle of this.world.vehicles.slice())
		{
			let name = vehicle.getNetworkId();
			if (vehicle.position.distanceTo(at) < 4 && name !== undefined && name.indexOf('stolen:') === 0
				&& vehicle.seats.every((seat) => seat.occupiedBy === null)) this.world.remove(vehicle);
		}
		let color = model.paintable ? this.color : 0;
		this.world.npcs.spawnJobCar(at, 0, color, (vehicle) =>
		{
			this.current = vehicle;
			this.handedOut.add(vehicle);
		}, model.id);
		Panel.close();
		this.world.notices.say('Your ' + model.name + ' is out front', 'good', 'on the lot by the counter');
	}

	/** Whether a vehicle came from here, and so is somebody's, on paper. */
	public sold(vehicle: Vehicle): boolean
	{
		return vehicle !== undefined && this.handedOut.has(vehicle);
	}

	/** The last one out goes back, unless somebody's using it: then it's left to the streets. */
	private putAway(): void
	{
		let vehicle = this.current;
		this.current = undefined;
		if (vehicle === undefined || this.world.npcs === undefined) return;
		this.world.npcs.letGo(vehicle);
		if (vehicle.world !== undefined && vehicle.seats.every((seat) => seat.occupiedBy === null)) this.world.remove(vehicle);
	}
}
