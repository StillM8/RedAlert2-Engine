import { EventDispatcher } from '@/util/event';
import { fnv32aStrings } from '@/util/math';
export enum QueueType {
    Structures = 0,
    Armory = 1,
    Infantry = 2,
    Vehicles = 3,
    Aircrafts = 4,
    Ships = 5
}
export enum QueueStatus {
    Idle = 0,
    Active = 1,
    OnHold = 2,
    Ready = 3
}
interface QueueItem {
    rules: any;
    quantity: number;
    creditsEach: number;
    creditsSpent: number;
    creditsSpentLeftover: number;
    progress: number;
}

export const PRODUCTION_QUEUE_STATE_VERSION = 1 as const;

export interface ProductionQueueItemState {
    readonly technoTypeName: string;
    readonly quantity: number;
    readonly creditsEach: number;
    readonly creditsSpent: number;
    readonly creditsSpentLeftover: number;
    readonly progress: number;
}

export interface ProductionQueueState {
    readonly version: typeof PRODUCTION_QUEUE_STATE_VERSION;
    readonly type: QueueType;
    readonly maxSize: number;
    readonly maxItemQuantity: number;
    readonly size: number;
    readonly status: QueueStatus;
    readonly items: readonly ProductionQueueItemState[];
}

export interface ProductionQueueRestoreContext {
    /** Rebinds a stable authored TechnoType name to loaded rules. */
    resolveRules?(name: string): unknown;
    /** Strict canonical restore rejects missing authored rules. */
    strict?: boolean;
}
export class ProductionQueue {
    public readonly type: QueueType;
    private _maxSize: number;
    private maxItemQuantity: number;
    private items: QueueItem[];
    private size: number;
    private _status: QueueStatus;
    private _onUpdate: EventDispatcher<ProductionQueue>;
    get onUpdate() {
        return this._onUpdate.asEvent();
    }
    constructor(type: QueueType, maxSize: number, maxItemQuantity: number) {
        this.type = type;
        this._maxSize = maxSize;
        this.maxItemQuantity = maxItemQuantity;
        this.items = [];
        this.size = 0;
        this._status = QueueStatus.Idle;
        this._onUpdate = new EventDispatcher();
    }
    get status(): QueueStatus {
        return this._status;
    }
    set status(value: QueueStatus) {
        const oldStatus = this._status;
        this._status = value;
        if (value !== oldStatus) {
            this._onUpdate.dispatch(this);
        }
    }
    get maxSize(): number {
        return this._maxSize;
    }
    set maxSize(value: number) {
        const oldSize = this.size;
        this.size = Math.min(value, this.size);
        let totalQuantity = 0;
        let itemIndex = 0;
        while (totalQuantity <= this.size && itemIndex < this.items.length) {
            const item = this.items[itemIndex];
            totalQuantity += item.quantity;
            if (totalQuantity > this.size) {
                item.quantity -= totalQuantity - this.size;
            }
            if (item.quantity > 0) {
                itemIndex++;
            }
        }
        this._maxSize = value;
        if (this.items[itemIndex]) {
            this.items.splice(itemIndex);
        }
        if (oldSize !== this.size) {
            if (!this.size) {
                this._status = QueueStatus.Idle;
            }
            this._onUpdate.dispatch(this);
        }
    }
    get currentSize(): number {
        return this.size;
    }
    find(rules: any): QueueItem[] {
        return this.items.filter(item => item.rules === rules);
    }
    getFirst(): QueueItem | undefined {
        return this.items[0];
    }
    getAll(): QueueItem[] {
        return [...this.items];
    }
    push(rules: any, quantity: number, creditsEach: number) {
        quantity = Math.min(this.maxSize - this.size, quantity);
        const existingQuantity = this.find(rules).reduce((sum, item) => sum + item.quantity, 0);
        quantity = Math.min(this.maxItemQuantity - existingQuantity, quantity);
        const lastItem = this.items[this.items.length - 1];
        if (lastItem?.rules === rules) {
            lastItem.quantity += quantity;
        }
        else {
            this.items.push({
                rules,
                quantity,
                creditsEach,
                creditsSpent: 0,
                creditsSpentLeftover: 0,
                progress: 0
            });
        }
        this.size += quantity;
        if (quantity) {
            if (this._status === QueueStatus.Idle) {
                this._status = QueueStatus.Active;
            }
            this._onUpdate.dispatch(this);
        }
    }
    insertAfterFirst(rules: any, quantity: number, creditsEach: number) {
        quantity = Math.min(this.maxSize - this.size, quantity);
        const existingQuantity = this.find(rules).reduce((sum, item) => sum + item.quantity, 0);
        quantity = Math.min(this.maxItemQuantity - existingQuantity, quantity);
        if (!quantity) {
            return;
        }
        if (!this.items.length) {
            this.push(rules, quantity, creditsEach);
            return;
        }
        const first = this.items[0];
        const firstRemainingQuantity = Math.max(0, first.quantity - 1);
        first.quantity = 1;
        const items = [first];
        const tail = this.items.slice(1);
        items.push({
            rules,
            quantity,
            creditsEach,
            creditsSpent: 0,
            creditsSpentLeftover: 0,
            progress: 0,
        });
        if (firstRemainingQuantity > 0) {
            items.push({
                rules: first.rules,
                quantity: firstRemainingQuantity,
                creditsEach: first.creditsEach,
                creditsSpent: 0,
                creditsSpentLeftover: 0,
                progress: 0,
            });
        }
        items.push(...tail);
        this.items = items;
        this.size += quantity;
        if (this._status === QueueStatus.Idle) {
            this._status = QueueStatus.Active;
        }
        this._onUpdate.dispatch(this);
    }
    pop(rules: any, quantity: number) {
        this.remove(rules, quantity, false);
    }
    shift(rules: any, quantity: number) {
        this.remove(rules, quantity, true);
    }
    private remove(rules: any, quantity: number, fromStart: boolean) {
        const matchingItems = this.find(rules);
        if (!matchingItems.length) {
            throw new Error(`Can't remove non-existent item ${rules.name} from queue ${QueueType[this.type]}`);
        }
        const totalQuantity = matchingItems.reduce((sum, item) => sum + item.quantity, 0);
        if (totalQuantity < quantity) {
            throw new Error(`Attempted to remove a quantity larger than the one in queue (${rules.name})`);
        }
        let remainingQuantity = quantity;
        while (remainingQuantity > 0) {
            const item = fromStart ? matchingItems.shift() : matchingItems.pop();
            if (item!.quantity <= remainingQuantity) {
                const wasFirst = this.getFirst() === item;
                this.items.splice(this.items.indexOf(item!), 1);
                if (wasFirst) {
                    this._status = QueueStatus.Active;
                }
                remainingQuantity -= item!.quantity;
            }
            else {
                item!.quantity -= remainingQuantity;
                remainingQuantity = 0;
            }
        }
        this.size -= quantity;
        if (quantity) {
            if (!this.size) {
                this._status = QueueStatus.Idle;
            }
            this._onUpdate.dispatch(this);
        }
    }
    notifyUpdated() {
        this._onUpdate.dispatch(this);
    }

