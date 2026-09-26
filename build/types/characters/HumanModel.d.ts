import * as THREE from 'three';
/**
 * The people. Built by tools/humans/build_character.py from MakeHuman's CC0
 * assets: one skinned mesh, one texture atlas, and a Mixamo-named skeleton
 * with the game's whole animation set retargeted onto it.
 */
export declare class HumanModel {
    /** The player and everyone else in a party, with the animations. */
    static readonly PLAYER: string;
    /** Bone names, as three.js has them once the colons are gone. */
    static readonly HEAD: string;
    static readonly RIGHT_HAND: string;
    /**
     * Gives a human's material a shirt colour. The model carries a mask
     * attribute that's 1 on the shirt and 0 everywhere else, so one colour
     * multiplied in through it recolours the shirt without touching skin,
     * jeans or hair, and the character stays a single draw call.
     */
    static prepareMaterial(material: THREE.MeshStandardMaterial): void;
    /** Whether this material came from one of the human models. */
    static isHumanMaterial(material: any): boolean;
}
