import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * A round, north-up minimap centred on the player, which opens out into a map
 * of the whole world.
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
    private dot;
    private label;
    private static vehicleColor;
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
