import { JobSystem } from './JobSystem';
import { TaxiJob } from './TaxiJob';
import { StickUpJob } from './StickUpJob';
import { HoldUpJob } from './HoldUpJob';
import { CourierJob } from './CourierJob';
import { ChopShopJob } from './ChopShopJob';
import { StreetRaceJob } from './StreetRaceJob';
import { BountyJob } from './BountyJob';
import { HeistJob } from './HeistJob';

/** Every job on the board, in the order it lists them. */
export function registerJobs(system: JobSystem): void
{
	system.register(new TaxiJob(system));
	system.register(new StickUpJob(system));
	system.register(new HoldUpJob(system));
	system.register(new CourierJob(system));
	system.register(new ChopShopJob(system));
	system.register(new StreetRaceJob(system));
	system.register(new BountyJob(system));
	system.register(new HeistJob(system));
}
