import * as THREE from 'three';
export interface WeaponSpec {
    id: string;
    name: string;
    /** Damage per bullet that lands. Characters start on 100. */
    damage: number;
    /** Seconds between shots. */
    fireInterval: number;
    /** Held trigger keeps firing, otherwise one shot per click. */
    automatic: boolean;
    magazine: number;
    /** Spare rounds carried beyond the loaded magazine. Runs out for good. */
    reserve: number;
    reloadTime: number;
    /** Cone half angle in radians. */
    spread: number;
    range: number;
    /** Bullets per shot, only the shotgun fires more than one. */
    pellets: number;
    color: string;
}
/**
 * Four weapons that want to be used differently: the rifle rewards aim, the
 * shotgun rewards closing the distance, the automatic rewards holding an angle,
 * and the handgun is the one you always have something better than.
 */
export declare const WEAPONS: WeaponSpec[];
export declare function findWeapon(id: string): WeaponSpec;
/**
 * Guns built out of boxes rather than modelled, since the project ships no
 * weapon art. At the size they're actually seen, silhouette and colour are what
 * make them tellable apart, so each one gets a distinct one.
 *
 * The group carries a 'muzzle' child marking where shots leave the barrel.
 */
export declare function buildWeaponModel(spec: WeaponSpec): THREE.Group;
/** A soft radial blob, drawn once and shared by every muzzle flash. */
export declare function getFlashTexture(): THREE.CanvasTexture;
