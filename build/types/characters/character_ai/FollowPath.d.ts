import { FollowTarget } from './FollowTarget';
import { ICharacterAI } from '../../interfaces/ICharacterAI';
import { PathNode } from '../../world/PathNode';
export declare class FollowPath extends FollowTarget implements ICharacterAI {
    nodeRadius: number;
    reverse: boolean;
    /** Read by the race system to work out who is where. */
    targetNode: PathNode;
    /** How many times this driver has been round, for the running order. */
    lapsDone: number;
    private staleTimer;
    private firstNode;
    constructor(firstNode: PathNode, nodeRadius: number);
    update(timeStep: number): void;
}
