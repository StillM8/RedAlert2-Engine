import { TaskRunner } from "@/game/gameobject/task/system/TaskRunner";
import { TaskStatus } from "@/game/gameobject/task/system/TaskStatus";
import { fnv32aStrings } from "@/util/math";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { WaitTicksTask } from "@/game/gameobject/task/system/WaitTicksTask";
import { TurnTask } from "@/game/gameobject/task/TurnTask";
import { getTaskStateFactory, registerTaskStateFactory } from "@/game/gameobject/task/TaskStateRegistry";
import { captureOrder, restoreOrder, validateOrderState } from "@/game/order/OrderState";

/** Task fields every task carries regardless of its concrete type. */
function applyCommonTaskState(task: any, entry: any): void {
    task.status = entry.status;
    task.cancellable = entry.cancellable !== false;
    task.blocking = entry.blocking !== false;
    task.waitingForChildrenToFinish = entry.waitingForChildrenToFinish === true;
    task.preventOpportunityFire = entry.preventOpportunityFire !== false;
    task.preventLanding = entry.preventLanding !== false;
    task.isAttackMove = entry.isAttackMove === true;
}

registerTaskStateFactory("wait-ticks", (payload) => {
    if (!Number.isSafeInteger(payload?.ticks)) {
        throw new Error("Invalid wait task ticks");
    }
    return new WaitTicksTask(payload.ticks);
});

