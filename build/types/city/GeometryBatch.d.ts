import * as THREE from 'three';
/**
 * Collects triangles for one material in one part of the city and turns them
 * into a single mesh at the end, so the whole of a district's brickwork is
 * one draw call. Extra per-vertex attributes are declared up front and each
 * face supplies a value for them.
 */
export declare class GeometryBatch {
    private positions;
    private normals;
    private uvs;
    private indices;
    private extras;
    constructor(extras?: {
        [name: string]: number;
    });
    get empty(): boolean;
    get vertexCount(): number;
    private pushVertex;
    /**
     * A quad a-b-c-d, counter-clockwise seen from its front, with a UV for each
     * corner. The normal is worked out from the corners unless given.
     */
    quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uvs: number[][], extras?: {
        [name: string]: number[];
    }, normal?: THREE.Vector3): void;
    /** Sets an extra attribute per corner on the quad just added, where one value per face won't do. */
    patchLast(name: string, corners: number[][]): void;
    triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, uvs: number[][], extras?: {
        [name: string]: number[];
    }): void;
    /**
     * An upward facing rectangle between two corners at a height, textured by
     * where it is in the world so neighbouring pieces line up.
     */
    flat(minX: number, minZ: number, maxX: number, maxZ: number, y: number, extras?: {
        [name: string]: number[];
    }): void;
    /**
     * The sides of an axis aligned box, UVs running along each side and up it
     * from the given base height, so windows line up between the tiers of a
     * stepped tower. Top and bottom are optional.
     */
    boxSides(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, baseY: number, extras?: {
        [name: string]: number[];
    }, uOffset?: number): void;
    /** Every face of a box turned about Y, textured in world units. */
    orientedBox(center: THREE.Vector3, size: THREE.Vector3, quaternion: THREE.Quaternion, extras?: {
        [name: string]: number[];
    }): void;
    build(): THREE.BufferGeometry;
}
