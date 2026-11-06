/**
 * Generic store for the Ares AI preferred targeting cell established by map
 * trigger actions 135/140. The built-in bot consumes it through the host API
 * (`GameApi.getAresSuperWeaponTargetingCell`) for the documented
 * Offensive_Cell_Set/Defensive_Cell_Set constraints and the offensive/
 * defensive preference overrides.
 *
 * State is keyed by the canonical Player object and kept in a WeakMap so it
 * never survives world reconstruction. Trigger-owned state belongs to the
 * still-open trigger deterministic-state closure (see
 * docs/DeterministicStateCoverage.md); capture/restore helpers make the
 * state ride the extension snapshot walk like every other extension slice.
 */

export type AresPreferredTargetingCellKind = "offensive" | "defensive";

export interface AresPreferredTargetingCell {
    x: number;
    y: number;
}

export type AresPreferredTargetingCellsState =
    Partial<Record<AresPreferredTargetingCellKind, AresPreferredTargetingCell>>;

const preferredCells = new WeakMap<object, AresPreferredTargetingCellsState>();

export function setAresPreferredTargetingCell(
    player: object,
    kind: AresPreferredTargetingCellKind,
    cell: AresPreferredTargetingCell | undefined,
): void {
    const entry = preferredCells.get(player) ?? {};
    if (cell) {
        entry[kind] = { x: Math.trunc(cell.x), y: Math.trunc(cell.y) };
    }
    else {
        delete entry[kind];
    }
    preferredCells.set(player, entry);
}

export function getAresPreferredTargetingCell(
    player: object,
    kind: AresPreferredTargetingCellKind,
): AresPreferredTargetingCell | undefined {
    const cell = preferredCells.get(player)?.[kind];
    return cell ? { x: cell.x, y: cell.y } : undefined;
}

/** Snapshot slice for one player; undefined while no preference is known. */
export function captureAresPreferredTargetingCells(
    player: object,
): AresPreferredTargetingCellsState | undefined {
    const offensive = getAresPreferredTargetingCell(player, "offensive");
    const defensive = getAresPreferredTargetingCell(player, "defensive");
    if (!offensive && !defensive) return undefined;
    const state: AresPreferredTargetingCellsState = {};
    if (offensive) state.offensive = offensive;
    if (defensive) state.defensive = defensive;
    return state;
}

/**
 * Restores the captured slice for one player. An absent/undefined slice
 * clears previously set preferences so the *_Cell_Clear constraints observe
 * the same state the source world had.
 */
export function restoreAresPreferredTargetingCells(
    player: object,
    state: AresPreferredTargetingCellsState | undefined,
): void {
    setAresPreferredTargetingCell(player, "offensive", state?.offensive);
    setAresPreferredTargetingCell(player, "defensive", state?.defensive);
}
