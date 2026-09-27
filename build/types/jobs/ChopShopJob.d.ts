import { Job } from './Job';
import { JobSystem } from './JobSystem';
/**
 * A car to order, for a buyer at the docks.
 *
 * The buyer wants one colour, and every car of it in the traffic shows on the
 * map. Take one the usual way, out from under its driver, and the chop shop
 * goes up on the map, down by the harbour if there's room there. Get out or
 * swap to the wrong car and it's back to looking. Stop in the ring and the
 * buyer pays: more the further the car came from where it was taken, and
 * less for every dent in it. There are six minutes before the buyer gives up.
 */
export declare class ChopShopJob extends Job {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly pays: string;
    /** Every car sold here, across every run of the job. */
    private static sold;
    private static readonly COLOR;
    private static readonly NAMES;
    private static readonly CLOCK;
    private static readonly MIN_DISTANCE;
    private static readonly RADIUS;
    private static readonly BASE_PRICE;
    private static readonly PER_UNIT;
    /** A wreck still sells for its parts. */
    private static readonly WORST_CONDITION;
    /** How long the car sits with the buyer before it's gone. */
    private static readonly HANDOVER;
    /** Past this it's left where it is, even if the player's climbed back in. */
    private static readonly HANDOVER_LIMIT;
    private stage;
    private wanted;
    private timeLeft;
    private marker;
    private dropOff;
    /** The car being delivered, or last delivered to the ring. */
    private car;
    /** Where each car of the right colour was first driven off from, which is what the buyer pays the distance on. */
    private takenFrom;
    /** One map dot per traffic car of the wanted colour. */
    private carBlips;
    private handingFor;
    private verdict;
    constructor(system: JobSystem);
    start(): string;
    update(timeStep: number): void;
    cleanup(): void;
    /** Looking for a car of the colour, with every one of them on the map. */
    private steal;
    /** In a car of the right colour: the traffic's dots go and the chop shop goes up. */
    private startDelivering;
    /** Out of it, or into the wrong one: the chop shop's hidden until there's a car for it again. */
    private backToStealing;
    private deliver;
    /** Paid already; the car goes once the player's out and clear of it. */
    private handOver;
    /** Keeps a dot on every traffic car of the wanted colour that could still be taken. How many there are. */
    private trackCars;
    private clearCarBlips;
    private dropBlip;
    /** Nobody sat in it or on their way in. */
    private isEmpty;
    /** Gone to the buyer, if nobody's in it; otherwise left for the traffic to tidy away. */
    private scrap;
    /** Paid on how far it came from where it was taken to the chop shop, then knocked down for the damage. */
    private priceFor;
    private static verdictOn;
    private colorName;
    /** Whether a traffic car wears its colour: a taxi's yellow whatever number it carries. */
    private static painted;
    /**
     * The colour a taken car was painted, from its name, or -1 if it isn't a
     * taken car. One from the dealership has papers, and a taxi or a police
     * car is its livery whatever its name says, so none of those will do.
     */
    private takenColor;
}
