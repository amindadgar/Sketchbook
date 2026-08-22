import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
/**
 * Two channels of short lived text.
 *
 * Toasts are for things that happened to you and want a moment of attention: a
 * record, an unlock, a challenge finished. The feed is for things that happened
 * to somebody else and want none: who shot whom.
 *
 * Everything either channel is handed goes in as a text node. Names come off
 * the network and some of them will be trying it on.
 */
export declare class Notices implements IUpdatable {
    updateOrder: number;
    private static readonly TOAST_LIFE;
    private static readonly TOASTS_AT_ONCE;
    private static readonly FEED_LIFE;
    private static readonly FEED_AT_ONCE;
    private world;
    private toasts;
    private feed;
    constructor(world: World);
    /** @param tone 'good' is gold, 'bad' is red, anything else is plain. */
    say(text: string, tone?: string, detail?: string): void;
    /** One kill, as the room saw it. */
    kill(killer: string, killerColor: string, victim: string, victimColor: string, weapon: string): void;
    update(timeStep: number, unscaledTimeStep: number): void;
    private age;
    private retire;
    private static who;
}
