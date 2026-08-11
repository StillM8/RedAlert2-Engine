/**
 * Pure presentation-state normalization for common Ares superweapon fields.
 *
 * This adapter intentionally does not render a cameo, own a timer, or mutate
 * shared SuperWeapon/UI state. It gives those consumers one generic decision
 * surface for ShowCameo, TimerVisibility, and Group when integration is
 * approved separately.
 */

export type AresSuperWeaponTimerVisibility = "none" | "owner" | "allies" | "team" | "enemies" | "all";
export type AresSuperWeaponViewerRelation = "owner" | "ally" | "enemy" | "observer";

export interface AresSuperWeaponPresentationRules {
    showCameo?: boolean | string;
    swShowCameo?: boolean | string;
    autoFire?: boolean | string;
    swAutoFire?: boolean | string;
    showTimer?: boolean | string;
    timerVisibility?: string;
    swTimerVisibility?: string;
    group?: number | string;
    swGroup?: number | string;
    extensionEntries?: ReadonlyMap<string, string | string[]>;
}

export interface AresSuperWeaponPresentationState {
    /** Normalized authored value; AutoFire is applied only by cameoVisible. */
    showCameo: boolean;
    autoFire: boolean;
    showTimer: boolean;
    timerVisibility: AresSuperWeaponTimerVisibility;
    group: number;
}

const TIMER_VISIBILITIES = new Set<AresSuperWeaponTimerVisibility>([
    "none", "owner", "allies", "team", "enemies", "all",
]);

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function scalar(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0]?.trim() || undefined;
    return value?.trim() || undefined;
}

function rawEntry(
    rules: AresSuperWeaponPresentationRules,
    ...keys: string[]
): string | undefined {
    const expected = new Set(keys.map(normalize));
    for (const [key, value] of rules.extensionEntries ?? []) {
        if (expected.has(normalize(key))) return scalar(value);
    }
    return undefined;
}

function booleanValue(
    value: boolean | string | undefined,
    fallback: boolean,
): boolean {
    if (typeof value === "boolean") return value;
    const normalized = value === undefined ? "" : normalize(value);
    if (["yes", "true", "1", "on"].includes(normalized)) return true;
    if (["no", "false", "0", "off"].includes(normalized)) return false;
    return fallback;
}

function numberValue(value: number | string | undefined, fallback: number): number {
    const parsed = typeof value === "number"
        ? value
        : value === undefined
            ? NaN
            : Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function timerVisibility(value: string | undefined): AresSuperWeaponTimerVisibility {
    const normalized = value === undefined ? "" : normalize(value);
    return TIMER_VISIBILITIES.has(normalized as AresSuperWeaponTimerVisibility)
        ? normalized as AresSuperWeaponTimerVisibility
        : "all";
}

/** Normalize common Ares presentation fields using documented defaults. */
export function normalizeAresSuperWeaponPresentation(
    rules: AresSuperWeaponPresentationRules,
): AresSuperWeaponPresentationState {
    const showCameo = booleanValue(
        rules.showCameo ?? rules.swShowCameo ?? rawEntry(rules, "SW.ShowCameo", "ShowCameo"),
        true,
    );
    const autoFire = booleanValue(
        rules.autoFire ?? rules.swAutoFire ?? rawEntry(rules, "SW.AutoFire", "AutoFire"),
        false,
    );
    const showTimer = booleanValue(
        rules.showTimer ?? rawEntry(rules, "ShowTimer"),
        false,
    );
    const visibility = rules.timerVisibility ??
        rules.swTimerVisibility ??
        rawEntry(rules, "SW.TimerVisibility", "TimerVisibility");
    const group = numberValue(
        rules.group ?? rules.swGroup ?? rawEntry(rules, "SW.Group", "Group"),
        0,
    );
    return {
        showCameo,
        autoFire,
        showTimer,
        timerVisibility: timerVisibility(visibility),
        group,
    };
}

/**
 * Ares ignores SW.ShowCameo when AutoFire is disabled. In that mode the
 * ordinary cameo remains visible; when AutoFire is enabled, the authored
 * ShowCameo value controls visibility and defaults to yes.
 */
export function isAresSuperWeaponCameoVisible(
    rules: AresSuperWeaponPresentationRules,
): boolean {
    const state = normalizeAresSuperWeaponPresentation(rules);
    return !state.autoFire || state.showCameo;
}

/**
 * Decide timer visibility from a normalized Ares house relation. Observers
 * are treated as allies, matching the documented Ares visibility rule.
 */
export function isAresSuperWeaponTimerVisible(
    rules: AresSuperWeaponPresentationRules,
    viewer: AresSuperWeaponViewerRelation,
): boolean {
    const state = normalizeAresSuperWeaponPresentation(rules);
    if (!state.showTimer) return false;
    switch (state.timerVisibility) {
        case "none": return false;
        case "owner": return viewer === "owner";
        case "allies": return viewer === "owner" || viewer === "ally" || viewer === "observer";
        case "team": return viewer === "owner" || viewer === "ally" || viewer === "observer";
        case "enemies": return viewer === "enemy";
        case "all": return true;
    }
}

/** Return the stable authored group used to distinguish same-type weapons. */
export function getAresSuperWeaponPresentationGroup(
    rules: AresSuperWeaponPresentationRules,
): number {
    return normalizeAresSuperWeaponPresentation(rules).group;
}
