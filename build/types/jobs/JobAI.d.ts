import * as THREE from 'three';
import * as CANNON from 'cannon';
import { ICharacterAI } from '../interfaces/ICharacterAI';
import { Character } from '../characters/Character';
import { WeaponSpec } from '../combat/Weapons';
import { World } from '../world/World';
import { Navigation, Lane } from '../npc/Navigation';
/**
 * Whether anything solid stands between two points: buildings, walls, cars.
 * The vehicle a target sits in doesn't hide them from a shot at it.
 */
export declare function clearLine(world: World, from: THREE.Vector3, to: THREE.Vector3, ignore?: CANNON.Body): boolean;
export interface GunmanOptions {
    /** A weapon id from the catalogue. */
    weapon: string;
    /** Chance of a hit on someone standing still ten metres off. */
    accuracy?: number;
    /** How much of the gun's damage lands: people in the city shoot worse than players. */
    damageScale?: number;
    /** How far off they notice the player once there's trouble. */
    sight?: number;
    /** Where they're posted. They go no further than the leash from it after anyone. */
    home?: THREE.Vector3;
    leash?: number;
    /** Shooting on sight from the start, rather than once something starts it. */
    hostile?: boolean;
}
/**
 * Somebody with a gun: a guard at a till, a bodyguard, the crew on a cash van.
 *
 * Posted somewhere and calm until there's trouble: the job says so by making
 * them hostile, or somebody shoots them. Then they turn on the player when
 * they can see them, fire in short bursts from where they stand, and go after
 * the player when they can't see them, as far as their post allows.
 *
 * Their shots are real rounds for the player's health, through the same
 * cover rules as anyone else's, and look and sound like anybody's.
 */
export declare class Gunman implements ICharacterAI {
    character: Character;
    hostile: boolean;
    readonly spec: WeaponSpec;
    private world;
    private accuracy;
    private damageScale;
    private sight;
    private home;
    private leash;
    private cooldown;
    private burst;
    /** A moment between seeing the player and the first shot. */
    private reaction;
    private seen;
    private lastSeen;
    private lastHealth;
    private dead;
    private sightCheck;
    private canSee;
    constructor(world: World, options: GunmanOptions);
    /** Once the character is made: puts the gun in their hand. */
    arm(): void;
    get alive(): boolean;
    update(timeStep: number): void;
    private fire;
    private goHome;
    private static vehicleOf;
}
/**
 * Somebody running for it: away from the player, or to a place. Slows to a
 * walk once far enough away, if nothing else is asked of them.
 */
export declare class Runner implements ICharacterAI {
    character: Character;
    /** Where they're making for; away from the player when it's undefined. */
    goal: THREE.Vector3;
    /** Far enough from the player to stop running. */
    safeDistance: number;
    arrived: boolean;
    private world;
    private wander;
    private sideways;
    private dead;
    constructor(world: World, goal?: THREE.Vector3, safeDistance?: number);
    update(timeStep: number): void;
}
/** Somebody walking to a place and stopping there. */
export declare class Walker implements ICharacterAI {
    character: Character;
    goal: THREE.Vector3;
    running: boolean;
    arrived: boolean;
    private dead;
    constructor(goal: THREE.Vector3, running?: boolean);
    update(timeStep: number): void;
}
/** The lane whose line passes nearest a point, and how far along it that is. Heading, if given, rules out lanes going the other way. */
export declare function nearestLane(navigation: Navigation, point: THREE.Vector3, heading?: THREE.Vector3): {
    lane: Lane;
    distance: number;
    gap: number;
};
/**
 * A way through the streets from a lane, along the lanes, about so long:
 * straight on more often than not, a turn now and then. The points are
 * spaced a few units apart, so it can be driven by following them.
 */
export declare function laneRoute(start: Lane, from: number, length: number, straightness?: number): THREE.Vector3[];
/** Where a lane goes on to: straight across most of the time. */
export declare function nextLane(lane: Lane, straightness?: number): Lane;
/**
 * At the wheel of a car, following a line of points: a race route, or the
 * lanes of the city one after another. Keeps to a speed, slows for bends,
 * and backs up and tries again when it's stuck against something.
 *
 * When it runs out of points it asks for more, if it's been told how, and
 * otherwise stops at the end and says so.
 */
export declare class Driver implements ICharacterAI {
    character: Character;
    points: THREE.Vector3[];
    /** The one being driven at now. */
    index: number;
    /** Cruising speed, units a second. */
    speed: number;
    done: boolean;
    /** Held still, engine running: at the lights of a race start, or pulled over. */
    paused: boolean;
    /** More of the road, when it's run out. */
    extend: () => THREE.Vector3[];
    private stuck;
    private reversing;
    private dead;
    constructor(points: THREE.Vector3[], speed: number, extend?: () => THREE.Vector3[]);
    /** How far down the route, as a count of points passed. */
    get progress(): number;
    update(timeStep: number): void;
    private release;
}
