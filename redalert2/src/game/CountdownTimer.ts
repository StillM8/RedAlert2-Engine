import { TimerExpireEvent } from './event/TimerExpireEvent';
import { GameSpeed } from './GameSpeed';
import { fnv32aStrings } from '@/util/math';

export const COUNTDOWN_TIMER_STATE_VERSION = 1 as const;

export interface CountdownTimerState {
    readonly version: typeof COUNTDOWN_TIMER_STATE_VERSION;
    readonly ticks: number;
    readonly running: boolean;
}
export class CountdownTimer {
    private ticks: number = 0;
    private running: boolean = false;
    getSeconds(): number {
        return Math.floor(this.ticks / GameSpeed.BASE_TICKS_PER_SECOND);
    }
    setSeconds(seconds: number): void {
        this.ticks = Math.max(0, Math.floor(GameSpeed.BASE_TICKS_PER_SECOND * seconds));
    }
    addSeconds(seconds: number): void {
        this.ticks = Math.max(0, this.ticks + Math.floor(GameSpeed.BASE_TICKS_PER_SECOND * seconds));
    }
    start(): void {
        this.running = true;
    }
    stop(): void {
        this.running = false;
    }
    isRunning(): boolean {
        return this.running;
    }

    getHash(): number {
        return fnv32aStrings(["countdown-timer", this.ticks, this.running ? 1 : 0]);
    }

    captureState(): CountdownTimerState {
        return {
            version: COUNTDOWN_TIMER_STATE_VERSION,
            ticks: this.ticks,
            running: this.running,
        };
    }

    restoreState(state: unknown): void {
        if (typeof state !== 'object' || state === null) {
            throw new Error('Invalid countdown timer state: expected an object');
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== COUNTDOWN_TIMER_STATE_VERSION) {
            throw new Error(`Unsupported countdown timer state version: ${String(candidate.version)}`);
        }
        if (!Number.isSafeInteger(candidate.ticks) || (candidate.ticks as number) < 0) {
            throw new Error('Invalid countdown timer state: ticks');
        }
        if (typeof candidate.running !== 'boolean') {
            throw new Error('Invalid countdown timer state: running');
        }
        // All validation completes before either live field is replaced.
        this.ticks = candidate.ticks as number;
        this.running = candidate.running;
    }
    update(game: {
        events: {
            dispatch: (event: TimerExpireEvent) => void;
        };
    }): void {
        if (this.running) {
            if (this.ticks > 0) {
                this.ticks--;
            }
            else {
                this.running = false;
                game.events.dispatch(new TimerExpireEvent(this));
            }
        }
    }
}
