import { fnv32aStrings } from "@/util/math";
import { scalarStateHash } from "@/util/stateHash";
import { TagRepeatType } from "@/data/map/tag/TagRepeatType";
import { TriggerActionType } from "@/data/map/trigger/TriggerActionType";
import { TriggerExecutorFactory } from "@/game/trigger/TriggerExecutorFactory";
import {
    canRememberTriggerEvent,
    isTemporalTriggerEvent,
    TriggerCondition,
} from "@/game/trigger/TriggerCondition";
import { TriggerConditionFactory } from "@/game/trigger/TriggerConditionFactory";
import { CompositeDisposable } from "@/util/disposable/CompositeDisposable";
import { Variable } from "@/data/map/Variable";
import { Trigger } from "@/data/map/trigger/Trigger";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";
import { MapObject } from "@/data/map/MapObjects";
import { resolveHousePlayer, resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";

type TriggerInstance = {
    trigger: Trigger;
    conditions: TriggerCondition[];
    targets: MapObject[];
    remainingTargets: Set<MapObject>;
    disabled: boolean;
    finished: boolean;
    eventMarks: Set<number>;
    markedForDestruction: boolean;
};

type TagRuntime = {
    id: string;
    tag: any;
    lifetime: TagRepeatType;
    targets: MapObject[];
    remainingTargets: Set<MapObject>;
    markedForDestruction: boolean;
    destroyed: boolean;
    firstTrigger?: any;
    triggerChain: any[];
    allowWin: boolean;
};

export const TRIGGER_MANAGER_STATE_VERSION = 1 as const;

export interface TriggerManagerInstanceState {
    id: string;
    disabled: boolean;
    finished: boolean;
    remainingTargets: string[];
    eventMarks?: number[];
    markedForDestruction?: boolean;
}

export interface TriggerManagerAllowWinHoldState {
    playerIndex?: number;
    house?: string;
    count: number;
}

export interface TriggerManagerState {
    version: typeof TRIGGER_MANAGER_STATE_VERSION;
    instances: TriggerManagerInstanceState[];
    globalVariables: [string, boolean][];
    localVariables: [string, boolean][];
    pendingEventCount: number;
    pendingTagDestructions?: string[];
    allowWinHolds?: TriggerManagerAllowWinHoldState[];
}

type TriggerManagerRestorePlan = {
    restores: Array<{
        instance: TriggerInstance;
        disabled: boolean;
        finished: boolean;
        remaining: Set<MapObject>;
        eventMarks: Set<number>;
        markedForDestruction: boolean;
    }>;
    globalVariables: Map<string, Variable>;
    localVariables: Map<string, Variable>;
    pendingTagDestructions: Set<string>;
    allowWinHolds: Map<string | number, number>;
};

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function keyOf(value: unknown): string {
    return value === undefined || value === null ? "" : String(value);
}

function tagLifetime(tag: any): TagRepeatType {
    const raw = Number(tag?.lifetime ?? tag?.repeatType ?? tag?.persistence ?? TagRepeatType.Volatile);
    if (raw === TagRepeatType.SemiPersistent || raw === TagRepeatType.Persistent) {
        return raw as TagRepeatType;
    }
    return TagRepeatType.Volatile;
}

function isSemiPersistentTag(tag: any): boolean {
    return tagLifetime(tag) === TagRepeatType.SemiPersistent;
}

function tagIdOf(value: any): string {
    if (value && typeof value === "object") {
        return keyOf(value.id);
    }
    return keyOf(value);
}

function triggerReferenceMatches(trigger: any, reference: string): boolean {
    const normalized = reference.toLocaleLowerCase("en-US");
    return keyOf(trigger?.id) === reference ||
        keyOf(trigger?.name).toLocaleLowerCase("en-US") === normalized;
}

function firstTagForTrigger(trigger: any): any {
    const seen = new Set<any>();
    let current = trigger;
    while (current && !seen.has(current)) {
        if (current.tag !== undefined && current.tag !== null) {
            return current.tag;
        }
        seen.add(current);
        current = current.attachedTrigger;
    }
    return undefined;
}

function triggerBelongsToTag(trigger: any, id: string): boolean {
    const seen = new Set<any>();
    let current = trigger;
    while (current && !seen.has(current)) {
        if (tagIdOf(current.tag) === id) {
            return true;
        }
        seen.add(current);
        current = current.attachedTrigger;
    }
    return false;
}

function isAllowWinAction(action: any): boolean {
    const type = action?.type;
    return type === TriggerActionType.AllowWin ||
        (typeof type === "string" &&
            (type.trim() === String(TriggerActionType.AllowWin) ||
                type.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "") === "allowwin"));
}

function triggerHasAllowWin(trigger: any): boolean {
    return (trigger?.actions ?? []).some(isAllowWinAction);
}

function allowWinKeyOf(player: any): string | number | undefined {
    if (player && Number.isSafeInteger(player.playerListIndex) && player.playerListIndex >= 0) {
        return player.playerListIndex;
    }
    const name = String(player?.name ?? player?.houseName ?? "").trim();
    return name ? `house:${name.toLocaleLowerCase("en-US")}` : undefined;
}

function mapObjectFingerprint(mapObject: any): string {
    return `${mapObject?.name ?? ""}|${mapObject?.type ?? ""}|${mapObject?.rx ?? -1}|${mapObject?.ry ?? -1}`;
}

function conditionEventIndex(condition: any, fallback: number): number {
    const value = condition?.event?.eventIndex;
    return Number.isSafeInteger(value) ? value : fallback;
}

function conditionIsTemporal(condition: any, event = condition?.event): boolean {
    if (typeof condition?.temporal === "boolean") {
        return condition.temporal;
    }
    return isTemporalTriggerEvent(event);
}

