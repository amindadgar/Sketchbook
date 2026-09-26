import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Character } from '../characters/Character';
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
    /**
     * Hits from other players are ignored for this long after coming back, so
     * nobody is shot as they appear, and a burst aimed at the body they left
     * doesn't follow them to the spawn point.
     */
    private static readonly SPAWN_PROTECTION;
    /** Shortest gap between two respawns asked for in a party, so Shift+R isn't a teleport. */
    private static readonly RESPAWN_COOLDOWN;
    /** One shotgun blast is eight confirmations arriving together; they light one marker. */
    private static readonly MARKER_GAP;
    private static readonly FLASH_INTENSITY;
    private static readonly FLASH_LIFE;
    private static scratch;
    private world;
    pickups: WeaponPickup[];
    /**
     * Which life the local player is on. It goes out with every movement update
     * and comes back on the hits aimed at them, so a hit meant for a life that
     * has ended is recognisable when it arrives.
     */
    life: number;
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
    private hurtSound;
    /**
     * A fixed pair of lights reused by every muzzle flash. Adding and removing
     * a light changes the light count, which makes three.js rebuild the program
     * of every lit material in the scene: a hitch on every shot in a fight.
     */
    private flashLights;
    private flashLife;
    private flashCursor;
    private protection;
    private respawnCooldown;
    private markerCooldown;
    /** Died while in or getting into a vehicle; they're pulled out next update. */
    private pendingEject;
    /** The local character this was last looking after, to notice it being replaced. */
    private knownCharacter;
    constructor(world: World);
    /**
     * One buffer per weapon, played through a small pool of positional nodes.
     * The automatic fires twelve times a second, and building and discarding a
     * dozen audio nodes a second to keep up with it would be silly.
     */
    private loadGunAudio;
    /** Made once, while the world is still loading, so the shaders account for them from the start. */
    private createFlashLights;
    private playGunSound;
    /**
     * The click that says a shot landed. Synthesised rather than shipped: it's
     * two hundredths of a second of decaying tone, which is a strange thing to
     * make the player download.
     */
    private buildHitSound;
    /** A low thump for being hit, made the same way as the hit click. */
    private buildHurtSound;
    private synthesise;
    private markHit;
    setRespawnPoints(points: THREE.Vector3[]): void;
    /** One weapon per anchor, cycling the types so no corner is all shotguns. */
    placePickups(anchors: THREE.Vector3[]): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    /**
     * A new local character: a scenario launch, or the player's own restart.
     * Whatever was going on with the last one, a countdown to respawning, a
     * camera on the killer, a reload, is over, and the new one is a new life.
     */
    private onCharacterReplaced;
    /** Held right button, but only with a gun in hand and out of a vehicle. */
    private setAiming;
    private updateTrigger;
    private fire;
    /**
     * Toward whatever is under the crosshair.
     *
     * The crosshair is the middle of the screen, which is the camera's line of
     * sight, and while aiming the camera slides over a shoulder. Firing along
     * the line from the camera to the character, as this used to, put every
     * aimed shot about twenty degrees to the side of the reticle. So the camera's
     * own line is traced to find what it's on, and the shot goes from the eye to
     * that. The trace starts level with the shooter, so nothing standing behind
     * them, between them and the camera, can catch it.
     */
    private aimDirection;
    /** Nothing left to load means the gun is spent, so it's dropped. */
    private beginReload;
    private finishReload;
    /**
     * Walls first to find how far the shot carries, then people against that.
     *
     * People are tested analytically rather than by raycasting the physics world,
     * because everyone but the local player has their physics switched off: their
     * capsule isn't in the physics world at all, so a ray could never find it.
     *
     * Every surface along the ray is collected rather than just the first,
     * because the first is the car body when the target is sitting inside a car.
     * Their own car doesn't shield them; anything else in the way still does.
     */
    private trace;
    /** The body of the vehicle a character sits in or is climbing into, if any. */
    private static vehicleBodyOf;
    /**
     * Ray against an upright cylinder standing where the character does.
     * Returns the distance along the ray, or undefined for a miss. Measured at
     * the world position: a seated character belongs to its car, and its own
     * position is only where in the car it is.
     */
    private static rayHitsCharacter;
    /** Random direction inside a cone, so a spread weapon doesn't fire a line. */
    private static spread;
    /**
     * Returns whether the hit marker should show right away. For someone in
     * the party it waits for their client to say the hit counted, since the
     * relay or their cover check can still turn it down, and a marker for a hit
     * that did nothing is exactly what "my shots don't register" looks like.
     */
    private reportHit;
    /** The player we shot says it counted. */
    confirmHit(dead: boolean): void;
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
    takeRemoteHit(damage: number, attackerId: number, from?: THREE.Vector3, weapon?: string, life?: number): void;
    /** The red at the edges, a wedge toward the shooter, and a thump. */
    private feelHit;
    /**
     * A kill by the local player, learned from the room rather than claimed:
     * the client that died is the one that reports it, so this is the first
     * this client hears of it.
     */
    creditKill(): void;
    /**
     * True when something solid stands between the shot and this player, at
     * both head and chest height: one of them showing over a low wall is still
     * a clear shot.
     *
     * Only fixed scenery counts. Cars and their doors are simulated by every
     * client separately, so a parked car can be somewhere else on this screen
     * than on the shooter's; the shooter's own trace already stops at the cars
     * it could see.
     */
    private behindCover;
    private blockedBetween;
    private applyDamage;
    /**
     * Watches somebody still standing rather than a body on the floor. The
     * killer if they can be found, otherwise whoever is nearest, and nobody at
     * all when playing alone, in which case the view stays where it fell.
     */
    private spectate;
    private respawn;
    /**
     * Shift+R in a party: back to a spawn point, alone. Health and the gun come
     * along unchanged, so it gets someone unstuck without being a free heal
     * mid fight, and there's a short wait between uses.
     */
    respawnNow(): void;
    private placeAtRespawnPoint;
    private collectPickups;
    /** Somebody else took this one, so it goes dark here too. */
    remotePickup(index: number): void;
    /**
     * Shows somebody else's shot: their flash and their tracers.
     *
     * Drawn to where their pellets actually ended when they said, rather than
     * traced again here from a slightly different place against a slightly
     * different world, which could show a hit passing beside the person it hit.
     * Only traced when there are no end points, and then never against the
     * shooter's own body, which the barrel starts inside.
     */
    showRemoteShot(from: THREE.Vector3, direction: THREE.Vector3, weaponId: string, shooter?: Character, endpoints?: THREE.Vector3[]): void;
    private addMuzzleFlash;
    private fadeFlashLights;
    /**
     * Someone else's are drawn thicker and left up a little longer: a tracer is
     * how the player being shot at finds out where from, and a hairline gone in
     * four frames was easy to miss entirely.
     */
    private addTracer;
}
