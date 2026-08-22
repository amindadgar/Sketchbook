import { World } from '../world/World';
import { EntityType } from '../enums/EntityType';
import { SeatType } from '../enums/SeatType';
import { DeviceProfile } from './DeviceProfile';

/** One on screen button: a label and the input it stands in for. */
interface TouchButtonSpec
{
	id: string;
	label: string;
	/** Keyboard code to synthesise, for everything the engine binds to a key. */
	key?: string;
	/** Mouse button index instead, for firing and aiming. */
	mouse?: number;
	/** Spans the pair of columns, for the odd one out at the bottom of a set. */
	wide?: boolean;
}

/**
 * Touch controls, built only when the device actually has a coarse pointer.
 *
 * Nothing here reaches into the game's own logic. A finger on the stick
 * dispatches the same key events a keyboard would, so every input receiver the
 * engine already has, on foot, in a car, in an aeroplane, keeps its own mapping
 * and none of them need to know touch exists. Desktop never constructs this
 * class at all.
 */
export class TouchControls
{
	/**
	 * What the buttons say and do depends on what the player is currently
	 * driving, so ENTER becomes EXIT and a helicopter gets a collective rather
	 * than a trigger. The grid is anchored to the bottom right corner and fills
	 * row by row, so the last entries keep their place as the set grows: put the
	 * buttons that mean the same thing everywhere at the end.
	 */
	private static readonly LAYOUTS: { [context: string]: TouchButtonSpec[] } = {
		'foot': [
			{ id: 'touch-jump', label: 'JUMP', key: 'Space' },
			{ id: 'touch-enter', label: 'ENTER', key: 'KeyF' },
		],
		'foot-armed': [
			{ id: 'touch-aim', label: 'AIM', mouse: 2 },
			{ id: 'touch-fire', label: 'FIRE', mouse: 0 },
			{ id: 'touch-jump', label: 'JUMP', key: 'Space' },
			{ id: 'touch-enter', label: 'ENTER', key: 'KeyF' },
		],
		'car': [
			{ id: 'touch-boost', label: 'BOOST', key: 'ShiftLeft' },
			{ id: 'touch-brake', label: 'BRAKE', key: 'Space' },
			{ id: 'touch-recover', label: 'FLIP', key: 'KeyR' },
			{ id: 'touch-enter', label: 'EXIT', key: 'KeyF' },
		],
		'helicopter': [
			{ id: 'touch-recover', label: 'FLIP', key: 'KeyR' },
			{ id: 'touch-yaw-left', label: 'YAW L', key: 'KeyQ' },
			{ id: 'touch-yaw-right', label: 'YAW R', key: 'KeyE' },
			{ id: 'touch-up', label: 'UP', key: 'ShiftLeft' },
			{ id: 'touch-down', label: 'DOWN', key: 'Space' },
			{ id: 'touch-enter', label: 'EXIT', key: 'KeyF', wide: true },
		],
		'airplane': [
			{ id: 'touch-yaw-left', label: 'YAW L', key: 'KeyQ' },
			{ id: 'touch-yaw-right', label: 'YAW R', key: 'KeyE' },
			{ id: 'touch-up', label: 'THRTL', key: 'ShiftLeft' },
			{ id: 'touch-brake', label: 'BRAKE', key: 'Space' },
			{ id: 'touch-enter', label: 'EXIT', key: 'KeyF', wide: true },
		],
		// A passenger steers nothing, so the only thing left to offer is the door
		'passenger': [
			{ id: 'touch-enter', label: 'EXIT', key: 'KeyF' },
		],
	};

	private static readonly STICK_RADIUS: number = 56;
	private static readonly DEAD_ZONE: number = 0.22;
	/** Past this the stick counts as pushed all the way, which is sprint. */
	private static readonly SPRINT_AT: number = 0.85;

	public static isTouchDevice(): boolean
	{
		return DeviceProfile.isTouch();
	}

	private world: World;
	private root: HTMLElement;
	private knob: HTMLElement;
	private buttonBar: HTMLElement;
	private context: string;

	private pressed: { [code: string]: boolean } = {};
	private stickTouch: number = null;
	private stickOrigin: { x: number, y: number } = { x: 0, y: 0 };
	private lookTouch: number = null;
	private lookAt: { x: number, y: number } = { x: 0, y: 0 };

