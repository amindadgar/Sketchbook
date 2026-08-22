import * as THREE from 'three';
import { World } from './World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { default as CSM } from 'three-csm';
export declare class Sky extends THREE.Object3D implements IUpdatable {
    updateOrder: number;
    sunPosition: THREE.Vector3;
    csm: CSM;
    set theta(value: number);
    set phi(value: number);
    private _phi;
    private _theta;
    /**
     * How far round the day it is, nought to one. The sun rises, crosses and
     * sets, and the elevation stops just short of the horizon rather than going
     * under it: the sky here is an atmospheric scattering shader with no stars
     * behind it, and a game nobody can see is worse than a short night.
     */
    private phase;
    private static readonly LOW_SUN;
    private static readonly HIGH_SUN;
    /** Below this the world is lit like dusk and the headlights come on. */
    private static readonly NIGHT_BELOW;
    private hemiLight;
    private maxHemiIntensity;
    private minHemiIntensity;
    private skyMesh;
    private skyMaterial;
    private world;
    constructor(world: World);
    /** True when it's dark enough to want the lights on. */
    get isNight(): boolean;
    update(timeScale: number, unscaledTimeStep: number): void;
    /**
     * Walks the sun round on its own, unless somebody is dragging the sliders
     * in the settings, in which case it stays where they put it.
     */
    private advanceDay;
    refreshSunPosition(): void;
    refreshHemiIntensity(): void;
}
