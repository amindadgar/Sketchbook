import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * Something marked on the map: a shop, where a job wants you to go.
 * Pinned ones stay on the rim of the corner map pointing the way when they're
 * further off than it shows, which is all the directions a job needs to give.
 */
export interface Blip {
    position: THREE.Vector3;
    color: string;
    label?: string;
    /** Kept on the corner map's rim, pointing the way, however far off. */
    pin?: boolean;
    shape?: 'dot' | 'square' | 'diamond';
    /** On the big map only, not cluttering the corner one. */
    bigMapOnly?: boolean;
}
/**
 * A round minimap centred on the player and turned with the camera, the way
 * GTA's is: whatever is straight ahead is up, the streets swing round as the
 * view does, and an N on the rim says where north went. It opens out into a
 * north-up map of the whole world.
 *
 * The whole world is rendered from overhead once when loading finishes and kept
 * as a still image; each frame just blits the patch of it around the player and
 * draws markers on top. Re-rendering the scene every frame would mean paying for
 * the entire world twice over to draw a handful of dots.
 */
export declare class Minimap implements IUpdatable {
    private static scratch;
    updateOrder: number;
    private static readonly SNAPSHOT_WIDTH;
    private static readonly SIZE;
    /** How far from the player the rim of the circle sits, in metres. */
    private static readonly VIEW_RADIUS;
    /** The big map never grows past this, however big the screen. */
    private static readonly FULL_MAX;
    /** Names on the big map, made up like the rest of the place. */
    private static readonly PLACES;
    /** Opened out to the whole world rather than the patch round the player. */
    expanded: boolean;
    /** How far the corner map is turned, radians, so the camera's forward is up. */
    private turn;
    private world;
    private container;
    private canvas;
    private context;
    private snapshot;
    private snapshotScaleX;
    private snapshotScaleZ;
    /** The big map's size on screen, and the window size it was worked out for. */
    private fullSize;
    private fullRatio;
    private laidOutFor;
    constructor(world: World);
    toggleExpanded(): void;
    setExpanded(expanded: boolean): void;
    private layoutSmall;
    /** What the big map's size depends on: the window, and the screen it's on. */
    private static layoutKey;
    /** As big as fits the window with a margin, drawn at the screen's own resolution. */
    private layoutFull;
    /** Renders the world from directly overhead and keeps it as the backdrop. */
    capture(): void;
    update(timeStep: number): void;
    private drawRound;
    private drawTerrain;
    private drawMarkers;
    /**
     * @param pinToRim keeps a marker on the edge of the circle pointing the way
     * it lies once it's further off than the view radius, instead of dropping it.
     */
    private drawMarker;
    /**
     * Everything at once: the whole of the world fitted into a square, every
     * vehicle and player on it, and the names of the places.
     */
    private drawFull;
    private drawPlaces;
    /** A marker's outline, about the origin. */
    private shapePath;
    private dot;
    private label;
    private static vehicleColor;
    /** @param turn how far the map under the arrow is turned; the big map isn't. */
    private drawPlayer;
    private drawNorth;
    /** What the map is centred on and pointed by: the vehicle if driving, else the character. */
    private subject;
    /**
     * Lit from straight above, the world comes back as a pale wash with nothing
     * for markers to stand out against. This pulls contrast up and brightness
     * down so it reads as a map.
     */
    /** The render comes back in linear light; this brings it to screen brightness. */
    private static tone;
}
