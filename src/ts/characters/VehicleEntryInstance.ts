import * as THREE from 'three';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { Character } from './Character';

export class VehicleEntryInstance
{
	public character: Character;
	public targetSeat: VehicleSeat;
	public entryPoint: THREE.Object3D;
	public wantsToDrive: boolean = false;
	/** Let go of forward at the door to wait for the party to confirm the seat. */
	private heldAtDoor: boolean = false;

	constructor(character: Character)
	{
		this.character = character;
	}

	public update(timeStep: number): void
	{
		// Somebody else sat down in it on the way over
		if (!this.character.canUseSeat(this.targetSeat))
		{
			this.character.cancelVehicleEntry();
			return;
		}

		let entryPointWorldPos = new THREE.Vector3();
		this.entryPoint.getWorldPosition(entryPointWorldPos);
		let viewVector = new THREE.Vector3().subVectors(entryPointWorldPos, this.character.position);
		this.character.setOrientation(viewVector);
		
		let heightDifference = viewVector.y;
		viewVector.y = 0;
		let atDoor = viewVector.length() < 0.2 && heightDifference < 2;

		// Drifted off while waiting, so walk back up to it
		if (this.heldAtDoor && !atDoor)
		{
			// Pressed with the instance set aside, the same order findVehicleToEnter
			// uses: a direction pressed during an entry otherwise means backing out
			this.heldAtDoor = false;
			this.character.vehicleEntryInstance = null;
			this.character.triggerAction('up', true);
			this.character.vehicleEntryInstance = this;
		}

		if (this.character.charState.canEnterVehicles && atDoor)
		{
			// In a party the door waits for the relay to say the seat is ours,
			// which it has almost always done by the time anyone gets there.
			// Standing still meanwhile, rather than circling the door handle.
			let world = this.character.world;
			if (world.localCharacter === this.character && world.party !== undefined
				&& !world.party.isSeatConfirmed(this.targetSeat))
			{
				if (this.character.actions.up.isPressed) this.character.triggerAction('up', false);
				this.heldAtDoor = true;
				return;
			}

			this.character.enterVehicle(this.targetSeat, this.entryPoint);
		}
	}
}