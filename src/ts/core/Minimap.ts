import * as THREE from 'three';

import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { EntityType } from '../enums/EntityType';

/**
 * A round, north-up minimap centred on the player.
 *
 * The whole world is rendered from overhead once when loading finishes and kept
 * as a still image; each frame just blits the patch of it around the player and
 * draws markers on top. Re-rendering the scene every frame would mean paying for
 * the entire world twice over to draw a handful of dots.
 */
export class Minimap implements IUpdatable
{
	// After characters and vehicles have moved, so markers aren't a frame behind
	public updateOrder: number = 15;

	private static readonly SNAPSHOT_WIDTH: number = 1024;
	private static readonly SIZE: number = 180;
	/** How far from the player the rim of the circle sits, in metres. */
	private static readonly VIEW_RADIUS: number = 100;

	private world: World;
	private canvas: HTMLCanvasElement;
	private context: CanvasRenderingContext2D;

	private snapshot: HTMLCanvasElement;
	private snapshotScaleX: number;
	private snapshotScaleZ: number;

	constructor(world: World)
	{
		this.world = world;

		// Sized from a constant rather than measured: the UI is still hidden
		// behind the menu at this point, so measuring would return zero
		let container = document.getElementById('minimap');
		container.style.width = Minimap.SIZE + 'px';
		container.style.height = Minimap.SIZE + 'px';

		this.canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
		this.canvas.width = Minimap.SIZE;
		this.canvas.height = Minimap.SIZE;
		this.context = this.canvas.getContext('2d');

		this.world.registerUpdatable(this);
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

		renderer.setRenderTarget(target);
		renderer.render(this.world.graphicsWorld, camera);
		renderer.setRenderTarget(null);

		let pixels = new Uint8Array(pixelWidth * pixelHeight * 4);
		renderer.readRenderTargetPixels(target, 0, 0, pixelWidth, pixelHeight, pixels);
		target.dispose();

		this.snapshot = document.createElement('canvas');
		this.snapshot.width = pixelWidth;
		this.snapshot.height = pixelHeight;
		this.snapshotScaleX = pixelWidth / width;
		this.snapshotScaleZ = pixelHeight / depth;

		let image = this.snapshot.getContext('2d').createImageData(pixelWidth, pixelHeight);

		// WebGL hands pixels back bottom row first, canvas wants top row first
		let rowBytes = pixelWidth * 4;
		for (let row = 0; row < pixelHeight; row++)
		{
			let from = (pixelHeight - row - 1) * rowBytes;
			let to = row * rowBytes;

			for (let i = 0; i < rowBytes; i += 4)
			{
				image.data[to + i] = Minimap.tone(pixels[from + i]);
				image.data[to + i + 1] = Minimap.tone(pixels[from + i + 1]);
				image.data[to + i + 2] = Minimap.tone(pixels[from + i + 2]);
				image.data[to + i + 3] = 255;
			}
		}

		this.snapshot.getContext('2d').putImageData(image, 0, 0);
	}

	public update(timeStep: number): void
	{
		// Folded away to a button on phones, and drawing a map nobody can see is
		// work a phone can't spare
		if (this.canvas.offsetParent === null) return;

		let size = Minimap.SIZE;
		let centre = size / 2;
		let context = this.context;

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

		this.drawPlayer(subject);
		this.drawNorth();
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
			let color = (vehicle.entityType === EntityType.Airplane || vehicle.entityType === EntityType.Helicopter)
				? 'rgba(120, 220, 255, 0.75)'
				: 'rgba(255, 255, 255, 0.55)';

			this.drawMarker(focus, vehicle.position, color, 2.5, false);
		});

		// Everyone else stays visible however far off they are, pinned to the rim
		this.world.characters.forEach((character) =>
		{
			if (character === this.world.localCharacter) return;
			if (character.playerColor === undefined) return;

			this.drawMarker(focus, character.position, character.playerColor, 4, true);
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

	private drawPlayer(subject: THREE.Object3D): void
	{
		let centre = Minimap.SIZE / 2;

		let quaternion = new THREE.Quaternion();
		subject.getWorldQuaternion(quaternion);
		let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);

		let context = this.context;
		context.save();
		context.translate(centre, centre);
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

	private drawNorth(): void
	{
		let context = this.context;

		context.save();
		context.font = '700 12px Solway, Trebuchet MS, sans-serif';
		context.textAlign = 'center';
		context.textBaseline = 'middle';

		context.lineWidth = 3;
		context.strokeStyle = 'rgba(0, 0, 0, 0.65)';
		context.strokeText('N', Minimap.SIZE / 2, 11);

		context.fillStyle = '#ffffff';
		context.fillText('N', Minimap.SIZE / 2, 11);
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
	private static tone(value: number): number
	{
		return THREE.MathUtils.clamp(((value - 128) * 1.45 + 128) * 0.7, 0, 255);
	}
}
