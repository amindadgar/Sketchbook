import * as THREE from 'three';
import { CityContext, BreakableSpec, InstanceRef } from './CityContext';
import { LoadingManager } from '../core/LoadingManager';
/**
 * The things along a street: lamps, traffic signals, trees, and the props
 * from Poly Haven. Simple shapes are made here; the props arrive in one file
 * and are set up as kinds once it's in, before the instances are drawn.
 */
export declare class StreetFurniture {
    static readonly PROPS: string[];
    /** How far the lamp's head reaches out over the road from the pole. */
    static readonly LAMP_REACH: number;
    static readonly LAMP_HEIGHT: number;
    private context;
    private poolMaterial;
    constructor(context: CityContext);
    setNight(amount: number): void;
    /** Loads the props file and defines a kind per prop. Instances can be placed before it arrives. */
    loadProps(loadingManager: LoadingManager, onLoaded: () => void): void;
    /**
     * A street light: a pole, and an arm reaching over the road with the head
     * on the end. Built pointing along +Z, the direction it lights.
     */
    private static lampPole;
    private static lampHead;
    /**
     * A signal mast: pole on the corner, arm out over the lanes, and the
     * housing hanging off it facing the oncoming traffic, which is +Z. The
     * lights themselves are the traffic system's to draw, since they change.
     */
    private static signalFrame;
    /**
     * A street light as something a car can knock down: the pole solid until
     * then, and the pole with its arm and head as the piece that falls. The
     * median lights have an arm each way.
     */
    static lampBreakable(base: THREE.Vector3, yaw: number, scale: number, instances: {
        ref: InstanceRef;
        falls: boolean;
    }[], bothWays?: boolean): BreakableSpec;
    /** A signal mast: the pole, and the arm reaching out over the road with the lights on it. */
    static signalBreakable(base: THREE.Vector3, yaw: number, mast: InstanceRef, lenses: number[]): BreakableSpec;
    /** A small thing on the pavement that goes over whole: a hydrant, a bin, a bench. */
    static propBreakable(base: THREE.Vector3, yaw: number, size: THREE.Vector3, ref: InstanceRef, mass: number): BreakableSpec;
    /** Where each of a signal's three lamps sits, relative to its frame, facing +Z. */
    static readonly SIGNAL_LAMPS: THREE.Vector3[];
    private static poolTexture;
}
