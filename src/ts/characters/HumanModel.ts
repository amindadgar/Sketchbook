import * as THREE from 'three';

/**
 * The people. Built by tools/humans/build_character.py from MakeHuman's CC0
 * assets: one skinned mesh, one texture atlas, and a Mixamo-named skeleton
 * with the game's whole animation set retargeted onto it.
 */
export class HumanModel
{
	/** The player and everyone else in a party, with the animations. */
	public static readonly PLAYER: string = 'build/assets/humans/player.glb';

	/** Bone names, as three.js has them once the colons are gone. */
	public static readonly HEAD: string = 'mixamorigHead';
	public static readonly RIGHT_HAND: string = 'mixamorigRightHand';

	/**
	 * Gives a human's material a shirt colour. The model carries a mask
	 * attribute that's 1 on the shirt and 0 everywhere else, so one colour
	 * multiplied in through it recolours the shirt without touching skin,
	 * jeans or hair, and the character stays a single draw call.
	 */
	public static prepareMaterial(material: THREE.MeshStandardMaterial): void
	{
		if (material.userData.shirtTint !== undefined) return;

		const tint = { value: new THREE.Color(1, 1, 1) };
		material.userData.shirtTint = tint;
		material.userData.shaderKey = 'human';
		material.roughness = 0.75;

		material.onBeforeCompile = (shader) =>
		{
			shader.uniforms.shirtTint = tint;

			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nattribute float _tintmask;\nvarying float vTintMask;')
				.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTintMask = _tintmask;');

			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nuniform vec3 shirtTint;\nvarying float vTintMask;')
				.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), shirtTint, vTintMask);');
		};
	}

	/** Whether this material came from one of the human models. */
	public static isHumanMaterial(material: any): boolean
	{
		return material !== undefined && material !== null && material.name === 'Human';
	}
}
