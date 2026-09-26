import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { World } from './World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * Sun, moon, sky and the light they cast.
 *
 * The sky is three's physical (Preetham) sky with its drifting clouds, and the
 * same sky is rendered into a prefiltered environment map every time the sun
 * has moved a little, so everything shiny reflects the sky that's actually up
 * there and everything rough is lit by it. The sun goes below the horizon for
 * a short night, when a moon takes over the shadows and the stars come out.
 */
export declare class Sky extends THREE.Object3D implements IUpdatable {
    updateOrder: number;
    /** Toward the sun, ten units long. Below the horizon at night. */
    sunPosition: THREE.Vector3;
    csm: CSM;
    set theta(value: number);
    set phi(value: number);
    private _phi;
    private _theta;
    /**
     * How far round the day it is, nought to one. The sun rises, crosses and
     * sets, and dips far enough under the horizon for about a quarter of the
     * cycle to be night: long enough for the city lights to mean something,
     * short enough that nobody spends long driving in the dark.
     */
    private phase;
    private static readonly LOW_SUN;
    private static readonly HIGH_SUN;
    /** Below this the headlights come on. */
    private static readonly NIGHT_BELOW;
    private static readonly SUN_INTENSITY;
    /**
     * A game's moon rather than a real one: bright enough to drive and fight
     * by, with the street lights and windows still the brightest things out.
     */
    private static readonly MOON_INTENSITY;
    /** 0 in daylight, 1 at full night. Read by anything that glows after dark. */
    nightFactor: number;
    private hemiLight;
    private skyMesh;
    private stars;
    private envScene;
    private envSky;
    private pmrem;
    private envTarget;
    private envSunAtLastBake;
    private envAge;
    private fogDay;
    private fogDusk;
    /** Also the colour the night sky fades to at the horizon, so the haze meets it. */
    private fogNight;
    private lightDirection;
    private moonColor;
    private sunColor;
    private hemiSkyDay;
    private hemiSkyNight;
    private hemiGroundDay;
    private hemiGroundNight;
    private world;
    constructor(world: World);
    /**
     * The physical sky comes out some twenty times brighter than anything
     * a sun of sensible strength can light, which left the world looking dim
     * under a glaring sky and made everything bloom. Scaling the sky down
     * instead of the sun up keeps the numbers small, and since the same sky
     * is baked into the reflections, what things reflect scales with it.
     */
    private static readonly SKY_SCALE;
    private static createSkyMesh;
    /** A few thousand points on the far plane, faded in after dark. */
    private static createStars;
    /** True when it's dark enough to want the lights on. */
    get isNight(): boolean;
    /** The baked sky, for materials that want it without being in the scene. */
    get environment(): THREE.Texture;
    update(timeScale: number, unscaledTimeStep: number): void;
    /**
     * Walks the sun round on its own, unless somebody is dragging the sliders
     * in the settings, in which case it stays where they put it.
     */
    private advanceDay;
    /** Sets the time of day directly, nought to one, as the party clock does. */
    setPhase(phase: number): void;
    getPhase(): number;
    refreshSunPosition(): void;
    /**
     * Everything that follows from the sun's height: how strong and what
     * colour the light is, the haze, and the exposure.
     */
    refreshLighting(): void;
    /**
     * Re-bakes the reflections once the sun has moved a degree or so. A bake
     * is a handful of small renders, a few milliseconds, which is nothing
     * every couple of seconds and far too much every frame.
     */
    private refreshEnvironment;
}
