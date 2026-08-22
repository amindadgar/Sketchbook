import * as THREE from 'three';
import { World } from '../world/World';
/**
 * Sounds the game makes that nobody had to record.
 *
 * A crash and a burst of nitro are both noise with an envelope on it, which is
 * a strange thing to ship as a file when the browser can build one in a
 * millisecond. Buffers are made once and played through a small pool, so a
 * pile-up doesn't allocate an audio node per impact.
 */
export declare class Sfx {
    private world;
    private thudBuffer;
    private whooshBuffer;
    private pool;
    private cursor;
    private flat;
    constructor(world: World);
    /** @param strength 0 to 1, how hard the hit was. */
    thud(position: THREE.Vector3, strength: number): void;
    whoosh(): void;
    private take;
    /** Noise through a falling envelope, with a low tone under it for the weight. */
    private buildThud;
    /** Noise that opens up and closes again, which is what a boost sounds like. */
    private buildWhoosh;
}
