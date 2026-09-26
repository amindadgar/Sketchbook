import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * A glTF loader that can read the compressed models. The people and the city
 * props are packed with meshopt, which roughly quarters their download and
 * decodes in a few milliseconds.
 */
export function createGLTFLoader(): GLTFLoader
{
	let loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);
	return loader;
}
