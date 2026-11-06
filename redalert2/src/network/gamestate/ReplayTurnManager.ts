import { ActionRecord, ReplayEventRecord, ReplayEventType, HashCheckpoint } from './Replay';
import { ChatMessageReplayEvent } from './replay/ChatMessageReplayEvent';
import { TauntReplayEvent } from './replay/TauntReplayEvent';
import { GameSpeed } from '@/game/GameSpeed';
import { EventDispatcher } from '@/util/event';
import { restoreExtensionState } from '@/game/state/ExtensionStateSnapshot';
import { restoreWorldState } from '@/game/state/WorldStateSnapshot';

export type ReplayExtensionStateRestorer = (state: unknown) => void;

export class ReplayTurnManager {
    private gameTurnMillis = 1000 / GameSpeed.BASE_TICKS_PER_SECOND;
    private errorState = false;
    private gameSpeedChanged = false;
    private finished = false;

    private actionsByTick: Map<number, ActionRecord[]>;
    private eventsByTick: Map<number, ReplayEventRecord[]>;
    private hashByTick: Map<number, number>;
    private readonly extensionStateRestorer: ReplayExtensionStateRestorer;
    private readonly worldStateRestorer: (state: unknown) => void;

    public readonly onReplayEvent = new EventDispatcher<this, any>();
    public readonly onActionsSent = new EventDispatcher<this, void>();
    public readonly onFinished = new EventDispatcher<this, void>();

    private readonly onGameSpeedChanged = () => {
        this.gameSpeedChanged = true;
    };

    constructor(
        private readonly game: any,
        private readonly replay: any,
        private readonly actionFactory: any,
        private readonly actionLogger?: { debug(message: string): void },
        extensionStateRestorer?: ReplayExtensionStateRestorer,
        worldStateRestorer?: (state: unknown) => void,
    ) {
        this.extensionStateRestorer = extensionStateRestorer ??
            (state => restoreExtensionState(this.game, state, {
                strict: true,
                superWeaponWorld: this.game,
            }));
        this.worldStateRestorer = worldStateRestorer ??
            (state => restoreWorldState(this.game, state, {
                strict: true,
                createObject: (type, name) => this.game.createObject?.(type, name),
                spawnObject: (object, tile) => this.game.restoreSpawnedObject?.(object, tile),
                unspawnObject: object => this.game.restoreUnspawnedObject?.(object),
            }));
        this.actionsByTick = this.buildTickMap<ActionRecord>(replay.actionRecords ?? [], r => r.tick);
        this.eventsByTick = this.buildTickMap<ReplayEventRecord>(replay.eventRecords ?? [], r => r.tick);
        this.hashByTick = new Map<number, number>();
        for (const cp of (replay.hashCheckpoints ?? []) as HashCheckpoint[]) {
            this.hashByTick.set(cp.tick, cp.hash);
        }
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

    isFinished(): boolean {
        return this.finished;
    }

    doGameTurn(_timestamp: number): boolean {
        if (this.errorState || this.finished) {
            return false;
        }

        const tick = this.game.currentTick;
        const finishedTick = this.replay.finishedTick;
        if (Number.isSafeInteger(finishedTick) && finishedTick >= 0 && tick >= finishedTick) {
            if (this.replay.worldState !== undefined) {
                try {
                    this.worldStateRestorer(this.replay.worldState);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(
                        `[ReplayTurnManager] Cannot restore world state at tick ${tick}: ${message}`,
                    );
                }
            }
            if (this.replay.extensionState !== undefined) {
                try {
                    this.extensionStateRestorer(this.replay.extensionState);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(
                        `[ReplayTurnManager] Cannot restore extension state at tick ${tick}: ${message}`,
                    );
                }
            }
            this.verifyHash(tick);
            this.finished = true;
            this.onFinished.dispatch(this, undefined);
            return false;
        }
        this.verifyHash(tick);

        // Inject actions for this tick
        const records = this.actionsByTick.get(tick);
        if (records) {
            for (const record of records) {
                try {
                    const action = this.actionFactory.create(record.actionType);
                    action.unserialize(record.data);
                    action.player = this.game.getPlayer(record.playerId);
                    action.process();

                    const printable = action.print?.();
                    if (printable) {
                        this.actionLogger?.debug(`[replay](${action.player?.name})@${tick}: ${printable}`);
                    }
                } catch (error) {
                    console.warn(`[ReplayTurnManager] Failed to replay action at tick ${tick}:`, error);
                }
            }
            this.onActionsSent.dispatch(this);
        }

        // Advance game state
        this.game.update();

        // Dispatch replay events for this tick
        const events = this.eventsByTick.get(tick);
        if (events) {
            for (const event of events) {
                if (event.type === ReplayEventType.Chat) {
                    this.onReplayEvent.dispatch(this, new ChatMessageReplayEvent({
                        playerId: event.playerId,
                        message: event.payload,
                    }));
                } else if (event.type === ReplayEventType.Taunt) {
                    this.onReplayEvent.dispatch(this, new TauntReplayEvent({
                        playerId: event.playerId,
                        tauntNo: parseInt(event.payload, 10),
                    }));
                }
            }
        }

        // Handle game speed changes
        if (this.gameSpeedChanged) {
            this.game.speed.value = this.game.desiredSpeed.value;
            this.computeGameTurn(this.game.speed.value);
            this.gameSpeedChanged = false;
        }

        return true;
    }

    private verifyHash(tick: number): void {
        const expectedHash = this.hashByTick.get(tick);
        if (expectedHash === undefined) return;
        const actualHash = this.game.getHash();
        if (actualHash !== expectedHash) {
            throw new Error(
                `[ReplayTurnManager] Desync detected at tick ${tick}: expected=${expectedHash}, actual=${actualHash}`,
            );
        }
    }

    dispose(): void {
        this.game.desiredSpeed.onChange.unsubscribe(this.onGameSpeedChanged);
    }

    private buildTickMap<T>(records: T[], getKey: (r: T) => number): Map<number, T[]> {
        const map = new Map<number, T[]>();
        for (const record of records) {
            const key = getKey(record);
            let list = map.get(key);
            if (!list) {
                list = [];
                map.set(key, list);
            }
            list.push(record);
        }
        return map;
    }
}
