import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { DeviceProfile } from './DeviceProfile';

export type GraphicsQuality = 'High' | 'Medium' | 'Low';

/**
 * Ambient occlusion works out the creases from a depth and normals render of
 * the scene. Anything that isn't a solid surface has to stay out of that, or
 * a glowing sprite comes out as a grey card with a shadow round it and the sky
 * box as a wall five hundred metres away.
 */
class SolidOcclusionPass extends GTAOPass
{
	public _overrideVisibility(): void
	{
		const cache = (this as any)._visibilityCache;

		this.scene.traverse((object: any) =>
		{
			if (!object.visible) return;

			let material = object.material;
			let seeThrough = material !== undefined && !Array.isArray(material) && material.transparent === true;

			if (object.isPoints || object.isLine || object.isLine2 || object.isSprite
				|| seeThrough || object.userData.noOcclusion === true)
			{
				object.visible = false;
				cache.push(object);
			}
		});
	}
}

/**
 * Everything between the scene and the screen.
 *
 * The scene renders into a half float buffer, so light is allowed to go past
 * white: the sun off a windscreen, a lit window at night. Ambient occlusion
 * darkens the creases where walls meet the pavement, bloom lets the brightest
 * of it glow, and the output pass tone maps the lot down to the screen before
 * FXAA smooths the edges.
 *
 * What a phone can afford is a lot less, so the expensive passes are only
 * switched on at the higher settings.
 */
export class Graphics
{
	public composer: EffectComposer;
	public quality: GraphicsQuality;

	private renderer: THREE.WebGLRenderer;
	private renderPass: RenderPass;
	private aoPass: SolidOcclusionPass;
	private bloomPass: UnrealBloomPass;
	private outputPass: OutputPass;
	private fxaaPass: FXAAPass;

	constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera)
	{
		this.renderer = renderer;

		let size = this.bufferSize();

		this.composer = new EffectComposer(renderer);
		this.renderPass = new RenderPass(scene, camera);
		this.composer.addPass(this.renderPass);

		this.aoPass = new SolidOcclusionPass(scene, camera, size.x, size.y);
		this.aoPass.blendIntensity = 0.85;
		this.aoPass.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.4, scale: 1.1, samples: 12 });
		this.aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
		this.composer.addPass(this.aoPass);

		this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.45, 2.2);
		this.composer.addPass(this.bloomPass);

		this.outputPass = new OutputPass();
		this.composer.addPass(this.outputPass);

		this.fxaaPass = new FXAAPass();
		this.composer.addPass(this.fxaaPass);

		this.setQuality(DeviceProfile.isTouch() ? 'Low' : 'High');
	}

	public setQuality(quality: GraphicsQuality): void
	{
		this.quality = quality;
		this.aoPass.enabled = quality === 'High';
		this.bloomPass.enabled = quality !== 'Low';
	}

	/** Brighter glow at night, when the lamps and windows are what's worth seeing. */
	public setBloom(strength: number): void
	{
		this.bloomPass.strength = strength;
	}

	public setSize(width: number, height: number): void
	{
		this.composer.setPixelRatio(this.renderer.getPixelRatio());
		this.composer.setSize(width, height);
	}

	public render(): void
	{
		this.composer.render();
	}

	private bufferSize(): THREE.Vector2
	{
		return this.renderer.getDrawingBufferSize(new THREE.Vector2());
	}
}