    /** JSON-safe canonical queue state. Item order is gameplay order. */
    captureState(): ProductionQueueState {
        return {
            version: PRODUCTION_QUEUE_STATE_VERSION,
            type: this.type,
            maxSize: this._maxSize,
            maxItemQuantity: this.maxItemQuantity,
            size: this.size,
            status: this._status,
            items: this.items.map(item => ({
                technoTypeName: authoredTechnoTypeName(item.rules),
                quantity: item.quantity,
                creditsEach: item.creditsEach,
                creditsSpent: item.creditsSpent,
                creditsSpentLeftover: item.creditsSpentLeftover,
                progress: item.progress,
            })),
        };
    }

    /** Hashes the exact ordered queue state, including fractional progress. */
    getHash(): number {
        const state = this.captureState();
        const parts: (string | number)[] = [
            "production-queue",
            state.type,
            state.maxSize,
            state.maxItemQuantity,
            state.size,
            state.status,
            state.items.length,
        ];
        for (const item of state.items) {
            parts.push(
                item.technoTypeName,
                item.quantity,
                item.creditsEach,
                item.creditsSpent,
                item.creditsSpentLeftover,
                item.progress,
            );
        }
        return fnv32aStrings(parts);
    }

    /** Validate and resolve without changing this queue. */
    prepareRestoreState(state: unknown, context: ProductionQueueRestoreContext = {}): QueueRestorePlan {
        if (typeof state !== "object" || state === null) {
            throw new Error("Invalid production queue state: expected an object");
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== PRODUCTION_QUEUE_STATE_VERSION) {
            throw new Error(`Unsupported production queue state version: ${String(candidate.version)}`);
        }
        if (candidate.type !== this.type) {
            throw new Error(`Invalid production queue state: expected queue ${this.type}`);
        }
        const maxSize = nonNegativeInteger(candidate.maxSize, "maxSize");
        const maxItemQuantity = nonNegativeInteger(candidate.maxItemQuantity, "maxItemQuantity");
        const size = nonNegativeInteger(candidate.size, "size");
        const status = queueStatus(candidate.status);
        if (!Array.isArray(candidate.items)) {
            throw new Error("Invalid production queue state: items must be an array");
        }

        const items: QueueItem[] = [];
        let totalQuantity = 0;
        for (const [index, rawItem] of candidate.items.entries()) {
            if (typeof rawItem !== "object" || rawItem === null) {
                throw new Error(`Invalid production queue state: item ${index} must be an object`);
            }
            const item = rawItem as Record<string, unknown>;
            if (typeof item.technoTypeName !== "string" || item.technoTypeName.trim().length === 0) {
                throw new Error(`Invalid production queue state: item ${index} has no TechnoType identity`);
            }
            const quantity = positiveInteger(item.quantity, `items[${index}].quantity`);
            const creditsEach = nonNegativeNumber(item.creditsEach, `items[${index}].creditsEach`);
            const creditsSpent = nonNegativeNumber(item.creditsSpent, `items[${index}].creditsSpent`);
            const creditsSpentLeftover = fractionalNumber(item.creditsSpentLeftover, `items[${index}].creditsSpentLeftover`);
            const progress = boundedNumber(item.progress, 0, 1, `items[${index}].progress`);
            if (creditsSpent > creditsEach) {
                throw new Error(`Invalid production queue state: items[${index}].creditsSpent exceeds creditsEach`);
            }
            totalQuantity += quantity;
            if (totalQuantity > maxSize) {
                throw new Error("Invalid production queue state: item quantity exceeds maxSize");
            }
            const rules = context.resolveRules?.(item.technoTypeName);
            if (context.strict && rules === undefined) {
                throw new Error(`Cannot restore production queue item: rules ${item.technoTypeName} are unresolved`);
            }
            items.push({
                rules: rules ?? { name: item.technoTypeName },
                quantity,
                creditsEach,
                creditsSpent,
                creditsSpentLeftover,
                progress,
            });
        }
        if (totalQuantity !== size) {
            throw new Error(`Invalid production queue state: size ${size} does not match item quantities ${totalQuantity}`);
        }
        if (size > maxSize) {
            throw new Error("Invalid production queue state: size exceeds maxSize");
        }
        return { maxSize, maxItemQuantity, size, status, items };
    }

