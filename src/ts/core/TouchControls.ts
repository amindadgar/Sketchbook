import { World } from '../world/World';

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
	private static readonly STICK_RADIUS: number = 56;
	private static readonly DEAD_ZONE: number = 0.22;
	/** Past this the stick counts as pushed all the way, which is sprint. */
	private static readonly SPRINT_AT: number = 0.85;

	public static isTouchDevice(): boolean
	{
		// Asks what the primary pointer is like, rather than whether a touch
		// screen exists at all, so a touch laptop keeps its mouse controls
		return window.matchMedia !== undefined && window.matchMedia('(pointer: coarse)').matches;
	}

	private world: World;
	private root: HTMLElement;
	private knob: HTMLElement;

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

		// The look region is the whole screen; buttons above it stop their own
		// touches from reaching it, so dragging anywhere else turns the camera
		let surface = this.world.renderer.domElement;
		surface.addEventListener('touchstart', (event) => this.onLookStart(event), { passive: false });
		surface.addEventListener('touchmove', (event) => this.onLookMove(event), { passive: false });
		surface.addEventListener('touchend', (event) => this.onLookEnd(event), { passive: false });
		surface.addEventListener('touchcancel', (event) => this.onLookEnd(event), { passive: false });
	}

	// ------------------------------------------------------------------ build

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

		let buttons = document.createElement('div');
		buttons.id = 'touch-buttons';
		root.appendChild(buttons);

		// Held buttons rather than taps: firing and aiming both want holding
		this.addButton(buttons, 'touch-aim', 'AIM', () => this.mouse(2, true), () => this.mouse(2, false));
		this.addButton(buttons, 'touch-fire', 'FIRE', () => this.mouse(0, true), () => this.mouse(0, false));
		this.addButton(buttons, 'touch-jump', 'JUMP', () => this.press('Space', true), () => this.press('Space', false));
		this.addButton(buttons, 'touch-enter', 'ENTER', () => this.press('KeyF', true), () => this.press('KeyF', false));

		document.getElementById('ui-container').appendChild(root);
		return root;
	}

	private addButton(parent: HTMLElement, id: string, label: string,
		down: () => void, up: () => void): void
	{
		let button = document.createElement('div');
		button.id = id;
		button.className = 'touch-button';
		button.textContent = label;

		button.addEventListener('touchstart', (event) =>
		{
			event.preventDefault();
			event.stopPropagation();
			button.classList.add('held');
			down();
		}, { passive: false });

		let release = (event: Event) =>
		{
			event.preventDefault();
			event.stopPropagation();
			button.classList.remove('held');
			up();
		};

		button.addEventListener('touchend', release, { passive: false });
		button.addEventListener('touchcancel', release, { passive: false });

		parent.appendChild(button);
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
		this.press('ShiftLeft', pull > TouchControls.SPRINT_AT);
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
