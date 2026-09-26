import * as THREE from 'three';

import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { EntityType } from '../enums/EntityType';

/**
 * A round, north-up minimap centred on the player, which opens out into a map
 * of the whole world.
 *
 * The whole world is rendered from overhead once when loading finishes and kept
 * as a still image; each frame just blits the patch of it around the player and
 * draws markers on top. Re-rendering the scene every frame would mean paying for
 * the entire world twice over to draw a handful of dots.
 */
export class Minimap implements IUpdatable
{
	private static scratch: THREE.Vector3 = new THREE.Vector3();

	// After characters and vehicles have moved, so markers aren't a frame behind
	public updateOrder: number = 15;

	private static readonly SNAPSHOT_WIDTH: number = 2048;
	private static readonly SIZE: number = 180;
	/** How far from the player the rim of the circle sits, in metres. */
	private static readonly VIEW_RADIUS: number = 100;
	/** The big map never grows past this, however big the screen. */
	private static readonly FULL_MAX: number = 940;

	/** Names on the big map, made up like the rest of the place. */
	private static readonly PLACES: { name: string, x: number, z: number }[] = [
		{ name: 'DOWNTOWN', x: -708, z: -10 },
		{ name: 'CENTRAL PARK', x: -708, z: 240 },
		{ name: 'THE DOCKS', x: -420, z: -400 },
		{ name: 'OCEAN BEACH', x: -367, z: 330 },
		{ name: 'WESTSIDE', x: -930, z: 250 },
		{ name: 'NORTH END', x: -860, z: -420 },
		{ name: 'BAY BRIDGE', x: -300, z: 44 },
		{ name: 'THE ISLAND', x: 0, z: -20 },
	];

	/** Opened out to the whole world rather than the patch round the player. */
	public expanded: boolean = false;

	private world: World;
	private container: HTMLElement;
	private canvas: HTMLCanvasElement;
	private context: CanvasRenderingContext2D;

	private snapshot: HTMLCanvasElement;
	private snapshotScaleX: number;
	private snapshotScaleZ: number;

	/** The big map's size on screen, and the window size it was worked out for. */
	private fullSize: number = 0;
	private fullRatio: number = 1;
	private laidOutFor: string = '';

	constructor(world: World)
	{
		this.world = world;

		// Sized from a constant rather than measured: the UI is still hidden
		// behind the menu at this point, so measuring would return zero
		this.container = document.getElementById('minimap');
		this.canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
		this.context = this.canvas.getContext('2d');
		this.layoutSmall();

		this.world.registerUpdatable(this);
	}

	public toggleExpanded(): void
	{
		this.setExpanded(!this.expanded);
	}

	public setExpanded(expanded: boolean): void
	{
		if (expanded === this.expanded) return;
		this.expanded = expanded;
		this.container.classList.toggle('expanded', expanded);
		document.body.classList.toggle('map-open', expanded);

		if (expanded) this.layoutFull();
		else this.layoutSmall();
	}

	private layoutSmall(): void
	{
		this.container.style.width = Minimap.SIZE + 'px';
		this.container.style.height = Minimap.SIZE + 'px';
		this.canvas.width = Minimap.SIZE;
		this.canvas.height = Minimap.SIZE;
		this.canvas.style.width = '';
		this.canvas.style.height = '';
	}

	/** What the big map's size depends on: the window, and the screen it's on. */
	private static layoutKey(): string
	{
		return window.innerWidth + 'x' + window.innerHeight + '@' + Math.min(2, window.devicePixelRatio || 1);
	}

	/** As big as fits the window with a margin, drawn at the screen's own resolution. */
	private layoutFull(): void
	{
		let size = Math.floor(Math.min(window.innerWidth * 0.92, window.innerHeight * 0.88, Minimap.FULL_MAX));
		let ratio = Math.min(2, window.devicePixelRatio || 1);
		this.fullSize = size;
		this.fullRatio = ratio;
		this.laidOutFor = Minimap.layoutKey();

		this.container.style.width = size + 'px';
		this.container.style.height = size + 'px';
		this.canvas.width = Math.round(size * ratio);
		this.canvas.height = Math.round(size * ratio);
		this.canvas.style.width = size + 'px';
		this.canvas.style.height = size + 'px';
	}

