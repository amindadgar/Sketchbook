import * as CANNON from 'cannon';
import * as THREE from 'three';
import { ICollider } from '../../interfaces/ICollider';
import { Object3D } from 'three';
export declare class TrimeshCollider implements ICollider {
    /**
     * cannon keeps a trimesh's indices in an Int16Array, so a shape can't
     * address more vertices than this. Bigger meshes are cut into several
     * shapes on the one body.
     */
    private static readonly MAX_VERTICES;
    mesh: any;
    options: any;
    body: CANNON.Body;
    debugModel: any;
    constructor(mesh: Object3D, options: any);
    /**
     * The mesh's triangles in its own frame, with its scale baked in, since a
     * cannon shape can be moved and turned but not scaled. Local, like the
     * position and rotation the body is given.
     */
    static shapesFromMesh(mesh: THREE.Mesh): CANNON.Shape[];
}
