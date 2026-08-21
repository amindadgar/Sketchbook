import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { WeaponPickup } from './WeaponPickup';
/**
 * Guns, health and kills.
 *
 * Every client is the authority on its own health, matching how the rest of the
 * party layer already works. A shooter reports the hit, the player who was hit
 * decides what it did to them, and their death is what awards the point. That
 * keeps one owner per number instead of two clients disagreeing about it.
 */
export declare class CombatSystem implements IUpdatable {
    updateOrder: number;
    private static readonly RESPAWN_DELAY;
    private static readonly EYE_HEIGHT;
    private world;
    pickups: WeaponPickup[];
    private effects;
    private cooldown;
    private reloadTimer;
    private triggerWasDown;
    private deathTimer;
    private respawnPoints;
    constructor(world: World);
    setRespawnPoints(points: THREE.Vector3[]): void;
    /** One weapon per anchor, cycling the types so no corner is all shotguns. */
    placePickups(anchors: THREE.Vector3[]): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    private updateTrigger;
    private fire;
    /**
     * Walls first to find how far the shot carries, then people against that.
     *
     * People are tested analytically rather than by raycasting the physics world,
     * because everyone but the local player has their physics switched off: their
     * capsule isn't in the physics world at all, so a ray could never find it.
     */
    private trace;
    /**
     * Ray against an upright cylinder standing where the character does.
     * Returns the distance along the ray, or undefined for a miss.
     */
    private static rayHitsCharacter;
    /** Random direction inside a cone, so a spread weapon doesn't fire a line. */
    private static spread;
    private reportHit;
    /** A hit arriving from somebody else's client. */
    takeRemoteHit(damage: number, attackerId: number): void;
    private applyDamage;
    private respawn;
    private collectPickups;
    /** Shows somebody else's shot: their flash and their tracer. */
    showRemoteShot(from: THREE.Vector3, direction: THREE.Vector3, weaponId: string): void;
    private addMuzzleFlash;
    private addTracer;
    private updateEffects;
}