	/** Renders the world from directly overhead and keeps it as the backdrop. */
	public capture(): void
	{
		let bounds = this.world.worldBounds;
		let width = bounds.maxX - bounds.minX;
		let depth = bounds.maxZ - bounds.minZ;

		let pixelWidth = Minimap.SNAPSHOT_WIDTH;
		let pixelHeight = Math.round(pixelWidth * (depth / width));

		let camera = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 1, 2000);
		camera.position.set(bounds.minX + width / 2, 1000, bounds.minZ + depth / 2);
		// Looking straight down with -Z upward puts north at the top of the image
		camera.up.set(0, 0, -1);
		camera.lookAt(camera.position.x, 0, camera.position.z);

		let target = new THREE.WebGLRenderTarget(pixelWidth, pixelHeight);
		let renderer = this.world.renderer;

		// Haze would wash out a picture taken from a kilometre up
		let fog = this.world.graphicsWorld.fog;
		this.world.graphicsWorld.fog = null;
		renderer.setRenderTarget(target);
		renderer.render(this.world.graphicsWorld, camera);
		renderer.setRenderTarget(null);
		this.world.graphicsWorld.fog = fog;

		let pixels = new Uint8Array(pixelWidth * pixelHeight * 4);
		renderer.readRenderTargetPixels(target, 0, 0, pixelWidth, pixelHeight, pixels);
		target.dispose();

		this.snapshot = document.createElement('canvas');
		this.snapshot.width = pixelWidth;
		this.snapshot.height = pixelHeight;
		this.snapshotScaleX = pixelWidth / width;
		this.snapshotScaleZ = pixelHeight / depth;

		let image = this.snapshot.getContext('2d').createImageData(pixelWidth, pixelHeight);

		// The tone curve worked out once per possible value rather than per pixel:
		// four million pixels of Math.pow is a noticeable stall on a phone
		let tone = new Uint8ClampedArray(256);
		for (let value = 0; value < 256; value++) tone[value] = Minimap.tone(value);

		// WebGL hands pixels back bottom row first, canvas wants top row first
		let data = image.data;
		let rowBytes = pixelWidth * 4;
		for (let row = 0; row < pixelHeight; row++)
		{
			let from = (pixelHeight - row - 1) * rowBytes;
			let to = row * rowBytes;

			for (let i = 0; i < rowBytes; i += 4)
			{
				data[to + i] = tone[pixels[from + i]];
				data[to + i + 1] = tone[pixels[from + i + 1]];
				data[to + i + 2] = tone[pixels[from + i + 2]];
				data[to + i + 3] = 255;
			}
		}

