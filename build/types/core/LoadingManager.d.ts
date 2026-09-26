import { LoadingTrackerEntry } from './LoadingTrackerEntry';
import { Scenario } from '../world/Scenario';
import { World } from '../world/World';
export declare class LoadingManager {
    firstLoad: boolean;
    onFinishedCallback: () => void;
    /**
     * Which scenario launch this is loading for. A launch that starts while
     * another is still downloading leaves this one finishing late, and it must
     * not then pop a briefing or lift the loading screen over the new one.
     */
    generation: number;
    private world;
    private gltfLoader;
    private loadingTracker;
    constructor(world: World);
    loadGLTF(path: string, onLoadingFinished: (gltf: any) => void): void;
    addLoadingEntry(path: string): LoadingTrackerEntry;
    doneLoading(trackerEntry: LoadingTrackerEntry): void;
    createWelcomeScreenCallback(scenario: Scenario): void;
    private getLoadingPercentage;
    private isLoadingDone;
}
