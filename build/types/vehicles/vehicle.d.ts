import { Character } from '../characters/Character';
import * as THREE from 'three';
import * as CANNON from 'cannon';
import { World } from '../world/World';
import { KeyBinding } from '../core/KeyBinding';
import { VehicleSeat } from './VehicleSeat';
import { Wheel } from './Wheel';
import { EntityType } from '../enums/EntityType';
import { IWorldEntity } from '../interfaces/IWorldEntity';
export declare abstract class Vehicle extends THREE.Object3D implements IWorldEntity {
    updateOrder: number;
    abstract entityType: EntityType;
    controllingCharacter: Character;
    actions: {
        [action: string]: KeyBinding;
    };
    rayCastVehicle: CANNON.RaycastVehicle;
    seats: VehicleSeat[];
    wheels: Wheel[];
    drive: string;
    camera: any;
    world: World;
    help: THREE.AxesHelper;
    collision: CANNON.Body;
    materials: THREE.Material[];
    spawnPoint: THREE.Object3D;
    engineSound: THREE.PositionalAudio;
    private modelContainer;
    private firstPerson;
    protected engineSoundPath: string;
    protected engineSoundRefDistance: number;
    private originalColors;
    private static readonly UNPAINTED;
    private enginePitch;
    private engineVolume;
    /**
     * Condition, 100 down to 0. Nothing about the handling depends on it: it
     * decides how hard the wreck smokes, which is the whole point of it. A
     * number the player can't see quietly throttling their engine would just
     * feel like the car had gone wrong.
     */
    integrity: number;
    /** Slower than this along the contact normal and it's a nudge, not a crash. */
    private static readonly IMPACT_FLOOR;
    /** Health lost per metre a second over the floor. */
    private static readonly IMPACT_DAMAGE;
    /** Condition lost per metre a second over the floor. */
    private static readonly IMPACT_WEAR;
    private static readonly SMOKE_BELOW;
    private impactCooldown;
    private smokeTimer;
    private headlights;
    private static lampTexture;
    private boundOnCollide;
    /**
     * Where the player driving this on another client last said it was. Only
     * their client simulates it for real, so here the body is steered after
     * those reports: velocity toward the pose rather than teleports with the
     * velocity zeroed, so it collides like a moving car, sounds like one, and
     * doesn't get argued with by everything that assumed a parked one.
     */
    private remoteTarget;
    private remoteSteering;
    /** Reports older than this mean the driver has gone quiet, so it coasts. */
    private static readonly REMOTE_FRESH;
    /** Further off than this and the body is put there rather than pulled. */
    private static readonly REMOTE_SNAP;
    /** How hard the pose error is pulled in, per second. */
    private static readonly REMOTE_GAIN;
    /** Reports are extrapolated at most this far, so a stall doesn't fling it. */
    private static readonly REMOTE_LEAD;
    /** The same force the handbrake and the race grid use. */
    private static readonly PARKING_BRAKE;
    private parked;
    /** Squeal, as loud as the tyres are sliding. Made the first time they do. */
    private screech;
    private screechTone;
    private screechPitch;
    private screechVolume;
    /** For a car driven on another client: its speed along itself last frame, and how hard it's slowing. */
    private lastAlong;
    private remoteBraking;
    private static contactVelocity;
    private static axle;
    private static right;
    constructor(gltf: any, handlingSetup?: any);
    noDirectionPressed(): boolean;
    update(timeStep: number): void;
    /** Braking with the pedal rather than a locked wheel, which only a car has. */
    protected isFootBraking(): boolean;
    /**
     * Which tyres are sliding and how hard: skidding sideways, locked by a
     * brake while the car moves, past their grip under power or braking, or
     * braked hard with the pedal. Those leave rubber on the road, and between
     * them set how loud the tyres squeal.
     */
    private updateTyres;
    private updateScreech;
    /** Stops the tyre squeal at once, for when the frame loop that fades it is about to stop. */
    silenceTyres(): void;
    private disposeScreech;
    forceCharacterOut(): void;
    onInputChange(): void;
    resetControls(): void;
    allowSleep(value: boolean): void;
    handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void;
    setFirstPersonView(value: boolean): void;
    toggleFirstPersonView(): void;
    triggerAction(actionName: string, value: boolean): void;
    handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void;
    handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void;
    handleMouseWheel(event: WheelEvent, value: number): void;
    inputReceiverInit(): void;
    inputReceiverUpdate(timeStep: number): void;
    setPosition(x: number, y: number, z: number): void;
    setSteeringValue(val: number): void;
    applyEngineForce(force: number): void;
    /**
     * Sets a stuck vehicle back on its wheels where it stands.
     *
     * A car that stops upside down rights itself already, but one wedged nose
     * first into a barrier is the right way up and going nowhere, and there was
     * no way out of that short of restarting the whole scenario. The heading is
     * kept and everything else about the rotation is thrown away.
     */
    recover(): void;
    /** The id vehicles are matched by across a party: the name of the spawn point. */
    getNetworkId(): string;
    /**
     * A pose report from whoever is driving this, or last drove it, on another
     * client. 'final' means they've let go and this is where it ended up.
     * Ignored while anyone local is at the wheel, whose simulation wins here.
     */
    setRemoteTarget(position: THREE.Vector3, quaternion: THREE.Quaternion, velocity: THREE.Vector3, angularVelocity: THREE.Vector3, final: boolean): void;
    /** A driver on another client is steering this right now. */
    isRemoteDriven(): boolean;
    /** Someone is at the wheel, here or on another client. For engines, rotors and lights. */
    hasDriver(): boolean;
    /** Back to local physics alone, for a scenario change or leaving the party. */
    clearRemoteTarget(): void;
    private followRemoteTarget;
    /** Puts the body exactly somewhere, for jumps too big to pull across. */
    private placeBody;
    /**
     * A vehicle nobody is driving puts its brakes on once it has slowed right
     * down. The tyres hold almost nothing by themselves, so a car left on a
     * slope otherwise creeps downhill for ever, a car bumped into rolls off
     * down the street, and in a party each client's copy creeps its own way
     * until they're nowhere near each other. Whoever takes the wheel next,
     * here or on another client, lets them off.
     */
    private updateParkingBrake;
    /** For controls held down as a driver takes over, which the parking brake coming off would undo. */
    protected reapplyHeldBrakes(): void;
    /** Local physics takes over from whatever velocity it last had, so it coasts. */
    private releaseRemoteSteering;
    /**
     * A pair of lamps at the front, lit after dark. Sprites rather than lights:
     * they're parented to the vehicle so they follow it for nothing, and the
     * point is that a car is visible in the dark, not that it lights the road.
     */
    setHeadlights(on: boolean): void;
    private static getLampTexture;
    /**
     * Cannon reports a collision once, on the frame the two bodies first touch,
     * to both of them. A crash is still several of those as the car tumbles, so
     * there's a short cooldown to stop one accident being billed five times.
     */
    private onCollide;
    /**
     * Hit by something while nobody is driving it. The parking brake stays on,
     * which locks the wheels rather than the car: a hit shoves it along in a
     * skid that its tyres soon stop. A shove from the local player's own car
     * is reported to the party until the car comes to rest, the way a car
     * someone has just got out of is.
     */
    private onShoved;
    /** A battered vehicle smokes, harder the worse it is, and only while running. */
    private updateSmoke;
    /**
     * How hard the tyres hold on sideways. Dropping it on the driven pair is
     * what turns the handbrake from a full stop into a slide.
     */
    setFrictionSlip(value: number, driveFilter?: string): void;
    setBrake(brakeForce: number, driveFilter?: string): void;
    addToWorld(world: World): void;
    removeFromWorld(world: World): void;
    /**
     * Creates a looping engine sound that travels with the vehicle.
     * The sound is a child of the vehicle's Object3D, so the 'updateMatrixWorld'
     * call in 'update' already moves the panner along with it.
     */
    protected setupEngineSound(world: World): void;
    /**
     * Feeds the engine sound. Pitch is a multiple of the sample's own pitch, both
     * values are lerped so gear shifts and throttle taps glide instead of clicking.
     */
    protected updateEngineSound(pitch: number, volume: number): void;
    /**
     * Paints the vehicle in the driver's colour. Wheels are left alone,
     * a bright red tyre reads as a bug rather than a livery.
     */
    setPlayerTint(color: string): void;
    /**
     * Bodywork gets the driver's colour; glass, lights, trim and tyres don't.
     * Matched on the material name, since that's all an imported model carries,
     * and a red windscreen reads as a bug rather than a paint job.
     */
    private static isUnpainted;
    clearPlayerTint(): void;
    protected disposeEngineSound(): void;
    readVehicleData(gltf: any): void;
    private connectSeats;
}
