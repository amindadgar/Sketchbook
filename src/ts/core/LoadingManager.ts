import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { LoadingTrackerEntry } from './LoadingTrackerEntry';
import { UIManager } from './UIManager';
import { Scenario } from '../world/Scenario';
import Swal from 'sweetalert2';
import { World } from '../world/World';

export class LoadingManager
{
	public firstLoad: boolean = true;
	public onFinishedCallback: () => void;
	/**
	 * Which scenario launch this is loading for. A launch that starts while
	 * another is still downloading leaves this one finishing late, and it must
	 * not then pop a briefing or lift the loading screen over the new one.
	 */
	public generation: number;
	
	private world: World;
	private gltfLoader: GLTFLoader;
	private loadingTracker: LoadingTrackerEntry[] = [];

	constructor(world: World)
	{
		this.world = world;
		this.gltfLoader = new GLTFLoader();

		this.world.setTimeScale(0);
		UIManager.setUserInterfaceVisible(false);
		UIManager.setLoadingScreenVisible(true);
	}

	public loadGLTF(path: string, onLoadingFinished: (gltf: any) => void): void
	{
		let trackerEntry = this.addLoadingEntry(path);

		this.gltfLoader.load(path,
		(gltf)  =>
		{
			onLoadingFinished(gltf);
			this.doneLoading(trackerEntry);
		},
		(xhr) =>
		{
			if ( xhr.lengthComputable )
			{
				trackerEntry.progress = xhr.loaded / xhr.total;
			}
		},
		(error)  =>
		{
			console.error(error);
		});
	}

	public addLoadingEntry(path: string): LoadingTrackerEntry
	{
		let entry = new LoadingTrackerEntry(path);
		this.loadingTracker.push(entry);

		return entry;
	}

	public doneLoading(trackerEntry: LoadingTrackerEntry): void
	{
		trackerEntry.finished = true;
		trackerEntry.progress = 1;

		if (this.generation !== undefined && this.generation !== this.world.scenarioGeneration) return;

		if (this.isLoadingDone())
		{
			if (this.onFinishedCallback !== undefined) 
			{
				this.onFinishedCallback();
			}
			else
			{
				UIManager.setUserInterfaceVisible(true);
			}

			UIManager.setLoadingScreenVisible(false);
		}
	}

	public createWelcomeScreenCallback(scenario: Scenario): void
	{
		if (this.onFinishedCallback === undefined)
		{
			this.onFinishedCallback = () =>
			{
				this.world.update(1, 1);
	
				Swal.fire({
					title: scenario.descriptionTitle,
					html: scenario.descriptionContent,
					confirmButtonText: 'Play',
					buttonsStyling: false,
					onClose: () => {
						this.world.setTimeScale(1);
						UIManager.setUserInterfaceVisible(true);
					}
				});
			};
		}
	}

	private getLoadingPercentage(): number
	{
		let done = true;
		let total = 0;
		let finished = 0;

		for (const item of this.loadingTracker)
		{
			total++;
			finished += item.progress;
			if (!item.finished) done = false;
		}

		return (finished / total) * 100;
	}

	private isLoadingDone(): boolean
	{
		for (const entry of this.loadingTracker) {
			if (!entry.finished) return false;
		}
		return true;
	}
}