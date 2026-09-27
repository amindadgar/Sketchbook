import * as THREE from 'three';
import { World } from '../world/World';
import { City } from '../city/City';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Job } from './Job';
import { Blip } from '../core/Minimap';
import { Character } from '../characters/Character';
import { Vehicle } from '../vehicles/Vehicle';
import { Gunman, GunmanOptions } from './JobAI';
import { ICharacterAI } from '../interfaces/ICharacterAI';
/** A place a job wants the player: a glowing ring and column, and a mark on the map pointing the way. */
export declare class JobMarker {
    position: THREE.Vector3;
    radius: number;
    object: THREE.Group;
    blip: Blip;
    private world;
    private materials;
    constructor(world: World, position: THREE.Vector3, color: string, radius: number, label?: string);
    moveTo(position: THREE.Vector3): void;
    /** Within the ring, and not far above or below it. */
    contains(point: THREE.Vector3, slack?: number): boolean;
    pulse(time: number): void;
    dispose(): void;
}
/**
 * Work for money, from the job board on J.
 *
 * One job runs at a time, alongside free roam: nothing is relaunched, the
 * traffic and the people carry on, and so does everyone else in a party.
 * The system holds what every job needs: the markers, the people it puts
 * in the city, where the player is and what they're driving, the panel
 * saying what to do next and how long is left, and paying out. A job ends
 * by paying, by failing, or by being walked away from on the board, and it
 * also ends if the player dies or the world is relaunched under it.
 */
export declare class JobSystem implements IUpdatable {
    updateOrder: number;
    world: World;
    city: City;
    jobs: Job[];
    active: Job;
    time: number;
    private markers;
    private people;
    private vehicles;
    private arrivals;
    /** Bumped at every job's end, so a car still loading for the last one isn't handed to the next. */
    private run;
    private generation;
    private character;
    private boardOpen;
    private shownHud;
    constructor(world: World, city: City);
    register(job: Job): void;
    toggleBoard(): void;
    private showBoard;
    start(job: Job): void;
    /** Walked away from on the board. */
    quit(): void;
    /** Went wrong: no pay, and the job's over. */
    fail(reason: string): void;
    /** Paid, for a part of a job or the whole of it. Experience comes with the money. */
    pay(amount: number, reason: string): void;
    /** Done, and nothing more to it. Pay first if it paid. */
    finish(message?: string): void;
    private end;
    update(timeStep: number, unscaledTimeStep: number): void;
    /**
     * An arrow in the panel toward the nearest place the job is marking, turned
     * to the way the camera faces, and how far it is. A phone keeps its map
     * folded away, so the minimap's arrows round its edge are no help there.
     */
    private pointTheWay;
    /**
     * The panel at the top left: what to do now, a line under it, and how long
     * is left if the clock's running. Undefined hides it.
     */
    setHud(objective: string, detail?: string, secondsLeft?: number): void;
    static clock(seconds: number): string;
    addMarker(position: THREE.Vector3, color: string, radius: number, label?: string): JobMarker;
    removeMarker(marker: JobMarker): void;
    /**
     * Somebody in the city for the job: one of the pedestrians' bodies as a full
     * character, standing where it's put, facing along a direction. Undefined
     * while the bodies are still loading.
     */
    addPerson(position: THREE.Vector3, facing?: THREE.Vector3, variant?: number): Character;
    removePerson(person: Character): void;
    /**
     * Somebody with a gun, posted here: a guard, a bodyguard. Calm until the
     * job makes them hostile or somebody shoots them. Undefined while the
     * bodies are still loading.
     */
    addGunman(position: THREE.Vector3, facing: THREE.Vector3, options: GunmanOptions, variant?: number): Gunman;
    /** Gives somebody a mind of their own: running, driving, walking somewhere. */
    setMind(person: Character, ai: ICharacterAI): void;
    /**
     * A car for the job, parked on a heading (radians about the vertical, 0
     * facing +z), in one of the traffic's colours by number. It arrives a
     * moment later, once loaded; ready is called on a later frame, and only if
     * the job is still the one that asked. Taken away when the job ends, unless the player is in it.
     */
    addVehicle(position: THREE.Vector3, heading: number, color: number, ready: (vehicle: Vehicle) => void, model?: string): void;
    /**
     * Done with a car: whoever the job sat in it is taken out, and the car goes
     * too, unless the player's in it or getting in, in which case it's theirs.
     */
    removeVehicle(vehicle: Vehicle): void;
    /**
     * Somebody made for the job, straight into a seat: the driver's, if it's
     * free and nothing else is asked for. Undefined if there's nobody to make
     * yet, or no such seat free.
     */
    seatPerson(vehicle: Vehicle, driver: boolean, variant?: number): Character;
    /** Lets go of a person without removing them: they stay in the world as scenery, for someone else to clear. */
    releasePerson(person: Character): void;
    playerPosition(): THREE.Vector3;
    /** The car or bike the player is driving, if they are. */
    drivenVehicle(): Vehicle;
    /**
     * A spot on the pavement somewhere between two distances from a point,
     * in the city rather than on the island, and not over water.
     */
    pavementSpot(from: THREE.Vector3, min: number, max: number, zones?: string[]): {
        position: THREE.Vector3;
        facing: THREE.Vector3;
    };
    /** Out from the pavement to the kerbside lane, where a car stops for someone on it. */
    kerbside(spot: {
        position: THREE.Vector3;
        facing: THREE.Vector3;
    }): THREE.Vector3;
}
