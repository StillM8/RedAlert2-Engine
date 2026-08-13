import { IrcConnection } from "@/network/IrcConnection";
import { recordGamePerformanceFrame } from "@/performance/PerformanceRuntime";
interface LocalPlayer {
    isObserver: boolean;
}
interface Renderer {
    getStats(): {
        begin(): void;
        end(): void;
    } | null;
    update(timestamp: number, interpolation: number): void;
    render(): void;
    flush(): void;
}
interface Sound {
    audioSystem: {
        setMuted(muted: boolean): void;
    };
}
interface GameTurnManager {
    getTurnMillis(): number;
    doGameTurn(timestamp: number): boolean;
    setErrorState(): void;
    setPassiveMode?(passive: boolean): void;
}
interface GameAnimationLoopOptions {
    skipFrames?: boolean;
    // Maximum number of fixed-step simulation turns to execute in one render
    // callback. A slow callback retains any remaining debt for the next
    // callback instead of dropping turns and making the game run in slow
    // motion. This is only an anti-spiral bound for long OS stalls.
    maxCatchUpTurns?: number;
    // Live-readable render fps cap (0 = display rate). Sim ticks always run.
    frameLimit?: {
        value: number;
    };
    // Transient, non-persisted cap composed with frameLimit — the tighter of the
    // two wins. Used while a full-screen overlay hides the world, and when the
    // OS reports the device is thermally stressed. 0 = no override.
    frameLimitOverride?: {
        value: number;
    };
    // Multiplayer must continue its lockstep/network bookkeeping while the
    // WebView is backgrounded. Single-player supplies false because its
    // GameScreen persists a replay checkpoint and resumes from that tick.
    runSimulationInBackground?: boolean;
    onError?(error: Error, isRenderError?: boolean): void;
}

export const DEFAULT_MAX_CATCH_UP_TURNS = 120;

export function limitGameTurnsForFrame(
    deltaFrames: number,
    skipFrames: boolean,
    maxCatchUpTurns = DEFAULT_MAX_CATCH_UP_TURNS,
): number {
    const dueTurns = Math.max(0, Math.floor(Number.isFinite(deltaFrames) ? deltaFrames : 0));
    if (!skipFrames && dueTurns > 1) {
        return 1;
    }
    return Math.min(dueTurns, Math.max(1, Math.floor(maxCatchUpTurns)));
}