	constructor(world: World)
	{
		this.world = world;

		document.body.classList.add('touch');
		this.root = this.build();
		TouchControls.lockLandscape();

		// One thumb is on the stick and the other is on the buttons, which leaves
		// nobody to drag the camera around. So it follows by itself here, and the
		// drag becomes a way to look away from where you're going rather than the
		// only way to face it.
		this.world.params.Center_Camera = true;
		this.world.cameraOperator.autoCenter = true;

		// The look region is the whole screen; buttons above it stop their own
		// touches from reaching it, so dragging anywhere else turns the camera
		let surface = this.world.renderer.domElement;
		surface.addEventListener('touchstart', (event) => this.onLookStart(event), { passive: false });
		surface.addEventListener('touchmove', (event) => this.onLookMove(event), { passive: false });
		surface.addEventListener('touchend', (event) => this.onLookEnd(event), { passive: false });
		surface.addEventListener('touchcancel', (event) => this.onLookEnd(event), { passive: false });
	}

	// ------------------------------------------------------------------ build

	/**
	 * Only works where the page is already fullscreen or installed to a home
	 * screen, and throws outright on iOS, so the portrait notice is what actually
	 * carries this. This is the nicety on top of it.
	 */
	private static lockLandscape(): void
	{
		try
		{
			let orientation = (window.screen as any).orientation;
			if (orientation === undefined || orientation.lock === undefined) return;

			let request = orientation.lock('landscape');
			if (request !== undefined && request.catch !== undefined) request.catch(() => undefined);
		}
		catch (error)
		{
			// Not allowed here, which is what the notice is for
		}
	}

	private build(): HTMLElement
	{
		let root = document.createElement('div');
		root.id = 'touch-controls';

		let pad = document.createElement('div');
		pad.id = 'touch-stick';
		this.knob = document.createElement('div');
		this.knob.id = 'touch-stick-knob';
		pad.appendChild(this.knob);
		root.appendChild(pad);

		pad.addEventListener('touchstart', (event) => this.onStickStart(event), { passive: false });
		pad.addEventListener('touchmove', (event) => this.onStickMove(event), { passive: false });
		pad.addEventListener('touchend', (event) => this.onStickEnd(event), { passive: false });
		pad.addEventListener('touchcancel', (event) => this.onStickEnd(event), { passive: false });

		this.buttonBar = document.createElement('div');
		this.buttonBar.id = 'touch-buttons';
		root.appendChild(this.buttonBar);

		this.applyContext('foot');

		document.getElementById('ui-container').appendChild(root);

		// The map is worth a glance, not a permanent corner of a small screen
		let mapButton = document.getElementById('minimap-toggle');
		mapButton.addEventListener('touchstart', (event) =>
		{
			event.preventDefault();
			event.stopPropagation();
			document.body.classList.toggle('map-open');
		}, { passive: false });

		return root;
	}

	/** Held rather than tapped: firing, braking and climbing all want holding. */
	private addButton(spec: TouchButtonSpec): void
	{
		let button = document.createElement('div');
		button.id = spec.id;
		button.className = 'touch-button' + (spec.wide === true ? ' wide' : '');
		button.textContent = spec.label;

		let send = (down: boolean) =>
		{
			if (spec.mouse !== undefined) this.mouse(spec.mouse, down);
			else this.press(spec.key, down);
		};

		button.addEventListener('touchstart', (event) =>
		{
			event.preventDefault();
			event.stopPropagation();
			button.classList.add('held');
			send(true);
		}, { passive: false });

		let release = (event: Event) =>
		{
			event.preventDefault();
			event.stopPropagation();
			button.classList.remove('held');
			send(false);
		};

		button.addEventListener('touchend', release, { passive: false });
		button.addEventListener('touchcancel', release, { passive: false });

		this.buttonBar.appendChild(button);
	}

	// ---------------------------------------------------------------- context

	/** Called every frame by the world; swapping the buttons is the rare case. */
	public update(): void
	{
		let context = this.readContext();
		if (context !== this.context) this.applyContext(context);
	}

	private readContext(): string
	{
		let character = this.world.localCharacter;
		if (character === undefined) return 'foot';

		let seat = character.occupyingSeat;
		if (seat !== null)
		{
			// The seat rather than controlledObject, which only appears once the
			// climbing in animation has finished and would flicker the set until then
			if (seat.type !== SeatType.Driver) return 'passenger';

			switch ((seat.vehicle as any).entityType)
			{
				case EntityType.Car: return 'car';
				case EntityType.Helicopter: return 'helicopter';
				case EntityType.Airplane: return 'airplane';
				default: return 'passenger';
			}
		}

		// A trigger with nothing behind it is just something else to mis-tap
		return character.weapon !== undefined ? 'foot-armed' : 'foot';
	}

