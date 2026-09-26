import * as THREE from 'three';
export interface Unlock {
    id: string;
    label: string;
    /** Kills on the account before it can be picked. Zero means everyone has it. */
    kills: number;
}
/**
 * Things to earn by playing.
 *
 * The server has been counting kills since accounts went in and nothing ever
 * spent them. Four more colours and three hats, gated on the tally, is a use
 * for a number that was only ever written down.
 */
export declare const COLOURS: Unlock[];
export declare const HATS: Unlock[];
export declare function isUnlocked(item: Unlock, kills: number): boolean;
export declare function findHat(id: string): Unlock;
/**
 * Built from primitives rather than loaded: three hats' worth of geometry is
 * a smaller thing to make than a file to download, and they tint with the
 * player's colour the same way the rest of the body does.
 */
export declare function buildHat(id: string, color: string): THREE.Object3D;