    /** Apply a plan that has already completed all validation/resolution. */
    applyRestorePlan(plan: QueueRestorePlan): void {
        this._maxSize = plan.maxSize;
        this.maxItemQuantity = plan.maxItemQuantity;
        this.size = plan.size;
        this._status = plan.status;
        this.items = plan.items;
    }

    restoreState(state: unknown, context: ProductionQueueRestoreContext = {}): void {
        this.applyRestorePlan(this.prepareRestoreState(state, context));
        this._onUpdate.dispatch(this);
    }
}

export interface QueueRestorePlan {
    readonly maxSize: number;
    readonly maxItemQuantity: number;
    readonly size: number;
    readonly status: QueueStatus;
    readonly items: QueueItem[];
}

function authoredTechnoTypeName(rules: any): string {
    const name = typeof rules?.name === "string" ? rules.name.trim() : "";
    if (!name) throw new Error("Cannot serialize production queue item without a TechnoType name");
    return name;
}

function nonNegativeInteger(value: unknown, field: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error(`Invalid production queue state: ${field} must be a non-negative integer`);
    }
    return value as number;
}

function positiveInteger(value: unknown, field: string): number {
    const normalized = nonNegativeInteger(value, field);
    if (normalized === 0) throw new Error(`Invalid production queue state: ${field} must be positive`);
    return normalized;
}

function nonNegativeNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid production queue state: ${field} must be non-negative`);
    }
    return value;
}

function fractionalNumber(value: unknown, field: string): number {
    const normalized = nonNegativeNumber(value, field);
    if (normalized >= 1) throw new Error(`Invalid production queue state: ${field} must be less than one`);
    return normalized;
}

function boundedNumber(value: unknown, min: number, max: number, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        throw new Error(`Invalid production queue state: ${field} is out of range`);
    }
    return value;
}

function queueStatus(value: unknown): QueueStatus {
    if (!Number.isSafeInteger(value) || (value as number) < QueueStatus.Idle || (value as number) > QueueStatus.Ready) {
        throw new Error("Invalid production queue state: status");
    }
    return value as QueueStatus;
}
