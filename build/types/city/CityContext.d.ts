import * as THREE from 'three';
import * as CANNON from 'cannon';
import { GeometryBatch } from './GeometryBatch';
import { CityMaterials } from './CityMaterials';
/** One placed copy of a kind: which kind, which district's set, which copy in it. */
export interface InstanceRef {
    kind: string;
    chunk: string;
    index: number;
    matrix: THREE.Matrix4;
}
/**
 * Something a car snaps off rather than stops dead against: street lights,
 * signal masts, hydrants, bins. Solid to anyone walking into it, and to a car
 * nudging it, but hit at any speed it comes away and falls over.
 */
export interface BreakableSpec {
    /** The base, on the ground, and which way it faces. */
    position: THREE.Vector3;
    yaw: number;
    /** The solid part, a box standing on the base. */
    size: THREE.Vector3;
    /** Boxes for the loose piece once it's broken off, relative to the base and turned with it. */
    pieces: {
        center: THREE.Vector3;
        size: THREE.Vector3;
    }[];
    mass: number;
    /** Slowest a car can be going and still knock it over. */
    strength: number;
    /** How much of its speed a car keeps going through it. */
    keep: number;
    /** What's drawn: the copies to hide when it's knocked over, and whether each falls with it. */
    instances: {
        ref: InstanceRef;
        falls: boolean;
    }[];
    /** Traffic light lenses on it, by index into the city's lens set. */
    lenses?: number[];
    /** The loose piece sized to what's drawn rather than to the pieces given, for props from a file. */
    fit?: boolean;
}
export interface Breakable extends BreakableSpec {
    id: number;
    shape: CANNON.Box;
    body: CANNON.Body;
    offset: CANNON.Vec3;
    orientation: CANNON.Quaternion;
    broken: boolean;
    brokenAt: number;
}
/**
 * Everything the city's builders write into.
 *
 * Geometry goes into batches keyed by district and material, and each batch
 * becomes one mesh, so a district's roads are one draw call and it can be
 * culled as a whole when it's behind the camera. Colliders go into one static
 * body per district for the same reason: the physics engine sorts and tests
 * bodies, and a thousand buildings as a thousand bodies would cost it far
 * more than twenty bodies of fifty boxes each. Repeated props are counted
 * here and drawn instanced, again one set per district.
 */
export declare class CityContext {
    static readonly CHUNK: number;
    materials: CityMaterials;
    group: THREE.Group;
    bodies: {
        [key: string]: CANNON.Body;
    };
    /** Breakable things, by id, which is the same on every client since the city is. */
    breakables: Breakable[];
    /** Their colliders, a body per district of their own, so one can be taken out cheaply. */
    private breakableBodies;
    private batches;
    private instances;
    private instanceColors;
    private kinds;
    /** The instanced meshes drawn for each kind in each district, once built. */
    private built;
    /** Copies not to draw, 'kind|chunk|index', kept for sets that aren't built yet. */
    private hidden;
    private static readonly NOWHERE;
    /** Everything with a draw distance, checked against the camera now and then. */
    culled: THREE.Object3D[];
    constructor(materials: CityMaterials);
    static chunkOf(x: number, z: number): string;
    /** The batch for a material in the district a point is in. */
    batch(material: THREE.Material, x: number, z: number, extras?: {
        [name: string]: number;
    }, shadows?: boolean): GeometryBatch;
    /** A box collider, turned by the given rotation, into the district's body. */
    collider(center: THREE.Vector3, size: THREE.Vector3, quaternion?: THREE.Quaternion): void;
    private static districtBody;
    /** Something that stands solid until a car hits it hard enough. */
    breakable(spec: BreakableSpec): Breakable;
    /** Takes a breakable's collider out of the world, or puts it back. */
    setBreakableSolid(breakable: Breakable, solid: boolean): void;
    /** Registers something drawn many times over. Parts share every instance's transform. */
    defineKind(kind: string, parts: {
        geometry: THREE.BufferGeometry;
        material: THREE.Material;
    }[], shadows?: boolean, drawDistance?: number): void;
    hasKind(kind: string): boolean;
    place(kind: string, position: THREE.Vector3, yaw?: number, scale?: number, color?: THREE.Color): InstanceRef;
    /** The geometry and materials a kind is drawn with. */
    partsOf(kind: string): {
        geometry: THREE.BufferGeometry;
        material: THREE.Material;
    }[];
    /** Stops drawing one placed copy, or draws it again. */
    setInstanceHidden(ref: InstanceRef, hidden: boolean): void;
    placedCount(kind: string): number;
    /** Turns every batch into a mesh. */
    buildBatches(): void;
    /** Turns every placed prop of the given kinds, or of all defined kinds, into instanced meshes. */
    buildInstances(only?: string[]): THREE.InstancedMesh[];
    /**
     * Hides whatever's further from the camera than it's worth drawing. A
     * hydrant half a kilometre away is a few pixels in the haze, but it's
     * still a few hundred triangles in the main pass and three shadow passes.
     */
    cull(camera: THREE.Vector3): void;
    addBodiesTo(world: CANNON.World): void;
}
