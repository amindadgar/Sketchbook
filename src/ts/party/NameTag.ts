import * as THREE from 'three';

/**
 * A floating label drawn from a canvas texture.
 * Sprites always face the camera, so there's no per frame billboarding to do.
 */
export class NameTag extends THREE.Sprite
{
	private static readonly CANVAS_WIDTH: number = 320;
	private static readonly CANVAS_HEIGHT: number = 80;

	private canvas: HTMLCanvasElement;
	private canvasTexture: THREE.CanvasTexture;

	constructor(text: string, color: string)
	{
		let canvas = document.createElement('canvas');
		canvas.width = NameTag.CANVAS_WIDTH;
		canvas.height = NameTag.CANVAS_HEIGHT;

		let texture = new THREE.CanvasTexture(canvas);
		texture.minFilter = THREE.LinearFilter;

		super(new THREE.SpriteMaterial({
			map: texture,
			transparent: true,
			depthTest: true
		}));

		this.canvas = canvas;
		this.canvasTexture = texture;

		// Roughly 0.85 world units wide, keeping the canvas aspect ratio
		this.scale.set(0.85, 0.85 * (NameTag.CANVAS_HEIGHT / NameTag.CANVAS_WIDTH), 1);

		this.setText(text, color);
	}

	public setText(text: string, color: string): void
	{
		const w = NameTag.CANVAS_WIDTH;
		const h = NameTag.CANVAS_HEIGHT;
		let ctx = this.canvas.getContext('2d');

		ctx.clearRect(0, 0, w, h);

		// Plate, dark enough to stay readable against the sky and the ground
		ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
		this.roundedRect(ctx, 4, 4, w - 8, h - 20, 14);
		ctx.fill();

		// The player's colour, so a tag matches the body and car it belongs to
		ctx.fillStyle = color;
		this.roundedRect(ctx, 4, h - 22, w - 8, 10, 5);
		ctx.fill();

		ctx.font = '600 34px Solway, Trebuchet MS, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#ffffff';
		ctx.fillText(this.truncate(ctx, text, w - 28), w / 2, (h - 16) / 2 + 2);

		this.canvasTexture.needsUpdate = true;
	}

	public dispose(): void
	{
		this.canvasTexture.dispose();
		(this.material as THREE.SpriteMaterial).dispose();
	}

	private truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string
	{
		if (ctx.measureText(text).width <= maxWidth) return text;

		while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth)
		{
			text = text.slice(0, -1);
		}

		return text + '…';
	}

	private roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void
	{
		r = Math.min(r, h / 2, w / 2);

		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}
}
