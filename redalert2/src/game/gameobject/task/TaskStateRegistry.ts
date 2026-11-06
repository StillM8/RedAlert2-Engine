/**
 * Registry for task reconstruction during a world checkpoint.
 *
 * A unit's live task graph is the last open part of canonical state: tasks hold
 * closures, path arrays, and object references. A task opts in by declaring a
 * `deterministicType` that is registered here with a factory able to rebuild it
 * from a captured payload. Tasks without a contract keep the explicit
 * `unclassified-task` marker, and strict restore refuses them rather than
 * silently dropping the unit's intent.
 */
export interface TaskStateContext {
    game: any;
    strict?: boolean;
    resolveObjectById?(id: number): any;
    resolveTile?(rx: number, ry: number): any;
    resolveRules?(name: string, type: number): any;
    [key: string]: unknown;
}

export interface TaskStateFactory {
    (payload: any, context: TaskStateContext): any;
}

const factories = new Map<string, TaskStateFactory>();

export function registerTaskStateFactory(type: string, factory: TaskStateFactory): void {
    if (typeof type !== "string" || type.length === 0) {
        throw new Error("Task state factory type must be a non-empty string");
    }
    if (typeof factory !== "function") {
        throw new Error(`Task state factory "${type}" must be a function`);
    }
    if (factories.has(type) && factories.get(type) !== factory) {
        throw new Error(`Task state factory "${type}" is already registered`);
    }
    factories.set(type, factory);
}

export function getTaskStateFactory(type: unknown): TaskStateFactory | undefined {
    return typeof type === "string" ? factories.get(type) : undefined;
}

export function isRestorableTaskType(type: unknown): boolean {
    return getTaskStateFactory(type) !== undefined;
}

/** A map cell, serialized by coordinates so a checkpoint crosses worlds. */
export interface TaskCellState {
    rx: number;
    ry: number;
}

export function captureTaskCell(tile: any): TaskCellState | null {
    if (!tile || !Number.isSafeInteger(tile.rx) || !Number.isSafeInteger(tile.ry)) {
        return null;
    }
    return { rx: tile.rx, ry: tile.ry };
}

export function captureTaskCells(tiles: readonly any[] | undefined): TaskCellState[] {
    return (tiles ?? [])
        .map(captureTaskCell)
        .filter((cell): cell is TaskCellState => cell !== null);
}

export function validateTaskCell(value: unknown, label: string): TaskCellState {
    const cell = value as TaskCellState;
    if (!cell || !Number.isSafeInteger(cell.rx) || cell.rx < 0 ||
        !Number.isSafeInteger(cell.ry) || cell.ry < 0) {
        throw new Error(`Invalid task state: ${label}`);
    }
    return { rx: cell.rx, ry: cell.ry };
}

export function validateTaskCells(value: unknown, label: string): TaskCellState[] {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid task state: ${label} must be an array`);
    }
    return value.map((cell, index) => validateTaskCell(cell, `${label}[${index}]`));
}

export function restoreTaskCells(
    value: readonly TaskCellState[],
    context: TaskStateContext,
    label: string,
): any[] {
    return value.map((cell, index) => {
        const tile = context.resolveTile?.(cell.rx, cell.ry);
        if (!tile) {
            if (context.strict !== false) {
                throw new Error(
                    `Cannot restore task state: ${label}[${index}] cell ${cell.rx},${cell.ry} is unresolved`,
                );
            }
            return undefined;
        }
        return tile;
    }).filter((tile: any) => tile !== undefined);
}