registerTaskStateFactory("turn", (payload) => {
    if (!Number.isFinite(payload?.direction)) {
        throw new Error("Invalid turn task direction");
    }
    return new TurnTask(payload.direction);
});
import { NotifyOwnerChange } from "@/game/gameobject/trait/interface/NotifyOwnerChange";
import { CallbackTask } from "@/game/gameobject/task/system/CallbackTask";
import { NotifyTeleport } from "@/game/gameobject/trait/interface/NotifyTeleport";
import { NotifyOrder } from "@/game/gameobject/trait/interface/NotifyOrder";
interface GameObject {
    isSpawned: boolean;
    resetGuardModeToIdle(): void;
    traits: {
        filter(type: any): any[];
    };
    unitOrderTrait: UnitOrderTrait;
}
interface Task {
    isCancelling(): boolean;
    cancel(): void;
    status: TaskStatus;
    useChildTargetLines?: boolean;
    children?: Task[];
    getTargetLinesConfig?(gameObject: GameObject): any;
    getDeterministicState?(): Record<string, unknown>;
}
interface Order {
    isValid(): boolean;
    isAllowed(): boolean;
    process(): Task[] | null;
    onAdd(tasks: Task[], queued: boolean): boolean | void;
    orderType: string;
}
interface Waypoint {
    next?: Waypoint;
}
interface WaypointPath {
    waypoints: Waypoint[];
    units: GameObject[];
}
export class UnitOrderTrait implements NotifyTick, NotifyOwnerChange, NotifyTeleport {
    private gameObject: GameObject;
    private orders: Order[] = [];
    private queuedOrders = new Set<Order>();
    private tasks: Task[] = [];
    private taskRunner = new TaskRunner();
    private waypointPath?: WaypointPath;
    private currentWaypoint?: Waypoint;
    private targetLinesTask?: Task;
    private targetLinesConfig?: any;
    constructor(gameObject: GameObject) {
        this.gameObject = gameObject;
    }
    /**
     * Orders are fully restorable: each one is rebuilt from its `OrderType`
     * (which fully determines its constructor flags) plus a stable target
     * reference. Tasks are the remaining open graph, so a task without an
     * explicit contract stays marked `unclassified-task` and strict restore
     * refuses it rather than silently dropping it.
     */
    captureState(): Record<string, unknown> {
        return {
            version: 2,
            orders: this.orders.map(order => captureOrder(order, this.queuedOrders.has(order))),
            tasks: this.tasks.map(task => task.getDeterministicState?.() ?? {
                type: "unclassified-task",
                status: task.status,
            }),
            waypointPath: this.waypointPath
                ? {
                    waypointCount: this.waypointPath.waypoints.length,
                    unitIds: this.waypointPath.units
                        .map(unit => (unit as any)?.id)
                        .filter((id: any) => Number.isSafeInteger(id)),
                }
                : null,
            currentWaypointIndex: this.currentWaypoint
                ? this.waypointPath?.waypoints.indexOf(this.currentWaypoint) ?? -1
                : null,
        };
    }
    validateState(state: unknown, options: { strict?: boolean } = {}): Record<string, any> {
        if (!state || typeof state !== "object") {
            throw new Error("Invalid unit order state");
        }
        const candidate = state as Record<string, any>;
        if (candidate.version === 1) {
            throw new Error(
                "Unsupported unit order state version: 1 (order restoration requires version 2)",
            );
        }
        if (candidate.version !== 2 || !Array.isArray(candidate.orders) ||
            !Array.isArray(candidate.tasks)) {
            throw new Error("Invalid unit order state");
        }
        for (const [index, entry] of candidate.orders.entries()) {
            validateOrderState(entry, `orders[${index}]`);
        }
        for (const task of candidate.tasks) {
            if (!task || typeof task !== "object" || typeof task.type !== "string" ||
                !Number.isSafeInteger(task.status) || !Array.isArray(task.children)) {
                throw new Error("Invalid unit order task state");
            }
        }
        if (candidate.waypointPath !== null && candidate.waypointPath !== undefined) {
            const path = candidate.waypointPath;
            if (!Number.isSafeInteger(path.waypointCount) || path.waypointCount < 0 ||
                !Array.isArray(path.unitIds) ||
                path.unitIds.some((id: any) => !Number.isSafeInteger(id))) {
                throw new Error("Invalid unit order waypoint path state");
            }
        }
        if (candidate.currentWaypointIndex !== null && candidate.currentWaypointIndex !== undefined &&
            !Number.isSafeInteger(candidate.currentWaypointIndex)) {
            throw new Error("Invalid unit order current waypoint index");
        }
        return candidate;
    }
    restoreState(
        state: unknown,
        options: { strict?: boolean; game?: any; resolveObjectById?: (id: number) => any } = {},
    ): void {
        const parsed = this.validateState(state, options);
        const strict = options.strict === true;
        const context = {
            game: options.game,
            resolveObjectById: options.resolveObjectById,
            strict,
        };
        // Task factories need tile/rule resolution in addition to the object
        // lookup, so the wider restore context is forwarded verbatim.
        const traitOptions = { ...options } as Record<string, unknown>;
        // Everything below resolves before any mutation, so a rejected
        // checkpoint cannot leave a partially rebuilt order queue behind.
        const restoredOrders: any[] = [];
        const queuedOrders = new Set<any>();
        for (const [index, entry] of parsed.orders.entries()) {
            if (!context.game && strict) {
                throw new Error("Cannot restore unit order state: game context is unresolved");
            }
            const { order, queued } = restoreOrder(entry, this.gameObject, context, `orders[${index}]`);
            restoredOrders.push(order);
            if (queued) queuedOrders.add(order);
        }
        const restoreTask = (entry: any): any => {
            const factory = getTaskStateFactory(entry?.type);
            if (!factory) {
                if (strict) {
                    throw new Error(`Cannot restore unit order task ${String(entry?.type)}`);
                }
                return undefined;
            }
            const task = factory(entry, { ...context, ...traitOptions });
            if (!task) {
                if (strict) {
                    throw new Error(`Cannot restore unit order task ${String(entry?.type)}: factory failed`);
                }
                return undefined;
            }
            applyCommonTaskState(task, entry);
            task.children = (entry.children ?? []).map(restoreTask).filter(Boolean);
            return task;
        };
        const tasks = (parsed.tasks as any[]).map(restoreTask).filter(Boolean);
        if (strict && tasks.length !== (parsed.tasks as any[]).length) {
            throw new Error("Cannot restore unit order state: unsupported task");
        }
        const waypointPath = parsed.waypointPath
            ? {
                waypoints: [] as Waypoint[],
                units: parsed.waypointPath.unitIds
                    .map((id: number) => options.resolveObjectById?.(id))
                    .filter((unit: any) => !!unit) as GameObject[],
            }
            : undefined;
        if (strict && parsed.waypointPath &&
            waypointPath!.units.length !== parsed.waypointPath.unitIds.length) {
            throw new Error("Cannot restore unit order state: waypoint path unit is unresolved");
        }
        if (waypointPath) {
            for (let index = 0; index < parsed.waypointPath!.waypointCount; index++) {
                waypointPath.waypoints.push(index < waypointPath.waypoints.length
                    ? waypointPath.waypoints[index]
                    : { next: waypointPath.waypoints[index - 1] });
            }
        }
        const currentWaypointIndex = parsed.currentWaypointIndex ?? null;
        if (strict && currentWaypointIndex !== null &&
            (!waypointPath || currentWaypointIndex < 0 ||
                currentWaypointIndex >= waypointPath.waypoints.length)) {
            throw new Error("Cannot restore unit order state: current waypoint index is out of range");
        }

        this.orders = restoredOrders;
        this.queuedOrders = queuedOrders;
        this.tasks = tasks;
        this.waypointPath = waypointPath;
        this.currentWaypoint = currentWaypointIndex !== null && waypointPath
            ? waypointPath.waypoints[currentWaypointIndex] ?? undefined
            : undefined;
        this.targetLinesTask = undefined;
        this.targetLinesConfig = undefined;
    }
    getHash(): number {
        return fnv32aStrings([
            "UnitOrderTrait",
            ...this.orders.flatMap((order) => {
                const captured = captureOrder(order, this.queuedOrders.has(order));
                return [
                    captured.orderType,
                    captured.queued ? 1 : 0,
                    captured.target
                        ? `${captured.target.objectId ?? -1}:${captured.target.rx},${captured.target.ry}:${captured.target.bridgeMode}`
                        : "no-target",
                    // PlaceBomb and Attack share an order type but not their
                    // constructor flags, so the flags are hashed too.
                    JSON.stringify(captured.flags ?? {}),
                ];
            }),
            ...this.tasks.map((task) => JSON.stringify(task.getDeterministicState?.() ?? {
                type: "unclassified-task",
                status: task.status,
            })),
            this.currentWaypoint ? 1 : 0,
            this.waypointPath ? this.waypointPath.waypoints.length : -1,
        ]);
    }
    [NotifyTick.onTick](gameObject: GameObject, deltaTime: number): void {
        if (!gameObject.isSpawned)
            return;
        const hasTasks = this.hasTasks();
        const currentTask = this.tasks.find(task => !task.isCancelling());
        if (hasTasks) {
            this.taskRunner.tick(this.tasks as any, gameObject);
        }
        if (!gameObject.isSpawned)
            return;
        const orderCount = this.orders.length;
        if (orderCount && (!hasTasks || !currentTask)) {
            let processedOrder = false;
            while (this.orders.length > 0) {
                const order = this.orders[0];
                if (order.isValid() && order.isAllowed()) {
                    const newTasks = order.process();
                    if (newTasks) {
                        if (this.queuedOrders.has(order)) {
                            this.tasks.push(new WaitTicksTask(5) as any);
                            this.tasks.push(new CallbackTask(() => {
                                gameObject.resetGuardModeToIdle();
                            }) as any);
                        }
                        this.tasks.push(...newTasks);
                        if (!hasTasks) {
                            this.taskRunner.tick(this.tasks as any, gameObject);
                        }
                    }
                    processedOrder = true;
                }
                this.orders.shift();
                this.queuedOrders.delete(order);
                if (!gameObject.isSpawned)
                    return;
                if (this.waypointPath) {
                    if (this.currentWaypoint) {
                        this.cleanupWaypoint(this.currentWaypoint, this.waypointPath);
                        this.currentWaypoint = this.currentWaypoint.next;
                    }
                    else {
                        this.currentWaypoint = this.waypointPath.waypoints[0];
                    }
                    if (!this.currentWaypoint) {
                        this.cleanupWaypointPath();
                    }
                }
                if (processedOrder)
                    break;
            }
        }
        if (!orderCount && !hasTasks && this.waypointPath && this.currentWaypoint) {
            this.cleanupWaypoint(this.currentWaypoint, this.waypointPath);
            this.cleanupWaypointPath();
        }
        let targetTask = currentTask;
        while (targetTask?.useChildTargetLines) {
            const childTask = targetTask.children?.find(child => !child.isCancelling());
            if (!childTask)
                break;
            targetTask = childTask;
        }
        if (this.targetLinesTask !== targetTask) {
            this.targetLinesTask = targetTask;
            this.targetLinesConfig = targetTask?.getTargetLinesConfig?.(this.gameObject);
        }
    }
    [NotifyOwnerChange.onChange](): void {
        this.clearOrders();
        this.cancelAllTasks();
    }
    [NotifyTeleport.onBeforeTeleport](gameObject: GameObject, fromPos: any, toPos: any, crossRealm: boolean): void {
        if (toPos && !crossRealm) {
            this.clearOrders();
            this.tasks.length = 0;
        }
    }
    addOrder(order: Order, queued = false): void {
        const addResult = order.onAdd(this.tasks, queued);
        if (addResult === false) {
            this.targetLinesTask = undefined;
            return;
        }
        if (!queued) {
            this.clearOrders();
            this.tasks = this.tasks.filter(task => task.status !== TaskStatus.NotStarted);
            this.tasks.forEach(task => task.cancel());
        }
        this.orders.push(order);
        if (queued) {
            this.queuedOrders.add(order);
        }
        this.gameObject.traits
            .filter(NotifyOrder)
            .forEach(trait => {
            trait[NotifyOrder.onPush](this.gameObject, order.orderType);
        });
    }
    clearOrders(): void {
        this.orders.length = 0;
        this.queuedOrders.clear();
        if (this.currentWaypoint && this.waypointPath) {
            this.cleanupWaypoint(this.currentWaypoint, this.waypointPath);
        }
        this.cleanupWaypointPath();
        this.gameObject.resetGuardModeToIdle();
    }
    unmarkNextQueuedOrder(): void {
        if (this.orders.length > 0) {
            this.queuedOrders.delete(this.orders[0]);
        }
    }
    hasTasks(): boolean {
        return this.tasks.length > 0;
    }
    isIdle(): boolean {
        return this.orders.length === 0 && this.tasks.length === 0;
    }
    getCurrentTask(): Task | undefined {
        return this.tasks[0];
    }
    cancelAllTasks(): void {
        this.tasks.forEach(task => task.cancel());
    }
    addTask(task: Task): void {
        this.tasks.push(task);
    }
    addTasks(...tasks: Task[]): void {
        tasks.forEach(task => this.addTask(task));
    }
    addTaskToFront(task: Task): void {
        this.tasks.unshift(task);
    }
    addTaskNext(task: Task): void {
        this.tasks.splice(1, 0, task);
    }
    getTasks(): Task[] {
        return [...this.tasks];
    }
    dispose(): void {
        this.clearOrders();
        this.tasks.length = 0;
        this.gameObject = undefined as any;
    }
    private cleanupWaypointPath(): void {
        if (!this.waypointPath)
            return;
        const unitIndex = this.waypointPath.units.indexOf(this.gameObject);
        if (unitIndex !== -1) {
            this.waypointPath.units.splice(unitIndex, 1);
        }
        if (this.waypointPath.units.length === 0) {
            this.waypointPath.waypoints.forEach(waypoint => {
                waypoint.next = undefined;
            });
            this.waypointPath.waypoints.length = 0;
        }
        this.waypointPath = undefined;
        this.currentWaypoint = undefined;
    }
    private cleanupWaypoint(waypoint: Waypoint, waypointPath: WaypointPath): void {
        const isWaypointInUse = waypointPath.units.find(unit => {
            if (unit === this.gameObject)
                return false;
            const otherCurrentWaypoint = unit.unitOrderTrait.currentWaypoint ??
                unit.unitOrderTrait.waypointPath?.waypoints[0];
            return otherCurrentWaypoint === waypoint;
        });
        const isReferencedAsNext = waypointPath.waypoints.find(wp => wp.next === waypoint);
        if (!isWaypointInUse && !isReferencedAsNext) {
            const waypointIndex = waypointPath.waypoints.indexOf(waypoint);
            if (waypointIndex === -1) {
                throw new Error("Given waypoint not found in waypoint path");
            }
            waypointPath.waypoints.splice(waypointIndex, 1);
        }
    }
}