export class GameAnimationLoop {
    private localPlayer: LocalPlayer;
    private renderer: Renderer;
    private sound: Sound;
    private gameTurnMgr: GameTurnManager;
    private options: GameAnimationLoopOptions;
    private isStarted: boolean = false;
    private paused: boolean = false;
    private rendererErrorState: boolean = false;
    private turnMgrIsWaiting: boolean = false;
    private startTime: number | undefined;
    private lastGameFrame: number = 0;
    private lastGameTurnMillis: number | undefined;
    private rafId: number | undefined;
    private backgroundIntervalId: number | undefined;
    private lastRenderTime: number = 0;
    constructor(localPlayer: LocalPlayer, renderer: Renderer, sound: Sound, gameTurnMgr: GameTurnManager, options: GameAnimationLoopOptions = {}) {
        this.localPlayer = localPlayer;
        this.renderer = renderer;
        this.sound = sound;
        this.gameTurnMgr = gameTurnMgr;
        this.options = options;
    }
    private doBackgroundFrame = (timestamp: number): void => {
        if (this.options.runSimulationInBackground !== false && this.isStarted && this.paused) {
            let deltaFrames = this.updateDeltaGameFrames(timestamp);
            if (this.turnMgrIsWaiting) {
                deltaFrames = 1;
            }
            while (deltaFrames > 0) {
                this.turnMgrIsWaiting = !this.tickGame(timestamp);
                // lastGameFrame is the number of turns actually attempted. It
                // must advance here, not while calculating the wall-clock
                // delta, otherwise a slow render frame silently drops turns.
                this.lastGameFrame++;
                deltaFrames--;
            }
        }
    };
    private doFrame = (timestamp: number): void => {
        if (this.isStarted && !this.paused) {
            let deltaFrames = this.updateDeltaGameFrames(timestamp);
            if (this.turnMgrIsWaiting || (!this.options.skipFrames && deltaFrames > 1)) {
                deltaFrames = 1;
            }
            const turnsToRun = limitGameTurnsForFrame(
                deltaFrames,
                this.options.skipFrames ?? false,
                this.options.maxCatchUpTurns,
            );
            for (let turn = 0; turn < turnsToRun; turn++) {
                this.turnMgrIsWaiting = !this.tickGame(timestamp);
                // lastGameFrame counts turns actually attempted. If the
                // catch-up bound is reached, leaving the remaining debt here
                // makes the next callback continue the simulation rather than
                // silently slowing the world down.
                this.lastGameFrame++;
            }
            // Render fps cap: sim ticks above always run at full rate, but
            // drawing is skipped until the next render slot. The half-frame
            // slack keeps a 60 cap rendering every other frame on a 120 Hz
            // display instead of every third.
            const userCap = this.options.frameLimit?.value ?? 0;
            const overrideCap = this.options.frameLimitOverride?.value ?? 0;
            const fpsCap = overrideCap > 0
                ? (userCap > 0 ? Math.min(userCap, overrideCap) : overrideCap)
                : userCap;
            if (fpsCap > 0) {
                const renderInterval = 1000 / fpsCap;
                if (timestamp - this.lastRenderTime < renderInterval - 4) {
                    this.rafId = requestAnimationFrame(this.doFrame);
                    return;
                }
                this.lastRenderTime = timestamp;
            }
            recordGamePerformanceFrame(timestamp);
            const stats = this.renderer.getStats();
            if (stats) {
                stats.begin();
            }
            const turnMillis = this.gameTurnMgr.getTurnMillis();
            const interpolation = Math.max(0, (timestamp - (this.startTime! + this.lastGameFrame * turnMillis)) / turnMillis);
            this.updateRenderer(timestamp, interpolation);
            if (this.render()) {
                if (stats) {
                    stats.end();
                }
                this.rafId = requestAnimationFrame(this.doFrame);
            }
        }
    };
    private handleVisibilityChange = (): void => {
        const isHidden = document.hidden;
        if (this.paused !== isHidden) {
            if (this.localPlayer &&
                !this.localPlayer.isObserver &&
                this.paused) {
                this.doBackgroundFrame(performance.now());
            }
            this.paused = isHidden;
            if (!this.paused) {
                this.startTime = undefined;
                this.lastGameFrame = 0;
            }
            if (this.localPlayer && !this.localPlayer.isObserver) {
                try {
                    this.gameTurnMgr.setPassiveMode?.(this.paused);
                }
                catch (error) {
                    if (!(error instanceof IrcConnection.SocketError)) {
                        throw error;
                    }
                }
            }
            if (this.paused) {
                if (this.rafId) {
                    cancelAnimationFrame(this.rafId);
                    this.rafId = undefined;
                }
                if (this.options.runSimulationInBackground !== false) {
                    this.backgroundIntervalId = setInterval(() => {
                        const timestamp = performance.now();
                        this.doBackgroundFrame(timestamp);
                    }, 1000);
                }
            }
            else {
                if (this.backgroundIntervalId) {
                    clearInterval(this.backgroundIntervalId);
                    this.backgroundIntervalId = undefined;
                }
                this.rafId = requestAnimationFrame(this.doFrame);
            }
            this.sound.audioSystem.setMuted(this.paused);
        }
    };
    start(): void {
        if (!this.isStarted) {
            this.isStarted = true;
            this.paused = false;
            this.startTime = undefined;
            this.lastGameFrame = 0;
            if (document.hidden) {
                this.handleVisibilityChange();
            }
            else {
                this.rafId = requestAnimationFrame(this.doFrame);
            }
            document.addEventListener("visibilitychange", this.handleVisibilityChange);
        }
    }
    private updateDeltaGameFrames(timestamp: number): number {
        const turnMillis = this.gameTurnMgr.getTurnMillis();
        const turnMillisChanged = turnMillis !== this.lastGameTurnMillis;
        this.lastGameTurnMillis = turnMillis;
        if (turnMillisChanged) {
            this.lastGameFrame = 0;
            this.startTime = timestamp;
        }
        let deltaFrames = 0;
        if (this.startTime) {
            const elapsed = timestamp - this.startTime;
            const currentFrame = Math.round(elapsed / turnMillis);
            // Do not move lastGameFrame to the wall-clock target here. The
            // caller may have a simulation budget and must retain any turns
            // that could not be executed for the next animation frame.
            deltaFrames = Math.max(0, currentFrame - this.lastGameFrame);
        }
        else {
            this.startTime = timestamp;
        }
        return deltaFrames;
    }
    private tickGame(timestamp: number): boolean {
        if (!this.options.onError) {
            return this.gameTurnMgr.doGameTurn(timestamp);
        }
        try {
            return this.gameTurnMgr.doGameTurn(timestamp);
        }
        catch (error) {
            this.gameTurnMgr.setErrorState();
            this.options.onError(error as Error);
            return false;
        }
    }
    private updateRenderer(timestamp: number, interpolation: number): void {
        if (this.options.onError) {
            if (!this.rendererErrorState) {
                try {
                    this.renderer.update(timestamp, interpolation);
                }
                catch (error) {
                    this.gameTurnMgr.setErrorState();
                    this.rendererErrorState = true;
                    this.options.onError(error as Error);
                    return;
                }
            }
        }
        else {
            this.renderer.update(timestamp, interpolation);
        }
    }
    private render(): boolean {
        if (this.options.onError) {
            try {
                this.renderer.render();
            }
            catch (error) {
                this.gameTurnMgr.setErrorState();
                this.rendererErrorState = true;
                this.options.onError(error as Error, true);
                return false;
            }
        }
        else {
            this.renderer.render();
        }
        return true;
    }
    stop(): void {
        if (this.isStarted) {
            this.isStarted = false;
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = undefined;
            }
            if (this.backgroundIntervalId) {
                clearInterval(this.backgroundIntervalId);
                this.backgroundIntervalId = undefined;
            }
            document.removeEventListener("visibilitychange", this.handleVisibilityChange);
        }
    }
    destroy(): void {
        this.stop();
        this.renderer.flush();
    }
}
