import * as THREE from 'three';
/**
 * Street trees and palms, made here rather than downloaded.
 *
 * The free tree models about are film assets, millions of triangles each. A
 * game tree is a trunk and a crown of leaf cards: flat squares with a cluster
 * of leaves painted on and everything else cut away, pointed every which way
 * so the crown reads as a volume from any side. The leaves are painted on a
 * canvas when the game starts, and the cards' normals point out from the
 * middle of the crown so it shades like a rounded mass rather than a heap of
 * flat squares.
 */
export declare class Vegetation {
    static readonly TREE_VARIANTS: number;
    private static leafTexture;
    private static frondTexture;
    private static barkTexture;
    private static palmBarkTexture;
    static leafMaterial(): THREE.MeshStandardMaterial;
    static frondMaterial(): THREE.MeshStandardMaterial;
    static barkMaterial(palm: boolean): THREE.MeshStandardMaterial;
    /** Trunk and crown of a broadleaf street tree, about nine metres tall. */
    static tree(variant: number): {
        trunk: THREE.BufferGeometry;
        crown: THREE.BufferGeometry;
    };
    /** A palm about twelve metres tall, leaning a little and fronds drooping. */
    static palm(variant: number): {
        trunk: THREE.BufferGeometry;
        crown: THREE.BufferGeometry;
    };
    /** A shrub: just a low cloud of leaf cards. */
    static shrub(variant: number): THREE.BufferGeometry;
    private static taperedCylinder;
    /** Leaf cards scattered through an ellipsoid, normals out from its centre. */
    private static cardCloud;
    /** One frond: a strip arching out and down from the crown. */
    private static frond;
    private static leaves;
    private static fronds;
    private static bark;
    private static palmBark;
    private static canvasTexture;
}
/** Joins non-indexed or indexed geometries with the same attributes into one. */
export declare function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry;
