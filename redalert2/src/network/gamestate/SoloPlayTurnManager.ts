import { NoAction } from '@/game/action/NoAction';
import { GameStatus } from '@/game/Game';
import { GameSpeed } from '@/game/GameSpeed';
import { EventDispatcher } from '@/util/event';
import type { ActionRecord } from './Replay';
import { restoreWorldState } from '@/game/state/WorldStateSnapshot';

export interface SoloResumeData {
    records: ActionRecord[];
    untilTick: number;
    actionFactory: any;
    extensionState?: unknown;
    worldState?: unknown;
    restoreExtensionState?(state: unknown): void;
    restoreWorldState?(state: unknown): void;
}

export class SoloPlayTurnManager {
    private gameTurnMillis = 1000 / GameSpeed.BASE_TICKS_PER_SECOND;
    private errorState = false;
    private gameSpeedChanged = false;
    private resumeActionsByTick?: Map<number, ActionRecord[]>;
    private resumeUntilTick = 0;
    private resumeActionFactory?: any;
    private resumeExtensionState?: unknown;
    private resumeStateRestorer?: (state: unknown) => void;
    private resumeWorldState?: unknown;
    private resumeWorldStateRestorer?: (state: unknown) => void;
    public readonly onActionsSent = new EventDispatcher<this, void>();

    private readonly onGameSpeedChanged = () => {
        this.gameSpeedChanged = true;
    };

    constructor(
        private readonly game: any,
        private readonly currentPlayer: any,
        private readonly inputActions: { dequeueAll(): any[] },
        private readonly actionLogger?: { debug(message: string): void },
        private readonly replayRecorder?: { recordActions?(tick: number, actions: any[]): void },
        resume?: SoloResumeData
    ) {
        if (resume) {
            this.resumeUntilTick = resume.untilTick;
            this.resumeActionFactory = resume.actionFactory;
            this.resumeExtensionState = resume.extensionState;
            this.resumeStateRestorer = resume.restoreExtensionState;
            this.resumeWorldState = resume.worldState;
            this.resumeWorldStateRestorer = resume.restoreWorldState ?? (state => restoreWorldState(this.game, state, {
                strict: true,
                createObject: (type, name) => this.game.createObject?.(type, name),
                spawnObject: (object, tile) => this.game.restoreSpawnedObject?.(object, tile),
                unspawnObject: object => this.game.restoreUnspawnedObject?.(object),
            }));
            this.resumeActionsByTick = new Map();
            for (const record of resume.records) {
                let list = this.resumeActionsByTick.get(record.tick);
                if (!list) {
                    this.resumeActionsByTick.set(record.tick, list = []);
                }
                list.push(record);
            }
        }
    }

    isResuming(): boolean {
        return !!this.resumeActionsByTick && this.game.currentTick < this.resumeUntilTick;
    }

    init(): void {
        this.game.desiredSpeed.onChange.subscribe(this.onGameSpeedChanged);
        this.computeGameTurn(this.game.speed.value);
    }

    private computeGameTurn(speed: number): void {
        this.gameTurnMillis = 1000 / (speed * GameSpeed.BASE_TICKS_PER_SECOND);
    }

    setErrorState(): void {
        this.errorState = true;
    }

    getErrorState(): boolean {
        return this.errorState;
    }

    getTurnMillis(): number {
        return this.gameTurnMillis;
    }

    doGameTurn(_timestamp: number): boolean {
        if (this.errorState) {
            return false;
        }

        // Save-game catch-up: replay the recorded actions for this tick and
        // ignore live input until the saved tick is reached.
        if (this.isResuming()) {
            this.inputActions.dequeueAll();
            const records = this.resumeActionsByTick!.get(this.game.currentTick);
            if (records) {
                for (const record of records) {
                    try {
                        const action = this.resumeActionFactory.create(record.actionType);
                        action.unserialize(record.data);
                        action.player = this.game.getPlayer(record.playerId);
                        action.process();
                    }
                    catch (error) {
                        console.warn(`[TurnManager] Failed to resume action at tick ${this.game.currentTick}:`, error);
                    }
                }
            }
            this.game.update();
            if (!this.isResuming()) {
                if (this.resumeWorldState !== undefined) {
                    if (!this.resumeWorldStateRestorer) {
                        this.errorState = true;
                        throw new Error("Saved world state cannot be restored");
                    }
                    try {
                        this.resumeWorldStateRestorer(this.resumeWorldState);
                    }
                    catch (error) {
                        this.errorState = true;
                        throw error;
                    }
                }
                if (this.resumeExtensionState !== undefined) {
                    if (!this.resumeStateRestorer) {
                        this.errorState = true;
                        throw new Error("Saved extension state cannot be restored");
                    }
                    try {
                        this.resumeStateRestorer(this.resumeExtensionState);
                    }
                    catch (error) {
                        this.errorState = true;
                        throw error;
                    }
                }
                this.resumeActionsByTick = undefined;
                this.resumeActionFactory = undefined;
                this.resumeExtensionState = undefined;
                this.resumeStateRestorer = undefined;
                this.resumeWorldState = undefined;
                this.resumeWorldStateRestorer = undefined;
            }
            if (this.gameSpeedChanged) {
                this.game.speed.value = this.game.desiredSpeed.value;
                this.computeGameTurn(this.game.speed.value);
                this.gameSpeedChanged = false;
            }
            return true;
        }

        if (this.game.status !== GameStatus.Ended) {
            let actions = this.inputActions.dequeueAll();
            if (actions.length) {
                this.replayRecorder?.recordActions?.(this.game.currentTick, actions);
                this.onActionsSent.dispatch(this);
            } else {
                actions = [new NoAction()];
            }
            this.processActions(actions);
        }

        this.game.update();

        if (this.gameSpeedChanged) {
            this.game.speed.value = this.game.desiredSpeed.value;
            this.computeGameTurn(this.game.speed.value);
            this.gameSpeedChanged = false;
        }

        return true;
    }

    private processActions(actions: any[]): void {
        actions.forEach((action) => {
            action.player = this.currentPlayer;
            // A malformed or failing action must not abort the whole turn:
            // the throw would skip every remaining action AND this tick's
            // game.update(), permanently jamming the input pipeline while the
            // world keeps rendering — the game appears alive but ignores all
            // commands. Drop the bad action and keep the turn going.
            try {
                action.process();
            }
            catch (error) {
                console.error(`[TurnManager] Dropped action that failed to process: ${action?.constructor?.name}`, error);
            }
            const printable = action.print?.();
            if (printable) {
                this.actionLogger?.debug(`(${action.player.name})@${this.game.currentTick}: ${printable}`);
            }
        });
    }

    dispose(): void {
        this.game.desiredSpeed.onChange.unsubscribe(this.onGameSpeedChanged);
    }
}
