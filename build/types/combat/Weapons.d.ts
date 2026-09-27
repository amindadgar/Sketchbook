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
    /** Degrees the view kicks up per shot, and settles back down from. */
    recoil: number;
    color: string;
    /** Dollars at a gun shop, and for another magazine's worth of spare rounds. */
    price: number;
    ammoPrice: number;
    /** Held and aimed in one hand. Everything longer gets the other hand under it. */
    oneHanded?: boolean;
    /** The view narrows to this while aiming, for a scope. */
    zoomFov?: number;
    /** Another gun's report, played at a different pitch, when this one has none of its own. */
    sound?: string;
    soundPitch?: number;
    /** False for guns only ever sold, never lying about to be picked up. */
    pickup?: boolean;
}
/**
 * Guns that want to be used differently: the rifles reward aim, the shotgun
 * rewards closing the distance, the automatics reward holding an angle, and
 * the handgun is the one you always have something better than. The first
 * four lie about the map to be picked up; the rest are only sold.
 *
 * The numbers live in shared/weapons.json because the relay checks incoming
 * hits against them. A second copy over there would drift from this one and
 * start turning honest shots away.
 */
export declare const WEAPONS: WeaponSpec[];
export declare function findWeapon(id: string): WeaponSpec;
/**
 * A gun: the modelled one, from the CC0 guns pack, once it has loaded, and
 * until then one built out of boxes in its shape and colour, so a gun is in
 * the hand the moment it's picked up. Both share an origin at the top of the
 * grip, the barrel along +z, so the swap doesn't move it.
 *
 * The group carries a 'muzzle' child marking where shots leave the barrel.
 */
export declare function buildWeaponModel(spec: WeaponSpec): THREE.Group;
/** A soft radial blob, drawn once and shared by every muzzle flash. */
export declare function getFlashTexture(): THREE.CanvasTexture;
