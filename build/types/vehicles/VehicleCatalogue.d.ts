/** One kind of vehicle that can be bought, stolen or driven past. */
export interface VehicleModel {
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
export declare const VEHICLE_MODELS: VehicleModel[];
export declare function findVehicleModel(id: string): VehicleModel;
