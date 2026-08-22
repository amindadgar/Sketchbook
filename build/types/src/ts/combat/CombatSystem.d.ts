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
    /** Aiming is worth something beyond the view: shots land tighter. */
    private static readonly AIM_SPREAD_FACTOR;
    /**
     * What a run of kills is called, and where it stops being called anything.
     * The reward is a magazine of spare rounds, which is help rather than a
     * head start: a streak that armed the leader properly would end the round.
     */
    private static readonly STREAK_REWARDS;
    /** How near a wall has to be to the player before it counts as their cover. */
    private static readonly COVER_SLACK;
    private world;
    pickups: WeaponPickup[];
    private cooldown;
    private reloadTimer;
    private triggerWasDown;
    private deathTimer;
    /** Who to watch while down, when the shot came from someone in the party. */
    private lastKiller;
    private lastWeapon;
    /** Kills since last dying. Announced at three, five, seven and ten. */
    private streak;
    private aiming;
    private respawnPoints;
    private gunBuffers;
    private audioPool;
    private audioCursor;
    private hitSound;
    constructor(world: World);
    /**
     * One buffer per weapon, played through a small pool of positional nodes.
     * The automatic fires twelve times a second, and building and discarding a
     * dozen audio nodes a second to keep up with it would be silly.
     */
    private loadGunAudio;
    private playGunSound;
    /**
     * The click that says a shot landed. Synthesised rather than shipped: it's
     * two hundredths of a second of decaying tone, which is a strange thing to
     * make the player download.
     */
    private buildHitSound;
    private markHit;
    setRespawnPoints(points: THREE.Vector3[]): void;
    /** One weapon per anchor, cycling the types so no corner is all shotguns. */
    placePickups(anchors: THREE.Vector3[]): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    /** Held right button, but only with a gun in hand and out of a vehicle. */
    private setAiming;
    private updateTrigger;
    private fire;
    /**
     * Walls first to find how far the shot carries, then people against that.
     *
     * People are tested analytically rather than by raycasting the physics world,
     * because everyone but the local player has their physics switched off: their
     * capsule isn't in the physics world at all, so a ray could never find it.
     */
    /** Nothing left to load means the gun is spent, so it's dropped. */
    private beginReload;
    private finishReload;
    private trace;
    /**
     * Ray against an upright cylinder standing where the character does.
     * Returns the distance along the ray, or undefined for a miss.
     */
    private static rayHitsCharacter;
    /** Random direction inside a cone, so a spread weapon doesn't fire a line. */
    private static spread;
    private reportHit;
    /**
     * Damage from driving into something, rather than from being shot. Nobody
     * gets the point for it, so there's no attacker to name.
     */
    applyCrashDamage(damage: number): void;
    /**
     * A hit arriving from somebody else's client.
     *
     * The relay has already checked what it can, but it has never seen the map
     * and so can't tell a clear shot from one through a wall. This client can:
     * it holds the map, and it is the authority on where it is standing. So the
     * last word on whether a bullet could have arrived is here.
     */
    takeRemoteHit(damage: number, attackerId: number, from?: THREE.Vector3, weapon?: string): void;
    /**
     * A kill by the local player, learned from the room rather than claimed:
     * the client that died is the one that reports it, so this is the first
     * this client hears of it.
     */
    creditKill(): void;
    /** True when something solid stands between the shot and this player. */
    private behindCover;
    private applyDamage;
    /**
     * Watches somebody still standing rather than a body on the floor. The
     * killer if they can be found, otherwise whoever is nearest, and nobody at
     * all when playing alone, in which case the view stays where it fell.
     *
     * This runs after the camera has already been pointed at the corpse for the
     * frame, so the override lands one frame late, which nobody can see.
     */
    private spectate;
    private respawn;
    private collectPickups;
    /** Shows somebody else's shot: their flash and their tracer. */
    showRemoteShot(from: THREE.Vector3, direction: THREE.Vector3, weaponId: string): void;
    private addMuzzleFlash;
    private addTracer;
}
