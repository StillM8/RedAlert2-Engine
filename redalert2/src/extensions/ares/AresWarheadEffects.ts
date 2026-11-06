import { GameSpeed } from "@/game/GameSpeed";

export interface AresWarheadHouseRules {
    affectsAllies?: boolean;
    affectsEnemies?: boolean;
    affectsOwner?: boolean;
}

export function resolveAresIronCurtainDuration(
    currentFrames: number,
    durationFrames: number,
    capFrames: number,
    modifier: number = 1,
): number {
    const current = Number.isFinite(currentFrames) ? Math.trunc(currentFrames) : 0;
    const duration = Number.isFinite(durationFrames) ? Math.trunc(durationFrames) : 0;
    const cap = Number.isFinite(capFrames) ? Math.trunc(capFrames) : -1;
    const effectiveDuration = duration > 0 && Number.isFinite(modifier)
        ? Math.trunc(duration * modifier)
        : duration;

    if (effectiveDuration > 0) {
        if (cap < 0) return Math.max(effectiveDuration, current);
        if (cap > 0) return Math.max(current, Math.min(current + effectiveDuration, cap));
        return current + effectiveDuration;
    }
    const proposed = current + effectiveDuration;
    return cap < 0 ? proposed : Math.min(proposed, cap);
}

export function canAffectAresWarheadTarget(
    target: any,
    sourcePlayer: any,
    game: any,
    rules: AresWarheadHouseRules,
): boolean {
    if (!sourcePlayer || !target?.owner) return true;
    const owner = target.owner === sourcePlayer;
    const allied = owner ||
        game?.alliances?.areAllied?.(sourcePlayer, target.owner) === true ||
        game?.areAllied?.(sourcePlayer, target.owner) === true;
    if (owner) return rules.affectsOwner ?? rules.affectsAllies ?? true;
    if (allied) return rules.affectsAllies ?? true;
    return rules.affectsEnemies ?? true;
}

export function resolveAresPreImpactDurationTicks(animation: any): number {
    if (typeof animation?.durationTicks === "number" && Number.isFinite(animation.durationTicks)) {
        return Math.max(1, Math.ceil(animation.durationTicks));
    }
    const section = animation?.art ?? animation;
    if (!section || typeof section.getNumber !== "function") return 1;
    const frameCount = typeof animation?.frameCount === "number" && Number.isFinite(animation.frameCount)
        ? Math.max(1, Math.trunc(animation.frameCount))
        : undefined;
    const startValue = typeof animation?.start === "number" ? animation.start : section.getNumber("Start", 0);
    const start = Number.isFinite(startValue) ? Math.max(0, Math.trunc(startValue)) : 0;
    const endValue = typeof animation?.end === "number" ? animation.end : section.getNumber("End", start);
    const authoredEnd = Number.isFinite(endValue) ? Math.trunc(endValue) : start;
    const end = Math.max(start, authoredEnd);
    const rateValue = typeof animation?.rate === "number"
        ? animation.rate
        : section.getNumber("Rate", 60 * GameSpeed.BASE_TICKS_PER_SECOND);
    const rate = Number.isFinite(rateValue) ? rateValue / 60 : 0;
    if (!Number.isFinite(rate) || rate <= 0) return 1;
    const hasAuthoredEnd = typeof section.has === "function"
        ? section.has("End")
        : typeof animation?.end === "number";
    const frames = hasAuthoredEnd
        ? Math.max(1, end - start + 1)
        : frameCount ?? Math.max(1, end - start + 1);
    return Math.max(1, Math.ceil(frames * GameSpeed.BASE_TICKS_PER_SECOND / rate));
}