		this.snapshot.getContext('2d').putImageData(image, 0, 0);
	}

	public update(timeStep: number): void
	{
		// Folded away to a button on phones, and drawing a map nobody can see is
		// work a phone can't spare
		if (this.canvas.offsetParent === null) return;

		if (this.expanded) this.drawFull();
		else this.drawRound();
	}

	// The corner map

	private drawRound(): void
	{
		let size = Minimap.SIZE;
		let centre = size / 2;
		let context = this.context;

		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, size, size);

		let subject = this.subject();
		if (subject === undefined) return;

		let focus = new THREE.Vector3();
		subject.getWorldPosition(focus);

		context.save();
		context.beginPath();
		context.arc(centre, centre, centre, 0, Math.PI * 2);
		context.clip();

		// Shows through wherever the view runs past the edge of the world
		context.fillStyle = '#10141a';
		context.fillRect(0, 0, size, size);

		this.drawTerrain(focus);
		this.drawMarkers(focus);

		context.restore();

		this.drawPlayer(subject, centre, centre, 1);
		this.drawNorth(size / 2, 11);
	}

	private drawTerrain(focus: THREE.Vector3): void
	{
		if (this.snapshot === undefined) return;

		let bounds = this.world.worldBounds;
		let sourceWidth = 2 * Minimap.VIEW_RADIUS * this.snapshotScaleX;
		let sourceHeight = 2 * Minimap.VIEW_RADIUS * this.snapshotScaleZ;

		this.context.drawImage(
			this.snapshot,
			(focus.x - bounds.minX) * this.snapshotScaleX - sourceWidth / 2,
			(focus.z - bounds.minZ) * this.snapshotScaleZ - sourceHeight / 2,
			sourceWidth, sourceHeight,
			0, 0, Minimap.SIZE, Minimap.SIZE
		);
	}

	private drawMarkers(focus: THREE.Vector3): void
	{
		// Parked rides worth walking to, but only ones actually nearby: pinning
		// every car in the world to the rim would leave a ring of clutter
		this.world.vehicles.forEach((vehicle) =>
		{
			this.drawMarker(focus, vehicle.position, Minimap.vehicleColor(vehicle), 2.5, false);
		});

		// Everyone else stays visible however far off they are, pinned to the rim.
		// World position, since anyone sitting in a car is parented to it and
		// their own position is only where in the car they are.
		this.world.characters.forEach((character) =>
		{
			if (character === this.world.localCharacter) return;
			if (character.playerColor === undefined) return;

			this.drawMarker(focus, character.getWorldPosition(Minimap.scratch), character.playerColor, 4, true);
		});
	}

	/**
	 * @param pinToRim keeps a marker on the edge of the circle pointing the way
	 * it lies once it's further off than the view radius, instead of dropping it.
	 */
	private drawMarker(focus: THREE.Vector3, position: THREE.Vector3, color: string, radius: number, pinToRim: boolean): void
	{
		let centre = Minimap.SIZE / 2;
		let scale = centre / Minimap.VIEW_RADIUS;

		let x = (position.x - focus.x) * scale;
		let y = (position.z - focus.z) * scale;
		let distance = Math.sqrt(x * x + y * y);
		let limit = centre - radius - 3;

		let offMap = distance > limit;
		if (offMap)
		{
			if (!pinToRim) return;

			x *= limit / distance;
			y *= limit / distance;
		}

		let context = this.context;
		context.save();
		context.translate(centre + x, centre + y);

		if (offMap)
		{
			// A wedge aimed outward reads as "that way", where a dot would just
			// look like somebody standing on the rim
			context.rotate(Math.atan2(x, -y));
			context.beginPath();
			context.moveTo(0, -radius - 2);
			context.lineTo(radius, radius);
			context.lineTo(-radius, radius);
			context.closePath();
		}
		else
		{
			context.beginPath();
			context.arc(0, 0, radius, 0, Math.PI * 2);
		}

		context.fillStyle = color;
		context.fill();

		if (radius > 3)
		{
			context.lineWidth = 1.5;
			context.strokeStyle = '#ffffff';
			context.stroke();
		}

		context.restore();
	}

	// The whole world

	/**
	 * Everything at once: the whole of the world fitted into a square, every
	 * vehicle and player on it, and the names of the places.
	 */
	private drawFull(): void
	{
		if (this.laidOutFor !== Minimap.layoutKey()) this.layoutFull();

		let size = this.fullSize;
		let context = this.context;
		context.setTransform(this.fullRatio, 0, 0, this.fullRatio, 0, 0);

		// The sea, which is what lies past the edge of the world anyway
		context.fillStyle = '#0f2233';
		context.fillRect(0, 0, size, size);

		let bounds = this.world.worldBounds;
		let width = bounds.maxX - bounds.minX;
		let depth = bounds.maxZ - bounds.minZ;
		let scale = size / Math.max(width, depth);
		let left = (size - width * scale) / 2;
		let top = (size - depth * scale) / 2;
		let toMap = (x: number, z: number) => [left + (x - bounds.minX) * scale, top + (z - bounds.minZ) * scale];

		if (this.snapshot !== undefined)
		{
			context.imageSmoothingEnabled = true;
			context.imageSmoothingQuality = 'high';
			context.drawImage(this.snapshot, left, top, width * scale, depth * scale);
		}

		this.drawPlaces(toMap, size);

		// Every vehicle, since on this map there's room for all of them
		this.world.vehicles.forEach((vehicle) =>
		{
			let [x, y] = toMap(vehicle.position.x, vehicle.position.z);
			this.dot(x, y, 3.2, Minimap.vehicleColor(vehicle, 0.95), 'rgba(0, 0, 0, 0.6)');
		});

		this.world.characters.forEach((character) =>
		{
			if (character === this.world.localCharacter) return;
			if (character.playerColor === undefined) return;

			let position = character.getWorldPosition(Minimap.scratch);
			let [x, y] = toMap(position.x, position.z);
			this.dot(x, y, 5.5, character.playerColor, '#ffffff');
			if (character.playerName !== undefined) this.label(character.playerName, x, y - 13, 11, '#ffffff');
		});

		let subject = this.subject();
		if (subject !== undefined)
		{
			let position = subject.getWorldPosition(new THREE.Vector3());
			let [x, y] = toMap(position.x, position.z);

			// A pulse round the player, so they're found at a glance
			let pulse = (performance.now() / 1000) % 1.4 / 1.4;
			context.beginPath();
			context.arc(x, y, 8 + pulse * 18, 0, Math.PI * 2);
			context.strokeStyle = 'rgba(255, 255, 255, ' + (0.7 * (1 - pulse)).toFixed(3) + ')';
			context.lineWidth = 2;
			context.stroke();

			this.drawPlayer(subject, x, y, 1.35);
		}

		this.drawNorth(size - 22, 22);
		this.label('N  close map', size / 2, size - 16, 12, 'rgba(255, 255, 255, 0.8)');
	}

	private drawPlaces(toMap: (x: number, z: number) => number[], size: number): void
	{
		let fontSize = Math.max(10, Math.round(size / 62));
		for (const place of Minimap.PLACES)
		{
			let [x, y] = toMap(place.x, place.z);
			this.label(place.name, x, y, fontSize, 'rgba(255, 255, 255, 0.78)', 1.5);
		}
	}

	private dot(x: number, y: number, radius: number, fill: string, stroke: string): void
	{
		let context = this.context;
		context.beginPath();
		context.arc(x, y, radius, 0, Math.PI * 2);
		context.fillStyle = fill;
		context.fill();
		context.lineWidth = 1.5;
		context.strokeStyle = stroke;
		context.stroke();
	}

	private label(text: string, x: number, y: number, fontSize: number, color: string, spacing: number = 0): void
	{
		let context = this.context;
		context.save();
		context.font = '700 ' + fontSize + 'px Solway, Trebuchet MS, sans-serif';
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		if (spacing > 0) (context as any).letterSpacing = spacing + 'px';
		context.lineWidth = 3;
		context.strokeStyle = 'rgba(0, 0, 0, 0.7)';
		context.strokeText(text, x, y);
		context.fillStyle = color;
		context.fillText(text, x, y);
		context.restore();
	}

	// Shared by both

	private static vehicleColor(vehicle: any, alpha?: number): string
	{
		let aircraft = vehicle.entityType === EntityType.Airplane || vehicle.entityType === EntityType.Helicopter;
		if (aircraft) return 'rgba(120, 220, 255, ' + (alpha !== undefined ? alpha : 0.75) + ')';
		return 'rgba(255, 255, 255, ' + (alpha !== undefined ? alpha : 0.55) + ')';
	}

	private drawPlayer(subject: THREE.Object3D, x: number, y: number, scale: number): void
	{
		let quaternion = new THREE.Quaternion();
		subject.getWorldQuaternion(quaternion);
		let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);

		let context = this.context;
		context.save();
		context.translate(x, y);
		context.scale(scale, scale);
		// North is up, so world -Z is the zero angle
		context.rotate(Math.atan2(forward.x, -forward.z));

		context.beginPath();
		context.moveTo(0, -8);
		context.lineTo(6, 7);
		context.lineTo(0, 4);
		context.lineTo(-6, 7);
		context.closePath();

		let local = this.world.localCharacter;
		context.fillStyle = (local !== undefined && local.playerColor !== undefined) ? local.playerColor : '#ffffff';
		context.fill();
		context.lineWidth = 1.5;
		context.strokeStyle = '#ffffff';
		context.stroke();
		context.restore();
	}

	private drawNorth(x: number, y: number): void
	{
		let context = this.context;

		context.save();
		context.font = '700 12px Solway, Trebuchet MS, sans-serif';
		context.textAlign = 'center';
		context.textBaseline = 'middle';

		context.lineWidth = 3;
		context.strokeStyle = 'rgba(0, 0, 0, 0.65)';
		context.strokeText('N', x, y);

		context.fillStyle = '#ffffff';
		context.fillText('N', x, y);
		context.restore();
	}

	/** What the map is centred on and pointed by: the vehicle if driving, else the character. */
	private subject(): THREE.Object3D
	{
		let local = this.world.localCharacter;
		if (local === undefined) return undefined;

		if (local.occupyingSeat !== null)
		{
			return local.occupyingSeat.vehicle as unknown as THREE.Object3D;
		}

		return local;
	}

	/**
	 * Lit from straight above, the world comes back as a pale wash with nothing
	 * for markers to stand out against. This pulls contrast up and brightness
	 * down so it reads as a map.
	 */
	/** The render comes back in linear light; this brings it to screen brightness. */
	private static tone(value: number): number
	{
		let encoded = Math.pow(Math.min(1, (value / 255) * 1.15), 1 / 2.2) * 255;
		return THREE.MathUtils.clamp((encoded - 128) * 1.15 + 128, 0, 255);
	}
}