function conditionCanRemember(condition: any, event = condition?.event): boolean {
    if (!conditionIsTemporal(condition, event)) {
        return false;
    }
    if (typeof condition?.rememberable === "boolean") {
        return condition.rememberable;
    }
    if (typeof condition?.canRemember === "boolean") {
        return condition.canRemember;
    }
    if (event === undefined && condition?.temporal === true) {
        return true;
    }
    return canRememberTriggerEvent(event);
}

function conditionEventIndexes(instance: TriggerInstance): Set<number> {
    return new Set(instance.conditions.map((condition, index) => conditionEventIndex(condition, index)));
}

function resolveDifficulty(context: any): "easy" | "medium" | "hard" {
    const raw = context.triggerDifficulty ?? context.difficulty ?? context.gameDifficulty ??
        context.campaignDifficulty ?? context.localPlayer?.difficulty ??
        context.localPlayer?.aiDifficulty ?? context.gameOpts?.difficulty;
    if (typeof raw === "string") {
        const value = raw.trim().toLowerCase();
        if (["easy", "easiest"].includes(value)) return "easy";
        if (["hard", "hardest", "brutal"].includes(value)) return "hard";
        return "medium";
    }
    if (raw === 2) return "easy";
    if (raw === 0 || raw === 3 || raw === 5) return "hard";
    return "medium";
}

export function isTriggerEnabledForDifficulty(trigger: any, context: any): boolean {
    return trigger?.difficulties?.[resolveDifficulty(context)] !== false;
}

export class TriggerManager {
    private disposables: CompositeDisposable;
    private triggerInstances: Map<string, TriggerInstance>;
    private targetsByTag: Map<string, MapObject[]>;
    private tagRuntimes: Map<string, TagRuntime>;
    private conditionFactory: TriggerConditionFactory;
    private executorFactory: TriggerExecutorFactory;
    private pendingGameEvents: any[];
    private globalVariables: Map<string, Variable>;
    private localVariables: Map<string, Variable>;
    private pendingTagDestructions: Set<string>;
    private pendingSemiDetachments: Map<string, MapObject[]>;
    private springingTags: Set<string>;
    private allowWinHolds: Map<string | number, number>;
    private context?: any;

    constructor() {
        this.disposables = new CompositeDisposable();
        this.triggerInstances = new Map();
        this.targetsByTag = new Map();
        this.tagRuntimes = new Map();
        this.conditionFactory = new TriggerConditionFactory();
        this.executorFactory = new TriggerExecutorFactory();
        this.pendingGameEvents = [];
        this.globalVariables = new Map();
        this.localVariables = new Map();
        this.pendingTagDestructions = new Set();
        this.pendingSemiDetachments = new Map();
        this.springingTags = new Set();
        this.allowWinHolds = new Map();
    }

    init(context: GameContext): void {
        this.triggerInstances.clear();
        this.targetsByTag.clear();
        this.tagRuntimes.clear();
        this.pendingTagDestructions.clear();
        this.pendingSemiDetachments.clear();
        this.springingTags.clear();
        this.allowWinHolds.clear();
        this.globalVariables.clear();
        this.localVariables.clear();
        this.pendingGameEvents.length = 0;
        this.context = context;

        const initialObjects = context.map.getInitialMapObjects?.()?.["technos"] ?? [];
        for (const obj of initialObjects) {
            const id = keyOf(obj.tag);
            if (!id || id.toLocaleLowerCase("en-US") === "<none>") {
                continue;
            }
            const tile = context.map.tiles?.getByMapCoords?.(obj.rx, obj.ry);
            if (!tile) {
                continue;
            }
            const mapObj = context.map.getObjectsOnTile?.(tile)
                ?.find((entry: any) => entry.name === obj.name && entry.type === obj.type);
            if (mapObj) {
                this.addTarget(id, mapObj);
            }
        }
        for (const cellTag of context.map.getCellTags?.() ?? []) {
            const id = keyOf(cellTag.tagId);
            if (!id || id.toLocaleLowerCase("en-US") === "<none>") {
                continue;
            }
            const tile = context.map.tiles?.getByMapCoords?.(cellTag.coords.x, cellTag.coords.y);
            if (tile) {
                this.addTarget(id, tile);
            }
            else {
                console.warn(`CellTag out of bounds at (${cellTag.coords.x}, ${cellTag.coords.y}). Skipping.`);
            }
        }
        for (const tag of context.map.getTags?.() ?? []) {
            this.ensureTagRuntime(tag, this.targetsByTag.get(tagIdOf(tag)));
        }
        for (const [id, variable] of context.map.getVariables?.() ?? []) {
            const target = variable.isGlobal ? this.globalVariables : this.localVariables;
            target.set(String(id), variable.clone());
        }
        for (const trigger of context.map.getTriggers?.() ?? []) {
            const tagRuntime = this.ensureTagRuntime(trigger.tag, this.targetsByTag.get(tagIdOf(trigger.tag)));
            this.triggerInstances.set(trigger.id, this.createTriggerInstance(trigger, context, tagRuntime));
        }
        this.indexTagChains(context);
        this.initializeAllowWinHolds(context);
        const subscribe = context.events?.subscribe;
        if (subscribe) {
            const subscription = subscribe.call(context.events, event => this.pendingGameEvents.push(event));
            if (subscription) {
                this.disposables.add(subscription);
            }
        }
    }

    private addTarget(id: string, target: MapObject): void {
        if (!id || !target) {
            return;
        }
        let targets = this.targetsByTag.get(id);
        if (!targets) {
            targets = [];
            this.targetsByTag.set(id, targets);
        }
        if (!targets.includes(target)) {
            targets.push(target);
        }
    }

