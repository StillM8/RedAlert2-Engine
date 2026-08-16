/**
 * Pure presentation-state normalization for common Ares superweapon fields.
 *
 * This adapter intentionally does not render a cameo, own a timer, or mutate
 * shared SuperWeapon/UI state. It gives those consumers one generic decision
 * surface for ShowCameo, TimerVisibility, and Group.
 */

export type AresSuperWeaponTimerVisibility = "none" | "owner" | "allies" | "team" | "enemies" | "all";
export type AresSuperWeaponViewerRelation = "owner" | "ally" | "enemy" | "observer";
export type AresSuperWeaponMessageStage =
    | "detected"
    | "ready"
    | "launch"
    | "activate"
    | "abort"
    | "insufficientFunds"
    | "cannotFire";
export type AresSuperWeaponEvaStage = "detected" | "ready" | "activated";
export type AresSuperWeaponOverlayStage = "ready" | "charging" | "active";

/** Resolve the relation used by the documented timer-visibility rules. */
export function resolveAresSuperWeaponViewerRelation(
    viewer: any,
    owner: any,
    alliances?: { areAllied?: (player1: any, player2: any) => boolean },
): AresSuperWeaponViewerRelation {
    if (!viewer?.isObserver && viewer === owner) return "owner";
    if (viewer?.isObserver || !viewer) return "observer";
    if (alliances?.areAllied?.(viewer, owner)) return "ally";
    return "enemy";
}

export interface AresSuperWeaponPresentationRules {
    showCameo?: boolean | string;
    swShowCameo?: boolean | string;
    autoFire?: boolean | string;
    swAutoFire?: boolean | string;
    showTimer?: boolean | string;
    timerVisibility?: string;
    swTimerVisibility?: string;
    animationVisibility?: string;
    swAnimationVisibility?: string;
    group?: number | string;
    swGroup?: number | string;
    evaDetected?: string;
    evaReady?: string;
    evaActivated?: string;
    messageDetected?: string;
    messageReady?: string;
    messageLaunch?: string;
    messageActivate?: string;
    messageAbort?: string;
    messageInsufficientFunds?: string;
    messageCannotFire?: string;
    messageFirerColor?: boolean | string;
    messageColor?: string;
    extensionEntries?: ReadonlyMap<string, string | string[]>;
}

export interface AresSuperWeaponPresentationState {
    /** Normalized authored value; AutoFire is applied only by cameoVisible. */
    showCameo: boolean;
    autoFire: boolean;
    showTimer: boolean;
    timerVisibility: AresSuperWeaponTimerVisibility;
    animationVisibility: AresSuperWeaponTimerVisibility;
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

function visibility(value: string | undefined): AresSuperWeaponTimerVisibility {
    const normalized = value === undefined ? "" : normalize(value);
    return TIMER_VISIBILITIES.has(normalized as AresSuperWeaponTimerVisibility)
        ? normalized as AresSuperWeaponTimerVisibility
        : "all";
}

function optionalLabel(value: string | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    const normalized = normalize(value);
    return normalized === "" || normalized === "none" ? null : value.trim();
}

/** Resolve a documented Ares EVA label without making custom SW types numeric. */
export function resolveAresSuperWeaponEva(
    rules: AresSuperWeaponPresentationRules,
    stage: AresSuperWeaponEvaStage,
): string | null | undefined {
    const typed = stage === "detected"
        ? rules.evaDetected
        : stage === "ready" ? rules.evaReady : rules.evaActivated;
    return optionalLabel(typed ?? rawEntry(rules, `EVA.${stage === "activated" ? "Activated" : stage[0].toUpperCase() + stage.slice(1)}`));
}

/** Resolve a documented Ares CSF message label for one lifecycle stage. */
export function resolveAresSuperWeaponMessage(
    rules: AresSuperWeaponPresentationRules,
    stage: AresSuperWeaponMessageStage,
): string | null | undefined {
    const typed = stage === "detected"
        ? rules.messageDetected
        : stage === "ready"
            ? rules.messageReady
            : stage === "launch"
                ? rules.messageLaunch
                : stage === "activate"
                    ? rules.messageActivate
                    : stage === "abort"
                        ? rules.messageAbort
                        : stage === "insufficientFunds"
                            ? rules.messageInsufficientFunds
                            : rules.messageCannotFire;
    const key = stage === "insufficientFunds"
        ? "Message.InsufficientFunds"
        : stage === "cannotFire"
            ? "Message.CannotFire"
            : `Message.${stage[0].toUpperCase()}${stage.slice(1)}`;
    const resolved = optionalLabel(typed ?? rawEntry(rules, key));
    return resolved === undefined && stage === "cannotFire" ? "MSG:CannotFire" : resolved;
}

/** Whether Ares asks the UI to use the firing house's color for a message. */
export function isAresSuperWeaponMessageFirerColored(
    rules: AresSuperWeaponPresentationRules,
): boolean {
    return booleanValue(
        rules.messageFirerColor ?? rawEntry(rules, "Message.FirerColor"),
        false,
    );
}

/** Resolve the final message color, honoring FirerColor over Message.Color. */
export function resolveAresSuperWeaponMessageColor(
    rules: AresSuperWeaponPresentationRules,
    owner: any,
    fallback: any,
): any {
    if (isAresSuperWeaponMessageFirerColored(rules)) return owner ?? fallback;
    const color = optionalLabel(rules.messageColor ?? rawEntry(rules, "Message.Color"));
    return color ?? fallback;
}

/** Resolve a documented cameo overlay label for a live superweapon state. */
export function resolveAresSuperWeaponOverlayText(
    rules: AresSuperWeaponPresentationRules,
    stage: AresSuperWeaponOverlayStage,
): string | null | undefined {
    const typed = stage === "ready"
        ? (rules as any).textReady
        : stage === "charging"
            ? (rules as any).textCharging
            : (rules as any).textActive;
    const key = stage[0].toUpperCase() + stage.slice(1);
    return optionalLabel(typed ?? rawEntry(rules, `Text.${key}`));
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
    const timerVisibilityValue = rules.timerVisibility ??
        rules.swTimerVisibility ??
        rawEntry(rules, "SW.TimerVisibility", "TimerVisibility");
    const animationVisibilityValue = rules.animationVisibility ??
        rules.swAnimationVisibility ??
        rawEntry(rules, "SW.AnimationVisibility", "AnimationVisibility");
    const group = numberValue(
        rules.group ?? rules.swGroup ?? rawEntry(rules, "SW.Group", "Group"),
        0,
    );
    return {
        showCameo,
        autoFire,
        showTimer,
        timerVisibility: visibility(timerVisibilityValue),
        animationVisibility: visibility(animationVisibilityValue),
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

/**
 * Decide whether the local viewer may see an Ares superweapon animation.
 * Ares uses the same owner/allies/team/enemies/all relation vocabulary for
 * animations and timers; observers are treated as allied viewers.
 */
export function isAresSuperWeaponAnimationVisible(
    rules: AresSuperWeaponPresentationRules,
    viewer: AresSuperWeaponViewerRelation,
): boolean {
    const state = normalizeAresSuperWeaponPresentation(rules);
    switch (state.animationVisibility) {
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