	private applyContext(context: string): void
	{
		// A button held as the set changes never gets its own touchend, since the
		// element it belongs to is about to be gone. Let go of everything first.
		this.releaseAll();

		this.context = context;
		this.buttonBar.innerHTML = '';
		TouchControls.LAYOUTS[context].forEach((spec) => this.addButton(spec));
	}

	private releaseAll(): void
	{
		for (const code in this.pressed)
		{
			if (this.pressed[code] === true) this.press(code, false);
		}

		this.mouse(0, false);
		this.mouse(2, false);
	}

	// ------------------------------------------------------------------ stick

	private onStickStart(event: TouchEvent): void
	{
		event.preventDefault();
		event.stopPropagation();

		if (this.stickTouch !== null) return;

		let touch = event.changedTouches[0];
		this.stickTouch = touch.identifier;

		// Centred where the thumb landed, so it doesn't have to find the pad
		this.stickOrigin = { x: touch.clientX, y: touch.clientY };
		this.moveKnob(0, 0);
	}

	private onStickMove(event: TouchEvent): void
	{
		event.preventDefault();
		event.stopPropagation();

		let touch = this.findTouch(event, this.stickTouch);
		if (touch === null) return;

		let dx = touch.clientX - this.stickOrigin.x;
		let dy = touch.clientY - this.stickOrigin.y;
		let distance = Math.sqrt(dx * dx + dy * dy);
		let limit = TouchControls.STICK_RADIUS;

		if (distance > limit)
		{
			dx *= limit / distance;
			dy *= limit / distance;
			distance = limit;
		}

		this.moveKnob(dx, dy);

		let x = dx / limit;
		let y = dy / limit;
		let pull = distance / limit;

		this.press('KeyW', y < -TouchControls.DEAD_ZONE);
		this.press('KeyS', y > TouchControls.DEAD_ZONE);
		this.press('KeyA', x < -TouchControls.DEAD_ZONE);
		this.press('KeyD', x > TouchControls.DEAD_ZONE);
		// Shift is sprint on foot but the collective in a helicopter and the
		// throttle in an aeroplane, so a hard shove of the stick must not send it
		let onFoot = this.context === 'foot' || this.context === 'foot-armed';
		this.press('ShiftLeft', onFoot && pull > TouchControls.SPRINT_AT);
	}

	private onStickEnd(event: TouchEvent): void
	{
		event.preventDefault();
		event.stopPropagation();

		if (this.findTouch(event, this.stickTouch) === null) return;

		this.stickTouch = null;
		this.moveKnob(0, 0);

		this.press('KeyW', false);
		this.press('KeyS', false);
		this.press('KeyA', false);
		this.press('KeyD', false);
		this.press('ShiftLeft', false);
	}

	private moveKnob(dx: number, dy: number): void
	{
		this.knob.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
	}

	// ------------------------------------------------------------------- look

	private onLookStart(event: TouchEvent): void
	{
		event.preventDefault();

		if (this.lookTouch !== null) return;

		let touch = event.changedTouches[0];
		this.lookTouch = touch.identifier;
		this.lookAt = { x: touch.clientX, y: touch.clientY };
	}

	private onLookMove(event: TouchEvent): void
	{
		event.preventDefault();

		let touch = this.findTouch(event, this.lookTouch);
		if (touch === null) return;

		this.world.cameraOperator.move(touch.clientX - this.lookAt.x, touch.clientY - this.lookAt.y);
		this.world.cameraOperator.noteManualLook();
		this.lookAt = { x: touch.clientX, y: touch.clientY };
	}

	private onLookEnd(event: TouchEvent): void
	{
		if (this.findTouch(event, this.lookTouch) === null) return;

		this.lookTouch = null;
	}

	private findTouch(event: TouchEvent, identifier: number): Touch
	{
		if (identifier === null) return null;

		for (let i = 0; i < event.changedTouches.length; i++)
		{
			if (event.changedTouches[i].identifier === identifier) return event.changedTouches[i];
		}

		return null;
	}

	// ------------------------------------------------------------------ input

	/** The same key events a keyboard would send, so every receiver maps them itself. */
	private press(code: string, down: boolean): void
	{
		if (this.pressed[code] === down) return;

		this.pressed[code] = down;
		document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: code, bubbles: true }));
	}

	/**
	 * Straight to the receiver rather than through a synthetic mouse event:
	 * the mouse path asks for pointer lock, which mobile browsers don't have.
	 */
	private mouse(button: number, down: boolean): void
	{
		let receiver = this.world.inputManager.inputReceiver;
		if (receiver === undefined) return;

		receiver.handleMouseButton(new MouseEvent('mousedown'), 'Mouse' + button, down);
	}
}