    private indexTagChains(context: any): void {
        const triggers = [...(context.map?.getTriggers?.() ?? [])];
        const grouped = new Map<string, any[]>();
        const incoming = new Set<any>();
        for (const trigger of triggers) {
            if (trigger?.attachedTrigger) {
                incoming.add(trigger.attachedTrigger);
            }
            const id = tagIdOf(firstTagForTrigger(trigger));
            if (!id) {
                continue;
            }
            const group = grouped.get(id) ?? [];
            group.push(trigger);
            grouped.set(id, group);
        }
        for (const [id, group] of grouped) {
            const runtime = this.tagRuntimes.get(id) ?? this.ensureTagRuntime(group[0]?.tag);
            if (!runtime) {
                continue;
            }
            const authoredFirst = runtime.tag?.triggerId
                ? group.find(trigger => triggerReferenceMatches(trigger, keyOf(runtime.tag.triggerId)))
                : undefined;
            const first = authoredFirst ?? group.find(trigger => !incoming.has(trigger)) ?? group[0];
            const chain: any[] = [];
            const seen = new Set<any>();
            let current = first;
            while (current && !seen.has(current)) {
                seen.add(current);
                if (tagIdOf(firstTagForTrigger(current)) !== id) {
                    break;
                }
                chain.push(current);
                current = current.attachedTrigger;
            }
            runtime.firstTrigger = first;
            runtime.triggerChain = chain;
            runtime.allowWin = chain.some(triggerHasAllowWin);
        }
    }

    private initializeAllowWinHolds(context: any): void {
        for (const runtime of this.tagRuntimes.values()) {
            if (!runtime.allowWin) {
                continue;
            }
            const first = runtime.firstTrigger ?? runtime.triggerChain[0];
            const player = first
                ? resolveTriggerHousePlayer(context, first) ?? context.resolveMapOwner?.(first.houseName)
                : undefined;
            const key = allowWinKeyOf(player);
            if (key !== undefined) {
                this.incrementAllowWinHold(key);
            }
        }
    }

    private resolveAllowWinPlayer(house: any, context: any = this.context): any | undefined {
        if (house && typeof house === "object" && allowWinKeyOf(house) !== undefined) {
            return house;
        }
        const game = context ?? this.context;
        if (!game) {
            return undefined;
        }
        return game.resolveMapOwner?.(house) ?? resolveHousePlayer(game, house);
    }

    private allowWinHoldKey(house: any, context: any = this.context): string | number | undefined {
        return allowWinKeyOf(this.resolveAllowWinPlayer(house, context));
    }

    getAllowWinHoldCount(house: any, context: any = this.context): number {
        const key = this.allowWinHoldKey(house, context);
        return key === undefined ? 0 : this.allowWinHolds.get(key) ?? 0;
    }

    hasAllowWinHold(house: any, context: any = this.context): boolean {
        return this.getAllowWinHoldCount(house, context) > 0;
    }

    private incrementAllowWinHold(key: string | number): void {
        this.allowWinHolds.set(key, (this.allowWinHolds.get(key) ?? 0) + 1);
    }

    private decrementAllowWinHold(key: string | number): void {
        const count = this.allowWinHolds.get(key) ?? 0;
        if (count <= 1) {
            this.allowWinHolds.delete(key);
        }
        else {
            this.allowWinHolds.set(key, count - 1);
        }
    }

    private allowWinHoldEntries(): TriggerManagerAllowWinHoldState[] {
        return [...this.allowWinHolds.entries()]
            .filter(([, count]) => count > 0)
            .map(([key, count]) => typeof key === "number"
                ? { playerIndex: key, count }
                : { house: key.replace(/^house:/, ""), count })
            .sort((left, right) => {
                const leftKey = left.playerIndex === undefined ? left.house ?? "" : `p:${left.playerIndex}`;
                const rightKey = right.playerIndex === undefined ? right.house ?? "" : `p:${right.playerIndex}`;
                return compareText(leftKey, rightKey);
            });
    }

    private ensureTagRuntime(tag: any, targets?: MapObject[]): TagRuntime | undefined {
        const id = tagIdOf(tag);
        if (!id) {
            return undefined;
        }
        let runtime = this.tagRuntimes.get(id);
        if (!runtime) {
            const authoredTag = tag && typeof tag === "object" ? tag : undefined;
            runtime = {
                id,
                tag: authoredTag,
                lifetime: tagLifetime(authoredTag ?? tag),
                targets: [],
                remainingTargets: new Set(),
                markedForDestruction: false,
                destroyed: false,
                triggerChain: [],
                allowWin: false,
            };
            this.tagRuntimes.set(id, runtime);
        }
        else if (!runtime.tag && tag && typeof tag === "object") {
            runtime.tag = tag;
            runtime.lifetime = tagLifetime(tag);
        }
        if (runtime.destroyed) {
            return runtime;
        }
        for (const target of targets ?? this.targetsByTag.get(id) ?? []) {
            if (!runtime.targets.includes(target)) {
                runtime.targets.push(target);
                runtime.remainingTargets.add(target);
            }
        }
        this.targetsByTag.set(id, runtime.targets);
        return runtime;
    }

    private createTriggerInstance(
        trigger: Trigger,
        context: GameContext,
        tagRuntime?: TagRuntime,
    ): TriggerInstance {
        const targets = [...(tagRuntime?.targets ?? this.targetsByTag.get(tagIdOf(firstTagForTrigger(trigger))) ?? [])];
        const conditions = trigger.events
            .map((event, index) => {
                const condition = this.conditionFactory.create(event, trigger);
                condition.setTargets(targets);
                condition.init(context);
                return { condition, index };
            })
            .sort((left, right) => {
                const eventOrder = conditionEventIndex(right.condition, right.index) -
                    conditionEventIndex(left.condition, left.index);
                return eventOrder || Number(right.condition.blocking) - Number(left.condition.blocking) || left.index - right.index;
            })
            .map(entry => entry.condition);
        return {
            trigger,
            conditions,
            targets,
            remainingTargets: tagRuntime && isSemiPersistentTag(trigger.tag)
                ? tagRuntime.remainingTargets
                : new Set(),
            disabled: trigger.disabled,
            finished: false,
            eventMarks: new Set(),
            markedForDestruction: false,
        };
    }

