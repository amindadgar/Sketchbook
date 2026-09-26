import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
/**
 * A glTF loader that can read the compressed models. The people and the city
 * props are packed with meshopt, which roughly quarters their download and
 * decodes in a few milliseconds.
 */
export declare function createGLTFLoader(): GLTFLoader;
