/**
 * Sub-cell positions used by infantry collision/relocation logic.
 *
 * Kept outside Infantry.ts so movement tasks can use the data without
 * importing the full Infantry object (which also owns harvester tasks).
 * That avoids a runtime module cycle in standalone task/test bundles.
 */
export const INFANTRY_SUB_CELLS = [2, 4, 3] as const;