    private normalizeInstance(instance: TriggerInstance): void {
        if (Array.isArray(instance.eventMarks)) {
            instance.eventMarks = new Set(instance.eventMarks);
        }
        else if (Array.isArray((instance as any).markedEvents)) {
            instance.eventMarks = new Set((instance as any).markedEvents);
        }
        else if (!(instance.eventMarks instanceof Set)) {
            instance.eventMarks = new Set();
        }
        if (typeof instance.markedForDestruction !== "boolean") {
            instance.markedForDestruction = Boolean(
                instance.trigger?.markedForDestruction || instance.trigger?.isToDelete,
            );
        }
        if (!(instance.remainingTargets instanceof Set)) {
            instance.remainingTargets = isSemiPersistentTag(firstTagForTrigger(instance.trigger))
                ? new Set(instance.targets ?? [])
                : new Set();
        }
        const runtime = this.ensureTagRuntime(firstTagForTrigger(instance.trigger), instance.targets ?? []);
        if (runtime && !runtime.destroyed) {
            if (runtime.lifetime === TagRepeatType.SemiPersistent) {
                const sameTagInstances = [...this.triggerInstances.values()].filter(candidate =>
                    triggerBelongsToTag(candidate.trigger, runtime.id));
                if (sameTagInstances.length <= 1 && instance.remainingTargets !== runtime.remainingTargets) {
                    if (instance.remainingTargets.size === 0 && instance.targets.length > 0 &&
                        runtime.targets.length === instance.targets.length) {
                        runtime.remainingTargets = new Set(instance.targets);
                    }
                    else {
                        runtime.remainingTargets = instance.remainingTargets;
                    }
                    runtime.targets = [...instance.targets];
                    this.targetsByTag.set(runtime.id, runtime.targets);
                }
                instance.remainingTargets = runtime.remainingTargets;
            }
            instance.targets = [...runtime.targets];
            for (const condition of instance.conditions) {
                condition.setTargets?.(instance.targets);
            }
        }
    }

    private isUnavailable(instance: TriggerInstance, context: any): boolean {
        return instance.finished || instance.markedForDestruction || instance.disabled ||
            !isTriggerEnabledForDifficulty(instance.trigger, context);
    }

    getHash(): number {
        const parts: (string | number)[] = ["TriggerManager"];
        for (const id of [...this.triggerInstances.keys()].sort(compareText)) {
            const instance = this.triggerInstances.get(id)!;
            this.normalizeInstance(instance);
            const remaining = [...instance.remainingTargets]
                .map(mapObjectFingerprint)
                .sort(compareText);
            const eventMarks = [...instance.eventMarks].sort((left, right) => left - right);
            parts.push(
                id,
                instance.disabled ? 1 : 0,
                instance.finished ? 1 : 0,
                instance.markedForDestruction ? 1 : 0,
                `rt:${remaining.join(",")}`,
                `em:${eventMarks.join(",")}`,
            );
        }
        for (const id of [...this.globalVariables.keys()].sort(compareText)) {
            parts.push(`gv:${id}:${this.globalVariables.get(id)!.value ? 1 : 0}`);
        }
        for (const id of [...this.localVariables.keys()].sort(compareText)) {
            parts.push(`lv:${id}:${this.localVariables.get(id)!.value ? 1 : 0}`);
        }
        parts.push(`pt:${[...this.pendingTagDestructions].sort(compareText).join(",")}`);
        parts.push(`aw:${this.allowWinHoldEntries().map(entry => entry.playerIndex === undefined
            ? `${entry.house}:${entry.count}`
            : `${entry.playerIndex}:${entry.count}`).join(",")}`);
        parts.push(scalarStateHash("pendingGameEvents", this.pendingGameEvents));
        return fnv32aStrings(parts);
    }

    captureState(): TriggerManagerState {
        return {
            version: TRIGGER_MANAGER_STATE_VERSION,
            instances: [...this.triggerInstances.entries()]
                .sort(([left], [right]) => compareText(left, right))
                .map(([id, instance]) => {
                    this.normalizeInstance(instance);
                    return {
                        id,
                        disabled: instance.disabled,
                        finished: instance.finished,
                        remainingTargets: [...instance.remainingTargets]
                            .map(mapObjectFingerprint)
                            .sort(compareText),
                        eventMarks: [...instance.eventMarks].sort((left, right) => left - right),
                        markedForDestruction: instance.markedForDestruction,
                    };
                }),
            globalVariables: [...this.globalVariables.entries()]
                .sort(([left], [right]) => compareText(left, right))
                .map(([id, variable]) => [id, variable.value] as [string, boolean]),
            localVariables: [...this.localVariables.entries()]
                .sort(([left], [right]) => compareText(left, right))
                .map(([id, variable]) => [id, variable.value] as [string, boolean]),
            pendingEventCount: this.pendingGameEvents.length,
            pendingTagDestructions: [...this.pendingTagDestructions].sort(compareText),
            allowWinHolds: this.allowWinHoldEntries(),
        };
    }

