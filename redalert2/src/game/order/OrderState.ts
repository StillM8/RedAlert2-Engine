import { OrderType } from "@/game/order/OrderType";
import { Target, TargetBridgeMode } from "@/game/Target";
import { OrderFactory } from "@/game/order/OrderFactory";

/**
 * Canonical serialization for a unit order.
 *
 * An `Order` holds a target reference and a small set of constructor flags
 * that are all implied by its `OrderType` (the factory encodes the mapping, for
 * example ForceMove vs Move and Attack vs ForceAttack vs PlaceBomb). The target
 * is the only genuinely dynamic part, so it is stored as a stable object id
 * plus a map cell, and rebuilt through `Target` rather than by copying a
 * reference.
 */
export interface OrderTargetState {
    /** Stable world object id, or null for a cell-only target. */
    objectId: number | null;
    rx: number;
    ry: number;
    bridgeMode: number;
}

export interface OrderState {
    version: 1;
    orderType: number;
    queued: boolean;
    target: OrderTargetState | null;
    /** Constructor flags that the order type alone does not determine. */
    flags?: Record<string, unknown>;
}

export interface OrderStateContext {
    game: any;
    resolveObjectById?(id: number): any;
    strict?: boolean;
}

function isOrderType(value: unknown): value is OrderType {
    return Number.isSafeInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= OrderType.DetonateBomb;
}

export function captureOrderTarget(target: any): OrderTargetState | null {
    if (!target) {
        return null;
    }
    const tile = target.tile;
    if (!tile || !Number.isSafeInteger(tile.rx) || !Number.isSafeInteger(tile.ry)) {
        return null;
    }
    return {
        objectId: Number.isSafeInteger(target.obj?.id) ? target.obj.id : null,
        rx: tile.rx,
        ry: tile.ry,
        bridgeMode: target.getBridgeMode?.() ?? TargetBridgeMode.Auto,
    };
}

export function validateOrderTarget(value: unknown, label: string): OrderTargetState | null {
    if (value === null || value === undefined) {
        return null;
    }
    const candidate = value as OrderTargetState;
    if (!candidate || (candidate.objectId !== null && !Number.isSafeInteger(candidate.objectId)) ||
        !Number.isSafeInteger(candidate.rx) || candidate.rx < 0 ||
        !Number.isSafeInteger(candidate.ry) || candidate.ry < 0 ||
        !Number.isSafeInteger(candidate.bridgeMode)) {
        throw new Error(`Invalid order state: ${label}.target`);
    }
    return {
        objectId: candidate.objectId,
        rx: candidate.rx,
        ry: candidate.ry,
        bridgeMode: candidate.bridgeMode,
    };
}

export function captureOrder(
    order: any,
    isQueued: boolean,
): OrderState {
    const flags = order?.captureState?.();
    return {
        version: 1,
        orderType: order?.orderType,
        queued: isQueued,
        target: captureOrderTarget(order?.target),
        ...(flags && Object.keys(flags).length ? { flags } : {}),
    };
}

export function validateOrderState(value: unknown, label: string): OrderState {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid order state: ${label} must be an object`);
    }
    const candidate = value as OrderState;
    if (candidate.version !== 1) {
        throw new Error(`Unsupported order state version: ${String((value as any).version)}`);
    }
    if (!isOrderType(candidate.orderType)) {
        throw new Error(`Invalid order state: ${label}.orderType`);
    }
    if (typeof candidate.queued !== "boolean") {
        throw new Error(`Invalid order state: ${label}.queued`);
    }
    if (candidate.flags !== undefined) {
        if (typeof candidate.flags !== "object" || candidate.flags === null ||
            Array.isArray(candidate.flags)) {
            throw new Error(`Invalid order state: ${label}.flags`);
        }
        for (const [key, entry] of Object.entries(candidate.flags)) {
            if (!["__proto__", "constructor", "prototype"].includes(key) &&
                typeof entry !== "number" && typeof entry !== "boolean" && typeof entry !== "string") {
                throw new Error(`Invalid order state: ${label}.flags.${key}`);
            }
        }
    }
    return {
        version: 1,
        orderType: candidate.orderType,
        queued: candidate.queued,
        target: validateOrderTarget(candidate.target, label),
        ...(candidate.flags ? { flags: { ...candidate.flags } } : {}),
    };
}

function restoreOrderTarget(
    state: OrderTargetState | null,
    context: OrderStateContext,
    label: string,
): any {
    if (state === null) {
        return undefined;
    }
    const tile = context.game?.map?.tiles?.getByMapCoords?.(state.rx, state.ry);
    if (!tile) {
        if (context.strict !== false) {
            throw new Error(`Cannot restore order ${label}: cell ${state.rx},${state.ry} is unresolved`);
        }
        return undefined;
    }
    const object = state.objectId === null
        ? undefined
        : context.resolveObjectById?.(state.objectId);
    if (state.objectId !== null && !object) {
        if (context.strict !== false) {
            throw new Error(`Cannot restore order ${label}: object ${state.objectId} is unresolved`);
        }
        return undefined;
    }
    const target = new Target(
        object,
        tile,
        context.game?.map?.tileOccupation,
        state.bridgeMode as TargetBridgeMode,
    );
    // A target that was created from a building points at its center cell;
    // rebuilding from the snapshot cell must not silently re-aim at the
    // foundation corner, so the object's own center is authoritative.
    if (object?.isBuilding?.() && object.centerTile) {
        return new Target(object, object.centerTile, context.game?.map?.tileOccupation, state.bridgeMode as TargetBridgeMode);
    }
    return target;
}

export function restoreOrder(
    state: OrderState,
    sourceObject: any,
    context: OrderStateContext,
    label: string,
): any {
    const parsed = validateOrderState(state, label);
    const order = new OrderFactory(context.game, context.game?.map)
        .create(parsed.orderType as OrderType);
    const target = restoreOrderTarget(parsed.target, context, label);
    order.set(sourceObject, target);
    if (parsed.flags && typeof (order as any).restoreState === "function") {
        (order as any).restoreState(parsed.flags);
    }
    return { order, queued: parsed.queued };
}
