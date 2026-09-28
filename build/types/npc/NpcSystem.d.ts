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
    private playerClips;
    private playerHips;
    private fullClips;
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
    /**
     * A fresh copy of each model the traffic drives, loaded ahead, so a car
     * can be stolen the moment it's asked for: the real vehicle has to exist
     * in that frame for the player to climb into.
     */
    private spares;
    private loadingSpare;
    /** The models the traffic drives, in catalogue order, and what each looks like. */
    private trafficModels;
    private stolenCount;
    /** Cars taken from the traffic, here or by other players, oldest first. */
    private stolen;
    /** Names of taken cars still loading here, so each is only made once. */
    private stolenLoading;
    /** Traffic taken here but maybe still in the next snapshot from whoever simulates it. */
    private taken;
    private stolenTimer;
    /** Jobs' cars, kept however far away they are. */
    private held;
    private maxCars;
    private maxPedestrians;
    constructor(world: World, city: City);
    private load;
    private loadSpare;
    /** The loaded copy of a model, taken, and another sent for. */
    private takeSpare;
    /** How many different bodies there are to choose from. */
    get bodies(): number;
    /**
     * Somebody for a job: one of the pedestrians' bodies, copied, with every
     * one of the player's animations fitted to its height, ready to be made a
     * full Character that can walk up to a car, sit in it and get out again.
     */
    personModel(variant: number): {
        scene: THREE.Object3D;
        animations: THREE.AnimationClip[];
    };
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
    private flee;
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
    /**
     * The nearest pedestrian standing within reach of a point on the ground,
     * inside a cone either side of a direction, for a punch. Feet to feet,
     * and not somebody on a different level.
     */
    pedestrianWithin(feet: THREE.Vector3, along: THREE.Vector3, reach: number, minCos: number): Pedestrian;
    /**
     * A gun held on a pedestrian: they stop where they are, for as long as it
     * stays on them. Only where they're simulated; on anyone else's screen
     * they carry on, and the hold-up still counts.
     */
    holdUp(pedestrian: Pedestrian): void;
    /** Let go after a hold-up, and running. */
    scare(pedestrian: Pedestrian, from: THREE.Vector3): void;
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
    /** The model a taken car's name says it is: the fifth part, or the original car for a name from before there were others. */
    private static modelOf;
    /**
     * A car for a job, made the way a taken one is so everyone in a party sees
     * it: parked here, facing along a heading, in one of the traffic's colours.
     * Kept, however far off, for as long as it's held; let go of, it's cleared
     * away like any taken car once nobody is near it.
     */
    spawnJobCar(position: THREE.Vector3, heading: number, color: number, ready: (vehicle: Vehicle) => void, model?: string): void;
    /** Whether a job is holding on to this car: this screen's alone, not the party's. */
    isHeld(vehicle: Vehicle): boolean;
    /** Done with a job's car: it's cleared away with the rest once it's out of everyone's way. */
    letGo(vehicle: Vehicle): void;
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