    restoreState(state: unknown, options: { strict?: boolean } = {}): void {
        const plan = this.prepareRestoreState(state, options);
        for (const restore of plan.restores) {
            restore.instance.disabled = restore.disabled;
            restore.instance.finished = restore.finished;
            restore.instance.remainingTargets = restore.remaining;
            restore.instance.eventMarks = restore.eventMarks;
            restore.instance.markedForDestruction = restore.markedForDestruction;
            if (restore.markedForDestruction && restore.instance.trigger &&
                typeof restore.instance.trigger === "object") {
                restore.instance.trigger.markedForDestruction = true;
            }
        }
        const restoredByTag = new Map<string, Set<MapObject>>();
        for (const restore of plan.restores) {
            const id = tagIdOf(firstTagForTrigger(restore.instance.trigger));
            if (id && !restoredByTag.has(id)) {
                restoredByTag.set(id, restore.remaining);
            }
        }
        for (const instance of this.triggerInstances.values()) {
            const id = tagIdOf(firstTagForTrigger(instance.trigger));
            const runtime = this.ensureTagRuntime(firstTagForTrigger(instance.trigger), instance.targets ?? []);
            const restore = plan.restores.find(entry => entry.instance === instance);
            if (runtime) {
                if (runtime.lifetime === TagRepeatType.SemiPersistent) {
                    const restored = id ? restoredByTag.get(id) : restore?.remaining;
                    if (restored) {
                        for (const target of runtime.targets) {
                            if (!restored.has(target)) {
                                this.clearTargetAttachment(runtime, target);
                            }
                        }
                        runtime.remainingTargets = restored;
                        runtime.targets = runtime.targets.filter(target => restored.has(target));
                        this.targetsByTag.set(runtime.id, runtime.targets);
                    }
                    instance.remainingTargets = runtime.remainingTargets;
                }
                else if (restore) {
                    instance.remainingTargets = restore.remaining;
                }
                instance.targets = [...runtime.targets];
                for (const condition of instance.conditions) {
                    condition.setTargets?.(instance.targets);
                }
            }
        }
        this.globalVariables.clear();
        for (const [id, variable] of plan.globalVariables) this.globalVariables.set(id, variable);
        this.localVariables.clear();
        for (const [id, variable] of plan.localVariables) this.localVariables.set(id, variable);
        this.allowWinHolds.clear();
        for (const [key, count] of plan.allowWinHolds) {
            this.allowWinHolds.set(key, count);
        }
        this.pendingGameEvents.length = 0;
        this.pendingTagDestructions.clear();
        this.pendingSemiDetachments.clear();
        for (const id of plan.pendingTagDestructions) {
            this.pendingTagDestructions.add(id);
            const runtime = this.tagRuntimes.get(id);
            if (runtime) {
                runtime.markedForDestruction = true;
                if (runtime.tag && typeof runtime.tag === "object") {
                    runtime.tag.markedForDestruction = true;
                }
            }
        }
    }

    validateState(state: unknown, options: { strict?: boolean } = {}): void {
        this.prepareRestoreState(state, options);
    }

