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
    private screechBuffer;
    private screechLoading;
    private pool;
    private cursor;
    private flat;
    constructor(world: World);
    /** @param strength 0 to 1, how hard the hit was. */
    thud(position: THREE.Vector3, strength: number): void;
    whoosh(): void;
    /**
     * Fetches the recorded sounds, while the world loads. The tyre squeal is a
     * real car's, cut into a seamless loop; if it can't be had, the one made
     * here stands in for it.
     */
    load(): void;
    /** A loop of tyre squeal, for vehicles to play as loud as their tyres are sliding. Undefined until it has loaded. */
    screech(): AudioBuffer;
    private take;
    /** Noise through a falling envelope, with a low tone under it for the weight. */
    private buildThud;
    /**
     * Standing in for the recording: a wavering tone a little over a kilohertz
     * with its overtones, fluttering in strength, roughened with hiss, over a
     * low scrub of the tyre dragging. Two seconds, looped, with the end faded
     * into the start so the join doesn't click.
     */
    private buildScreech;
    /** Noise that opens up and closes again, which is what a boost sounds like. */
    private buildWhoosh;
}
