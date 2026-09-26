import { World } from '../world/World';
import { IInputReceiver } from '../interfaces/IInputReceiver';
import { IUpdatable } from '../interfaces/IUpdatable';
export declare class InputManager implements IUpdatable {
    updateOrder: number;
    world: World;
    domElement: any;
    pointerLock: any;
    isLocked: boolean;
    inputReceiver: IInputReceiver;
    boundOnMouseDown: (evt: any) => void;
    boundOnMouseMove: (evt: any) => void;
    boundOnMouseUp: (evt: any) => void;
    boundOnMouseWheelMove: (evt: any) => void;
    boundOnContextMenu: (evt: any) => void;
    boundOnPointerlockChange: (evt: any) => void;
    boundOnPointerlockError: (evt: any) => void;
    boundOnKeyDown: (evt: any) => void;
    boundOnKeyUp: (evt: any) => void;
    constructor(world: World, domElement: HTMLElement);
    update(timestep: number, unscaledTimeStep: number): void;
    setInputReceiver(receiver: IInputReceiver): void;
    setPointerLock(enabled: boolean): void;
    onPointerlockChange(event: MouseEvent): void;
    onPointerlockError(event: MouseEvent): void;
    onMouseDown(event: MouseEvent): void;
    onMouseMove(event: MouseEvent): void;
    onMouseUp(event: MouseEvent): void;
    onKeyDown(event: KeyboardEvent): void;
    onKeyUp(event: KeyboardEvent): void;
    /**
     * A key going into a text box, such as a name or a settings number, rather
     * than to the game. Not a checkbox or a list, which keep focus after a
     * click and would otherwise leave the game deaf until the canvas is clicked.
     */
    private static isTyping;
    onMouseWheelMove(event: WheelEvent): void;
}
