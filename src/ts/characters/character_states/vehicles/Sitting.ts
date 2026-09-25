import
{
	CharacterStateBase,
} from '../_stateLibrary';
import { Character } from '../../Character';
import { VehicleSeat } from 'src/ts/vehicles/VehicleSeat';
import { CloseVehicleDoorInside } from './CloseVehicleDoorInside';
import { SeatType } from '../../../enums/SeatType';
import { SwitchingSeats } from './SwitchingSeats';

export class Sitting extends CharacterStateBase
{
	private seat: VehicleSeat;

	constructor(character: Character, seat: VehicleSeat)
	{
		super(character);

		this.seat = seat;
		this.canFindVehiclesToEnter = false;

		this.character.world.updateControls([
			{
				keys: ['X'],
				desc: 'Switch seats',
			},
			{
				keys: ['F'],
				desc: 'Leave seat',
			}
		]);
		
		this.playAnimation('sitting', 0.1);
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		if (!this.seat.door?.achievingTargetRotation && this.seat.door?.rotation > 0 && this.noDirection())
		{
			this.character.setState(new CloseVehicleDoorInside(this.character, this.seat));
		}
		else if (this.character.vehicleEntryInstance !== null)
		{
			if (this.character.vehicleEntryInstance.wantsToDrive)
			{
				let switched = false;

				for (const possibleDriverSeat of this.seat.connectedSeats)
				{
					// Only across into an empty one. Sliding over regardless is
					// how two people came to be sitting in the one driver's seat.
					if (possibleDriverSeat.type === SeatType.Driver && this.character.canUseSeat(possibleDriverSeat))
					{
						if (this.seat.door?.rotation > 0) this.seat.door.physicsEnabled = true;
						this.character.setState(new SwitchingSeats(this.character, this.seat, possibleDriverSeat));
						switched = true;
						break;
					}
				}

				// Somebody is driving already, so this is a ride along
				if (!switched) this.character.vehicleEntryInstance = null;
			}
			else
			{
				this.character.vehicleEntryInstance = null;
			}
		}
	}

	public onInputChange(): void
	{
		if (this.character.actions.seat_switch.justPressed)
		{
			let free = this.seat.connectedSeats.find((seat) => this.character.canUseSeat(seat));
			if (free !== undefined) this.character.setState(new SwitchingSeats(this.character, this.seat, free));
		}

		if (this.character.actions.enter.justPressed)
		{
			this.character.exitVehicle();
			this.character.displayControls();
		}
	}
}