    private prepareRestoreState(
        state: unknown,
        options: { strict?: boolean },
    ): TriggerManagerRestorePlan {
        if (!state || typeof state !== "object") {
            throw new Error("Invalid trigger manager state: expected an object");
        }
        const candidate = state as TriggerManagerState;
        if (candidate.version !== TRIGGER_MANAGER_STATE_VERSION) {
            throw new Error(`Unsupported trigger manager state version: ${String((state as any).version)}`);
        }
        if (!Array.isArray(candidate.instances) ||
            !Array.isArray(candidate.globalVariables) ||
            !Array.isArray(candidate.localVariables)) {
            throw new Error("Invalid trigger manager state: collections must be arrays");
        }
        if (!Number.isSafeInteger(candidate.pendingEventCount) || candidate.pendingEventCount < 0) {
            throw new Error("Invalid trigger manager state: pendingEventCount");
        }
        const strict = options.strict === true;
        if (candidate.pendingEventCount > 0 && strict) {
            throw new Error(
                "Cannot restore trigger state: in-flight trigger events are not restorable",
            );
        }
        const pendingTagDestructions = new Set<string>();
        for (const id of candidate.pendingTagDestructions ?? []) {
            if (typeof id !== "string" || id.length === 0) {
                throw new Error("Invalid trigger manager state: pending tag destruction");
            }
            if (pendingTagDestructions.has(id)) {
                if (strict) {
                    throw new Error(`Invalid trigger manager state: duplicate pending tag ${id}`);
                }
                continue;
            }
            pendingTagDestructions.add(id);
        }
        if (candidate.allowWinHolds !== undefined && !Array.isArray(candidate.allowWinHolds)) {
            throw new Error("Invalid trigger manager state: allow-win holds");
        }
        const allowWinHolds = new Map<string | number, number>();
        const seenAllowWinHolds = new Set<string>();
        for (const entry of candidate.allowWinHolds ?? []) {
            if (!entry || typeof entry !== "object" ||
                !Number.isSafeInteger(entry.count) || entry.count <= 0 ||
                (entry.playerIndex !== undefined &&
                    (!Number.isSafeInteger(entry.playerIndex) || entry.playerIndex < 0)) ||
                (entry.house !== undefined &&
                    (typeof entry.house !== "string" || entry.house.length === 0)) ||
                (entry.playerIndex === undefined && entry.house === undefined)) {
                throw new Error("Invalid trigger manager state: allow-win hold");
            }
            const resolvedPlayer = entry.playerIndex !== undefined
                ? this.context?.getAllPlayers?.()?.[entry.playerIndex]
                : this.resolveAllowWinPlayer(entry.house);
            const key = entry.playerIndex !== undefined
                ? entry.playerIndex
                : allowWinKeyOf(resolvedPlayer) ??
                    `house:${entry.house!.trim().toLocaleLowerCase("en-US")}`;
            const keyText = String(key);
            if (seenAllowWinHolds.has(keyText)) {
                if (strict) {
                    throw new Error(`Invalid trigger manager state: duplicate allow-win hold ${keyText}`);
                }
                continue;
            }
            seenAllowWinHolds.add(keyText);
            if (entry.playerIndex !== undefined) {
                if (!resolvedPlayer && strict) {
                    throw new Error(`Cannot restore trigger state: allow-win player ${entry.playerIndex} is unresolved`);
                }
            }
            else if (!resolvedPlayer && strict) {
                throw new Error(`Cannot restore trigger state: allow-win house ${entry.house} is unresolved`);
            }
            allowWinHolds.set(key, entry.count);
        }
        const seenTriggers = new Set<string>();
        for (const entry of candidate.instances) {
            if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || entry.id.length === 0) {
                throw new Error("Invalid trigger manager state: trigger id");
            }
            const validEventMarks = entry.eventMarks === undefined ||
                (Array.isArray(entry.eventMarks) &&
                    entry.eventMarks.every(mark => Number.isSafeInteger(mark) && mark >= 0));
            const validDestructionMark = entry.markedForDestruction === undefined ||
                typeof entry.markedForDestruction === "boolean";
            if (typeof entry.disabled !== "boolean" || typeof entry.finished !== "boolean" ||
                !Array.isArray(entry.remainingTargets) ||
                entry.remainingTargets.some(target => typeof target !== "string") ||
                !validEventMarks || !validDestructionMark) {
                throw new Error(`Invalid trigger manager state: trigger ${entry.id}`);
            }
            if (seenTriggers.has(entry.id)) {
                throw new Error(`Invalid trigger manager state: duplicate trigger ${entry.id}`);
            }
            seenTriggers.add(entry.id);
        }
        const normalizeVariables = (entries: [string, boolean][], scope: string): Map<string, Variable> => {
            const variables = new Map<string, Variable>();
            for (const entry of entries) {
                if (!Array.isArray(entry) || typeof entry[0] !== "string" || entry[0].length === 0 ||
                    typeof entry[1] !== "boolean") {
                    throw new Error(`Invalid trigger manager state: ${scope} variable`);
                }
                if (variables.has(entry[0])) {
                    throw new Error(`Invalid trigger manager state: duplicate ${scope} variable ${entry[0]}`);
                }
                variables.set(entry[0], new Variable("No name", entry[1], scope === "global"));
            }
            return variables;
        };
        const globalVariables = normalizeVariables(candidate.globalVariables, "global");
        const localVariables = normalizeVariables(candidate.localVariables, "local");
        const restores: TriggerManagerRestorePlan["restores"] = [];
        for (const entry of candidate.instances) {
            const instance = this.triggerInstances.get(entry.id);
            if (!instance) {
                if (strict) {
                    throw new Error(`Cannot restore trigger state: trigger ${entry.id} is unresolved`);
                }
                continue;
            }
            const remaining = new Set<MapObject>();
            const seenTargets = new Set<string>();
            for (const fingerprint of entry.remainingTargets) {
                if (seenTargets.has(fingerprint)) {
                    if (strict) {
                        throw new Error(
                            `Cannot restore trigger state: duplicate target ${fingerprint}`,
                        );
                    }
                    continue;
                }
                seenTargets.add(fingerprint);
                const target = instance.targets.find(
                    (candidateTarget) => mapObjectFingerprint(candidateTarget) === fingerprint,
                );
                if (!target) {
                    if (strict) {
                        throw new Error(
                            `Cannot restore trigger state: target ${fingerprint} is unresolved`,
                        );
                    }
                    continue;
                }
                remaining.add(target);
            }
            const validEventIndexes = conditionEventIndexes(instance);
            const eventMarks = new Set<number>();
            for (const mark of entry.eventMarks ?? []) {
                if (!validEventIndexes.has(mark)) {
                    if (strict) {
                        throw new Error(`Cannot restore trigger state: event mark ${mark} is unresolved`);
                    }
                    continue;
                }
                if (eventMarks.has(mark)) {
                    if (strict) {
                        throw new Error(`Cannot restore trigger state: duplicate event mark ${mark}`);
                    }
                    continue;
                }
                eventMarks.add(mark);
            }
            restores.push({
                instance,
                disabled: entry.disabled,
                finished: entry.finished,
                remaining,
                eventMarks,
                markedForDestruction: entry.markedForDestruction ?? false,
            });
        }
        if (strict && seenTriggers.size !== this.triggerInstances.size) {
            throw new Error("Cannot restore trigger state: trigger snapshot is incomplete");
        }
        return { restores, globalVariables, localVariables, pendingTagDestructions, allowWinHolds };
    }

    update(context: GameContext): void {
        const events = this.pendingGameEvents.splice(0, this.pendingGameEvents.length);
        for (const instance of [...this.triggerInstances.values()]) {
            this.normalizeInstance(instance);
            if (this.isUnavailable(instance, context)) {
                continue;
            }
            const runtime = this.ensureTagRuntime(firstTagForTrigger(instance.trigger), instance.targets ?? []);
            if (runtime?.destroyed) {
                continue;
            }
            const tagId = runtime?.id ?? tagIdOf(firstTagForTrigger(instance.trigger));
            if (tagId && this.springingTags.has(tagId)) {
                continue;
            }
            const lifetime = runtime?.lifetime ?? tagLifetime(firstTagForTrigger(instance.trigger));
            const persistent = lifetime === TagRepeatType.Persistent;
            if (!persistent) {
                instance.eventMarks.clear();
            }
            let allConditionsMet = true;
            let returnedTargets = false;
            const triggeredTargets: MapObject[] = [];
            for (let index = 0; index < instance.conditions.length; index++) {
                const condition = instance.conditions[index];
                const event = condition.event ?? instance.trigger?.events?.[index];
                const eventIndex = conditionEventIndex(condition, index);
                const result = persistent && instance.eventMarks.has(eventIndex)
                    ? true
                    : condition.check(context, events);
                if (typeof result === "boolean") {
                    if (!result) {
                        allConditionsMet = false;
                    }
                    else if (persistent && conditionCanRemember(condition, event)) {
                        instance.eventMarks.add(eventIndex);
                    }
                }
                else if (Array.isArray(result)) {
                    if (result.length) {
                        returnedTargets = true;
                        triggeredTargets.push(...result);
                        if (persistent && conditionCanRemember(condition, event)) {
                            instance.eventMarks.add(eventIndex);
                        }
                    }
                    else {
                        allConditionsMet = false;
                    }
                }
                else {
                    allConditionsMet = false;
                }
            }
            if (!allConditionsMet) {
                continue;
            }
            if (lifetime === TagRepeatType.SemiPersistent &&
                (!runtime || !this.prepareSemiPersistentFiring(runtime, triggeredTargets, returnedTargets, events))) {
                continue;
            }
            const targets = this.resolveActionTargets(instance, triggeredTargets, returnedTargets, events);
            instance.conditions.forEach(condition => condition.reset?.());
            if (tagId) {
                this.springingTags.add(tagId);
            }
            try {
                this.executeActions(instance.trigger, targets, context);
            }
            finally {
                if (tagId) {
                    this.springingTags.delete(tagId);
                }
            }
            this.completeFiring(instance, runtime, lifetime);
        }
        this.flushSemiDetachments();
        this.processDeferredDestruction();
    }

    private prepareSemiPersistentFiring(
        runtime: TagRuntime,
        triggeredTargets: MapObject[],
        returnedTargets: boolean,
        events: any[],
    ): boolean {
        if (runtime.remainingTargets.size === 0) {
            return false;
        }
        const matchingTargets = returnedTargets
            ? triggeredTargets.filter(target => runtime.remainingTargets.has(target))
            : this.offerTargets(events, runtime);
        if (runtime.remainingTargets.size === 1) {
            return true;
        }
        if (matchingTargets.length) {
            const pending = this.pendingSemiDetachments.get(runtime.id) ?? [];
            for (const target of matchingTargets) {
                if (!pending.includes(target)) {
                    pending.push(target);
                }
            }
            this.pendingSemiDetachments.set(runtime.id, pending);
            return false;
        }
        return false;
    }

    private offerTargets(events: any[], runtime: TagRuntime): MapObject[] {
        for (const event of events) {
            for (const candidate of [event?.target, event?.source, event?.object]) {
                if (candidate && runtime.remainingTargets.has(candidate)) {
                    return [candidate];
                }
            }
        }
        return [];
    }

    private flushSemiDetachments(): void {
        for (const id of [...this.pendingSemiDetachments.keys()].sort(compareText)) {
            const runtime = this.tagRuntimes.get(id);
            const targets = this.pendingSemiDetachments.get(id) ?? [];
            if (runtime && !runtime.destroyed) {
                this.detachTargets(runtime, targets);
            }
        }
        this.pendingSemiDetachments.clear();
    }

    private resolveActionTargets(
        instance: TriggerInstance,
        triggeredTargets: MapObject[],
        returnedTargets: boolean,
        events: any[],
    ): MapObject[] {
        if (returnedTargets) {
            const targets = triggeredTargets.filter(target => instance.targets.includes(target));
            if (targets.length) {
                return targets;
            }
        }
        for (const event of events) {
            for (const candidate of [event?.target, event?.source, event?.object]) {
                if (candidate && instance.targets.includes(candidate)) {
                    return [candidate];
                }
            }
        }
        return [...instance.targets];
    }

    private markInstanceForDestruction(instance: TriggerInstance): void {
        instance.finished = true;
        instance.markedForDestruction = true;
        if (instance.trigger && typeof instance.trigger === "object") {
            instance.trigger.markedForDestruction = true;
        }
    }

    private completeFiring(
        instance: TriggerInstance,
        runtime: TagRuntime | undefined,
        lifetime: TagRepeatType,
    ): void {
        if (lifetime === TagRepeatType.Persistent) {
            return;
        }
        this.markInstanceForDestruction(instance);
        this.markTagForDestruction(runtime?.id ?? tagIdOf(firstTagForTrigger(instance.trigger)), runtime);
    }

    private markTagForDestruction(id: string, runtime?: TagRuntime): void {
        if (!id) {
            return;
        }
        const tagRuntime = runtime ?? this.tagRuntimes.get(id) ?? this.ensureTagRuntime(id);
        if (!tagRuntime) {
            return;
        }
        tagRuntime.markedForDestruction = true;
        if (tagRuntime.tag && typeof tagRuntime.tag === "object") {
            tagRuntime.tag.markedForDestruction = true;
        }
        this.pendingTagDestructions.add(id);
    }

    private clearTargetAttachment(runtime: TagRuntime, target: MapObject): void {
        const currentTag = (target as any)?.tag;
        if (currentTag === runtime.tag || tagIdOf(currentTag) === runtime.id) {
            try {
                (target as any).tag = undefined;
            }
            catch {
            }
        }
    }

    private detachAllTargets(runtime: TagRuntime): void {
        this.detachTargets(runtime, runtime.targets);
    }

    private detachTargets(runtime: TagRuntime, targets: MapObject[]): void {
        const removed = new Set(targets);
        for (const target of removed) {
            runtime.remainingTargets.delete(target);
            this.clearTargetAttachment(runtime, target);
        }
        runtime.targets = runtime.targets.filter(target => !removed.has(target));
        this.targetsByTag.set(runtime.id, runtime.targets);
        this.syncTagInstances(runtime);
    }

    private syncTagInstances(runtime: TagRuntime): void {
        for (const instance of this.triggerInstances.values()) {
            if (!triggerBelongsToTag(instance.trigger, runtime.id)) {
                continue;
            }
            instance.targets = [...runtime.targets];
            instance.remainingTargets = runtime.lifetime === TagRepeatType.SemiPersistent
                ? runtime.remainingTargets
                : new Set();
            for (const condition of instance.conditions) {
                condition.setTargets?.(instance.targets);
            }
        }
    }

    private firstLiveTrigger(runtime: TagRuntime): any | undefined {
        for (const trigger of runtime.triggerChain) {
            const instance = [...this.triggerInstances.values()].find(candidate =>
                candidate.trigger === trigger || keyOf(candidate.trigger?.id) === keyOf(trigger?.id));
            if (instance && !instance.markedForDestruction && !instance.finished) {
                return instance.trigger;
            }
        }
        if (runtime.triggerChain.length) {
            return undefined;
        }
        const fallback = [...this.triggerInstances.values()].find(instance =>
            !instance.markedForDestruction && !instance.finished &&
            triggerBelongsToTag(instance.trigger, runtime.id));
        return fallback?.trigger;
    }

    private releaseAllowWinHold(runtime: TagRuntime): void {
        const allowWin = runtime.allowWin || runtime.triggerChain.some(triggerHasAllowWin) ||
            [...this.triggerInstances.values()].some(instance =>
                triggerBelongsToTag(instance.trigger, runtime.id) && triggerHasAllowWin(instance.trigger));
        if (!allowWin) {
            return;
        }
        const liveTrigger = this.firstLiveTrigger(runtime);
        if (!liveTrigger) {
            return;
        }
        const player = this.context
            ? resolveTriggerHousePlayer(this.context, liveTrigger) ??
                this.context.resolveMapOwner?.(liveTrigger.houseName)
            : undefined;
        const key = allowWinKeyOf(player);
        if (key !== undefined) {
            this.decrementAllowWinHold(key);
        }
    }

    private processDeferredDestruction(): void {
        const markedTriggerIds = [...this.triggerInstances.entries()]
            .filter(([, instance]) => instance.markedForDestruction)
            .map(([id]) => id)
            .sort(compareText);
        for (const id of markedTriggerIds) {
            this.triggerInstances.delete(id);
        }
        const tagIds = [...this.pendingTagDestructions].sort(compareText);
        for (const id of tagIds) {
            const runtime = this.tagRuntimes.get(id);
            if (runtime) {
                this.releaseAllowWinHold(runtime);
            }
            const triggerIds = [...this.triggerInstances.entries()]
                .filter(([, instance]) => triggerBelongsToTag(instance.trigger, id))
                .map(([triggerId]) => triggerId)
                .sort(compareText);
            for (const triggerId of triggerIds) {
                this.triggerInstances.delete(triggerId);
            }
            if (runtime) {
                this.detachAllTargets(runtime);
                runtime.destroyed = true;
                runtime.markedForDestruction = false;
            }
            this.targetsByTag.delete(id);
            this.pendingTagDestructions.delete(id);
        }
    }

    private executeActions(trigger: Trigger, targets: MapObject[], context: GameContext): void {
        for (const action of trigger.actions ?? []) {
            const executor = this.executorFactory.create(action, trigger);
            executor.execute(context, targets as any);
        }
    }

    private matchingTriggerInstances(reference: unknown): TriggerInstance[] {
        const id = keyOf(reference);
        return [...this.triggerInstances.entries()]
            .filter(([, instance]) => triggerReferenceMatches(instance.trigger, id))
            .sort(([left], [right]) => compareText(left, right))
            .map(([, instance]) => instance);
    }

    setTriggerEnabled(triggerId: string, enabled: boolean): void {
        for (const instance of this.matchingTriggerInstances(triggerId)) {
            instance.disabled = !enabled;
            if (enabled) {
                instance.conditions.forEach(condition => condition.reset?.());
            }
        }
    }

    forceTrigger(triggerId: string, context: GameContext): void {
        for (const instance of this.matchingTriggerInstances(triggerId)) {
            this.normalizeInstance(instance);
            if (this.isUnavailable(instance, context)) {
                continue;
            }
            this.executeActions(instance.trigger, instance.targets, context);
        }
    }

    destroyTrigger(triggerId: string): void {
        for (const instance of this.matchingTriggerInstances(triggerId)) {
            this.markInstanceForDestruction(instance);
        }
    }

    destroyTag(tagId: string): void {
        for (const instance of this.triggerInstances.values()) {
            this.ensureTagRuntime(firstTagForTrigger(instance.trigger), instance.targets ?? []);
        }
        let id = keyOf(tagId);
        if (!id) {
            return;
        }
        let runtime = this.tagRuntimes.get(id);
        if (!runtime) {
            const normalized = id.toLocaleLowerCase("en-US");
            runtime = [...this.tagRuntimes.values()].find(candidate =>
                keyOf(candidate.tag?.name).toLocaleLowerCase("en-US") === normalized);
            if (runtime) {
                id = runtime.id;
            }
        }
        runtime ??= this.ensureTagRuntime(id);
        this.markTagForDestruction(id, runtime);
        for (const instance of [...this.triggerInstances.values()]) {
            if (!triggerBelongsToTag(instance.trigger, id)) {
                continue;
            }
            let current = instance.trigger;
            const seen = new Set<any>();
            while (current && !seen.has(current)) {
                seen.add(current);
                const linkedTagId = tagIdOf(current.tag);
                if (linkedTagId) {
                    this.ensureTagRuntime(current.tag, this.targetsByTag.get(linkedTagId));
                }
                current = current.attachedTrigger;
            }
        }
    }

    getGlobalVariable(id: string): boolean {
        return !!this.globalVariables.get(id)?.value;
    }

    toggleGlobalVariable(id: string, value: boolean): void {
        const variable = this.globalVariables.get(id);
        if (variable === undefined) {
            this.globalVariables.set(id, new Variable("No name", value, true));
        }
        else {
            variable.value = value;
        }
    }

    getLocalVariable(id: string): boolean {
        return !!this.localVariables.get(id)?.value;
    }

    toggleLocalVariable(id: string, value: boolean): void {
        const variable = this.localVariables.get(id);
        if (variable === undefined) {
            this.localVariables.set(id, new Variable("No name", value, false));
        }
        else {
            variable.value = value;
        }
    }

    dispose(): void {
        this.disposables.dispose();
    }
}
