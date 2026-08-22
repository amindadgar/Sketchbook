import * as THREE from 'three';
/**
 * A floating label drawn from a canvas texture.
 * Sprites always face the camera, so there's no per frame billboarding to do.
 */
export declare class NameTag extends THREE.Sprite {
    private static readonly CANVAS_WIDTH;
    private static readonly CANVAS_HEIGHT;
    private canvas;
    private canvasTexture;
    constructor(text: string, color: string);
    setText(text: string, color: string): void;
    dispose(): void;
    private truncate;
    private roundedRect;
}
