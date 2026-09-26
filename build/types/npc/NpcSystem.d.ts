import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { City } from '../city/City';
import { Navigation } from './Navigation';
import { Pedestrian } from './Pedestrian';
import { TrafficCar } from './TrafficCar';
import { Vehicle } from '../vehicles/Vehicle';
/**
 * The people and traffic of the city.
 *
 * One client simulates them: whoever plays alone, or in a party the member
 * with the lowest id. That client spawns them round every player, walks and
 * drives them, and sends where they all are five times a second; everyone else
 * shows those positions, eased between updates. A shot at a pedestrian from
 * anyone else is sent to the simulating client, which decides what it does.
 * The traffic lights run off the same clock, sent along with the positions.
 */
export declare class NpcSystem implements IUpdatable {
    updateOrder: number;
    static readonly VARIANTS: string[];
    private static readonly SNAPSHOT_INTERVAL;
    /** Close enough to a car in the traffic to pull its driver out, and slow enough. */
    private static readonly STEAL_REACH;
    private static readonly STEAL_SPEED;
    /** Taken cars left further than this from every player are cleared away. */
    private static readonly STOLEN_KEEP;
    private static readonly MAX_STOLEN;
    private static readonly STOLEN_PREFIX;
    /** Names the cars taken while playing alone, unlike anyone else's from before they joined up. */
    private static readonly SESSION_TAG;
    private static readonly STATES;
    navigation: Navigation;
    pedestrians: Pedestrian[];
    cars: TrafficCar[];
    private world;
    private city;
    private ready;
    private models;
    private clips;
    private carTemplate;
    private lampTexture;
    private nextId;
    private spawnTimer;
    private snapshotTimer;
    private wasAuthority;
    private random;
    private laneSpots;
    private walkSpots;
    private lightsOn;
    /** A car model loaded and waiting, so taking a car happens the moment the key goes down. */
    private spareCar;
    private loadingSpare;
    private stolenCount;
    /** Cars taken from the traffic, here or by other players, oldest first. */
    private stolen;
    /** Names of taken cars still loading here, so each is only made once. */
    private stolenLoading;
    /** Traffic taken here but maybe still in the next snapshot from whoever simulates it. */
    private taken;
    private stolenTimer;
    private maxCars;
    private maxPedestrians;
    constructor(world: World, city: City);
    private load;
    private loadSpare;
    private static hipsHeight;
    /**
     * The player's animations, fitted to a body of a different height. Every
     * track but the hips' position is a rotation, which fits any body; the
     * hips are moved in proportion, so shorter legs don't leave feet dangling.
     */
    private static adaptClips;
    /** Candidate places to put things down: every twenty metres of lane, every few of pavement. */
    private indexSpots;
    private get authority();
    /** Where every player is, whose surroundings get populated. */
    private playerPositions;
    update(timeStep: number, unscaledTimeStep: number): void;
    private simulate;
    private nearestPlayer;
    /** Tops up traffic and crowds round the players, and clears what's left behind. */
    private populate;
    private spawnCar;
    private removeCar;
    private spawnPedestrian;
    private removePedestrian;
    clear(): void;
    private drive;
    /**
     * How far the car can go before it meets something: another car, a player,
     * someone crossing. Anything within a lane's width of its line ahead counts.
     */
    private clearAhead;
    private static scratch;
    private placePedestrian;
    private walk;
    /** At lights, when the traffic crossing their path has a red. Elsewhere, when nothing's coming. */
    private mayCross;
    /**
     * After every physics step: anything moving that's about to run into a
     * car in the traffic, which is then let go into the physics world before
     * the two touch, so the hit shoves it instead of stopping dead against it.
     * Knocked cars count too, so one can be shunted into the next.
     */
    private afterStep;
    private knockAhead;
    /** Two rectangles seen from above, each by its middle, its two directions and half its size along them. */
    private static overlaps;
    /** One of a body's own directions, flattened onto the ground. */
    private static flat;
    private footprints;
    /** A vehicle's boxes as one rectangle from above, in its own frame. */
    private footprint;
    /** Whether a knocked car has come to rest, for long enough to count. */
    private cameToRest;
    /**
     * On the client simulating the city: once a knocked car stops, back into
     * the nearest lane going roughly the way it points, and on it drives. On
     * its roof, or pushed somewhere no lane is, it's a wreck, its driver gets
     * out, and it's cleared away once nobody's looking.
     */
    private settle;
    /** How far into the spot something has to be to stop a car pulling back in: touching it doesn't count. */
    private static readonly BLOCKED;
    /** Whether a vehicle or another knocked car is where this one would pull back in to. */
    private laneBlocked;
    /** On everyone else's client: once it stops here, it goes back to showing the reports. */
    private settleCopy;
    /** The nearest point on a lane, pointing roughly the same way if a direction is given, if one is close. */
    private nearestLane;
    /** Cars hitting pedestrians and players ramming the traffic. */
    private checkImpacts;
    private kill;
    private scatter;
    /** A gun went off: people nearby run. */
    onGunshot(origin: THREE.Vector3): void;
    /**
     * Distance along a ray to the first pedestrian it passes through, as an
     * upright cylinder, or undefined.
     */
    rayHitsPedestrian(origin: THREE.Vector3, direction: THREE.Vector3, range: number): {
        pedestrian: Pedestrian;
        distance: number;
    };
    /** A bullet landed on a pedestrian, here or, arriving over the network, on someone else's screen. */
    damagePedestrian(id: number, damage: number, from: THREE.Vector3): void;
    /** The car in the traffic someone standing here could take, if there is one. */
    stealable(from: THREE.Vector3): TrafficCar;
    /**
     * Swaps a car in the traffic for a real one in exactly its place, the
     * same colour, parked, and puts its driver out on the road running. The
     * player then gets in it the way they get into anything else.
     */
    steal(car: TrafficCar): Vehicle;
    /** Another player took a car out of the traffic this client simulates. */
    onStolen(id: number, door: THREE.Vector3): void;
    /**
     * A car somebody took, seen here for the first time in a report of where
     * it is: made from its name, which carries its colour, at that spot.
     */
    spawnStolen(name: string, message: any): boolean;
    private makeStolen;
    /** The driver, out of the door and running for the pavement. */
    private bailOut;
    /** Clears away taken cars nobody is using and nobody is near, and keeps their number down. */
    private tidyStolen;
    /**
     * Frees what a taken car was drawn with. Each one is its own copy of the
     * model, loaded for it alone, so nothing else is using any of it; only the
     * headlight glow and the sprites' quad are shared, and those stay.
     */
    private static dispose;
    private snapshot;
    private cityClock;
    /** Where everything is, according to whoever simulates it. */
    applySnapshot(message: any): void;
    private static makeLampTexture;
}
