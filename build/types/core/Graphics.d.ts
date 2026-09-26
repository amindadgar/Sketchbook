import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
export type GraphicsQuality = 'High' | 'Medium' | 'Low';
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
export declare class Graphics {
    composer: EffectComposer;
    quality: GraphicsQuality;
    private renderer;
    private renderPass;
    private aoPass;
    private bloomPass;
    private outputPass;
    private fxaaPass;
    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera);
    setQuality(quality: GraphicsQuality): void;
    /** Brighter glow at night, when the lamps and windows are what's worth seeing. */
    setBloom(strength: number): void;
    setSize(width: number, height: number): void;
    render(): void;
    private bufferSize;
}
