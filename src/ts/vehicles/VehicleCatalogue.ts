/** One kind of vehicle that can be bought, stolen or driven past. */
export interface VehicleModel
{
	id: string;
	name: string;
	/** The model's file in build/assets, without the extension. Two tunes can share one. */
	file: string;
	kind: 'car' | 'bike';
	/** At the dealership. */
	price: number;
	/** Top speed against the original car's. */
	gearing: number;
	/** Pull against the original car's. */
	power: number;
	/** Takes the colour it's ordered in. A taxi or a police car keeps its livery. */
	paintable: boolean;
	/** Seen in the city's traffic, and so there to be stolen. */
	traffic: boolean;
	/** A line for the dealership. */
	blurb: string;
}

/**
 * Everything on four wheels or two. The original car is still the one every
 * scenario starts with; the rest were made for the city from a CC0 pack of
 * retro cars, the bike from scratch, and the dealership sells the lot.
 * Handling is the one car's, scaled: a van is slow to get going and tops out
 * low, the GT and the bikes go.
 */
export const VEHICLE_MODELS: VehicleModel[] = [
	{ id: 'hatchback', name: 'Hatchback', file: 'hatchback', kind: 'car', price: 3500, gearing: 0.92, power: 0.95, paintable: true, traffic: true, blurb: 'Small, cheap and quick off the lights' },
	{ id: 'compact', name: 'Compact', file: 'compact', kind: 'car', price: 5000, gearing: 0.95, power: 1, paintable: true, traffic: true, blurb: 'Square, sensible, and it starts every time' },
	{ id: 'sedan', name: 'Sedan', file: 'sedan', kind: 'car', price: 6500, gearing: 1, power: 1, paintable: true, traffic: true, blurb: 'A long bonnet and a soft ride' },
	{ id: 'wagon', name: 'Estate', file: 'wagon', kind: 'car', price: 7000, gearing: 0.9, power: 1, paintable: true, traffic: true, blurb: 'Room for everything, in no hurry' },
	{ id: 'van', name: 'Van', file: 'van', kind: 'car', price: 8000, gearing: 0.82, power: 1.1, paintable: true, traffic: true, blurb: 'Slow, heavy, and hard to stop' },
	{ id: 'taxi', name: 'Taxi', file: 'taxi', kind: 'car', price: 9000, gearing: 1, power: 1.05, paintable: false, traffic: true, blurb: 'Yellow, and every fare waves at it' },
	{ id: 'car', name: 'Roadster', file: 'car', kind: 'car', price: 10000, gearing: 1, power: 1, paintable: true, traffic: true, blurb: 'The original, and still the best handling' },
	{ id: 'sleeper', name: 'Compact GT', file: 'compact', kind: 'car', price: 15000, gearing: 1.3, power: 1.35, paintable: true, traffic: false, blurb: 'Plain on the outside, a lot of engine under the bonnet' },
	{ id: 'police', name: 'Police cruiser', file: 'police', kind: 'car', price: 22000, gearing: 1.2, power: 1.3, paintable: false, traffic: false, blurb: 'Decommissioned. Mostly' },
	{ id: 'motorbike', name: 'Street bike', file: 'motorbike', kind: 'bike', price: 4500, gearing: 1.2, power: 0.75, paintable: true, traffic: false, blurb: 'Two wheels, through any gap' },
	{ id: 'sportbike', name: 'Sport bike', file: 'motorbike', kind: 'bike', price: 11000, gearing: 1.5, power: 1, paintable: true, traffic: false, blurb: 'Faster than anything on four' },
];

export function findVehicleModel(id: string): VehicleModel
{
	return VEHICLE_MODELS.find((model) => model.id === id);
}
