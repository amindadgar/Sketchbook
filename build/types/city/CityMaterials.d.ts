import * as THREE from 'three';
import { LoadingManager } from '../core/LoadingManager';
/**
 * The city's materials. Every surface is physically based, textured from
 * Poly Haven's CC0 scans, with the geometry's UVs measured in world units so a
 * texture's scale is set once here rather than per mesh.
 *
 * Two families get a little shader on top: roads, which paint their own lane
 * markings and crossings from where on the road a pixel is, and building
 * walls, which cut a grid of windows into whatever the wall is made of and
 * light a scatter of them after dark.
 */
export declare class CityMaterials {
    /** Shared by every window and lamp that glows at night, nought to one. */
    static night: {
        value: number;
    };
    asphalt: THREE.MeshStandardMaterial;
    highway: THREE.MeshStandardMaterial;
    junction: THREE.MeshStandardMaterial;
    parking: THREE.MeshStandardMaterial;
    sidewalk: THREE.MeshStandardMaterial;
    curb: THREE.MeshStandardMaterial;
    concrete: THREE.MeshStandardMaterial;
    grass: THREE.MeshStandardMaterial;
    sand: THREE.MeshStandardMaterial;
    rocks: THREE.MeshStandardMaterial;
    roof: THREE.MeshStandardMaterial;
    roofTiles: THREE.MeshStandardMaterial;
    planks: THREE.MeshStandardMaterial;
    metal: THREE.MeshStandardMaterial;
    painted: THREE.MeshStandardMaterial;
    darkMetal: THREE.MeshStandardMaterial;
    lampGlow: THREE.MeshStandardMaterial;
    /** Facades by name: what the wall between the windows is made of. */
    facades: {
        [name: string]: THREE.MeshStandardMaterial;
    };
    static readonly FACADES: string[];
    private loader;
    private loadingManager;
    private anisotropy;
    private cache;
    constructor(loadingManager: LoadingManager, anisotropy: number);
    /** Night glow follows the sky, and so do the street lamps' heads. */
    setNight(amount: number): void;
    private texture;
    /** An ordinary tiled surface: colour, normals, and the AO/roughness/metal pack. */
    private surface;
    /**
     * Lane markings from the road's own coordinates: u across it in units
     * from the centreline, v along it. The road's layout rides along as an
     * attribute (lanes each way, lane width, median, parking strip) so one
     * material paints every kind of road.
     */
    private static addRoadMarkings;
    /** Zebra crossings round the edge of a junction's square. */
    private static addCrossings;
    /**
     * u is across the road from the centre line, v along it. aRoad is lanes,
     * lane width, median width and parking strip width.
     */
    private static readonly MARKING_GLSL;
    /**
     * A wall with windows in it. The UVs run along the wall and up it, in
     * units; aFacade is floor height, bay width, window style and a seed, and
     * aTint colours the wall. Styles: 0 punched windows, 1 ribbon windows,
     * 2 curtain wall, 3 warehouse; add 10 for shop windows on the ground floor.
     */
    private facade;
}
