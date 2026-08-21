import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * A round, north-up minimap centred on the player.
 *
 * The whole world is rendered from overhead once when loading finishes and kept
 * as a still image; each frame just blits the patch of it around the player and
 * draws markers on top. Re-rendering the scene every frame would mean paying for
 * the entire world twice over to draw a handful of dots.
 */
export declare class Minimap implements IUpdatable {
    updateOrder: number;
    private static readonly SNAPSHOT_WIDTH;
    private static readonly SIZE;
    /** How far from the player the rim of the circle sits, in metres. */
    private static readonly VIEW_RADIUS;
    private world;
    private canvas;
    private context;
    private snapshot;
    private snapshotScaleX;
    private snapshotScaleZ;
    constructor(world: World);
    /** Renders the world from directly overhead and keeps it as the backdrop. */
    capture(): void;
    update(timeStep: number): void;
    private drawTerrain;
    private drawMarkers;
    /**
     * @param pinToRim keeps a marker on the edge of the circle pointing the way
     * it lies once it's further off than the view radius, instead of dropping it.
     */
    private drawMarker;
    private drawPlayer;
    private drawNorth;
    /** What the map is centred on and pointed by: the vehicle if driving, else the character. */
    private subject;
    /**
     * Lit from straight above, the world comes back as a pale wash with nothing
     * for markers to stand out against. This pulls contrast up and brightness
     * down so it reads as a map.
     */
    private static tone;
}
