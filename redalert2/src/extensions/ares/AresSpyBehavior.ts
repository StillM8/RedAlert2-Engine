import type { IniSection } from "@/data/IniSection";
import { QueueType } from "@/game/player/production/ProductionQueue";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { NotifyOwnerChange } from "@/game/gameobject/trait/interface/NotifyOwnerChange";
import { NotifySell } from "@/game/gameobject/trait/interface/NotifySell";
import {
    getAvailableBuildingSuperWeapon,
    getBuildingSuperWeaponTraits,
} from "@/game/gameobject/trait/SuperWeaponTrait";
import { getAresSuperWeaponProviderNames } from "@/extensions/ares/AresSuperWeaponProviders";

const FACTORY_TYPE = {
    None: 0,
    BuildingType: 1,
    InfantryType: 2,
    UnitType: 3,
    NavalUnitType: 4,
    AircraftType: 5,
} as const;
const COMBAT_BUILD_CATEGORY = 0;

export interface AresSpyEffectRules {
    custom: boolean;
    resetRadar: boolean;
    revealRadar: boolean;
    powerOutageDuration: number;
    stolenMoneyAmount: number;
    stolenMoneyPercentage: number;
    resetSuperweapons: boolean;
    stolenTechIndex: number;
    stolenTechIndexSet: boolean;
    unitVeterancy: boolean;
    revealProduction: boolean;
    undoReverseEngineer: boolean;
}

function authoredValue(section: IniSection, key: string): string | undefined {
    const value = section.get(key);
    return typeof value === "string" ? value.trim() : undefined;
}

function parseBoolean(section: IniSection, key: string): boolean {
    switch (authoredValue(section, key)?.toLocaleLowerCase("en-US")) {
        case "yes":
        case "true":
        case "on":
        case "1":
            return true;
        case "no":
        case "false":
        case "off":
        case "0":
            return false;
        default:
            return false;
    }
}

function parseNumber(section: IniSection, key: string): number | undefined {
    const raw = authoredValue(section, key);
    if (!raw) return undefined;
    const value = raw.endsWith("%")
        ? Number(raw.slice(0, -1).trim()) / 100
        : Number(raw);
    return Number.isFinite(value) ? value : undefined;
}

function parseNonNegativeInteger(section: IniSection, key: string): number {
    const value = parseNumber(section, key);
    return value !== undefined && Number.isSafeInteger(value) && value >= 0
        ? value
        : 0;
}

export function createDefaultAresSpyEffectRules(): AresSpyEffectRules {
    return {
        custom: false,
        resetRadar: false,
        revealRadar: false,
        powerOutageDuration: 0,
        stolenMoneyAmount: 0,
        stolenMoneyPercentage: 0,
        resetSuperweapons: false,
        stolenTechIndex: 0,
        stolenTechIndexSet: false,
        unitVeterancy: false,
        revealProduction: false,
        undoReverseEngineer: false,
    };
}

export function parseAresSpyEffectRules(section: IniSection): AresSpyEffectRules {
    const powerOutageDuration = parseNonNegativeInteger(section, "SpyEffect.PowerOutageDuration");
    const stolenMoneyAmount = parseNonNegativeInteger(section, "SpyEffect.StolenMoneyAmount");
    const percentage = parseNumber(section, "SpyEffect.StolenMoneyPercentage");
    const stolenMoneyPercentage = percentage !== undefined && percentage >= 0 && percentage <= 1
        ? percentage
        : 0;
    const stolenTechIndexValue = parseNumber(section, "SpyEffect.StolenTechIndex");
    const stolenTechIndexSet = stolenTechIndexValue !== undefined &&
        Number.isSafeInteger(stolenTechIndexValue) &&
        stolenTechIndexValue >= 0 &&
        stolenTechIndexValue < 32;
    const stolenTechIndex = stolenTechIndexSet ? stolenTechIndexValue : 0;
    return {
        custom: parseBoolean(section, "SpyEffect.Custom"),
        resetRadar: parseBoolean(section, "SpyEffect.ResetRadar"),
        revealRadar: parseBoolean(section, "SpyEffect.RevealRadar"),
        powerOutageDuration,
        stolenMoneyAmount,
        stolenMoneyPercentage,
        resetSuperweapons: parseBoolean(section, "SpyEffect.ResetSuperweapons"),
        stolenTechIndex,
        stolenTechIndexSet,
        unitVeterancy: parseBoolean(section, "SpyEffect.UnitVeterancy"),
        revealProduction: parseBoolean(section, "SpyEffect.RevealProduction"),
        undoReverseEngineer: parseBoolean(section, "SpyEffect.UndoReverseEngineer"),
    };
}

export function resolveAresSpyEffectRules(rules: any): AresSpyEffectRules {
    const parsed = rules?.spyEffect ?? rules?.aresSpyEffect;
    const stolenTechIndex = parsed?.stolenTechIndex ?? rules?.spyEffectStolenTechIndex ?? 0;
    return {
        custom: parsed?.custom ?? rules?.spyEffectCustom ?? false,
        resetRadar: parsed?.resetRadar ?? rules?.spyEffectResetRadar ?? false,
        revealRadar: parsed?.revealRadar ?? rules?.spyEffectRevealRadar ?? false,
        powerOutageDuration: parsed?.powerOutageDuration ?? rules?.spyEffectPowerOutageDuration ?? 0,
        stolenMoneyAmount: parsed?.stolenMoneyAmount ?? rules?.spyEffectStolenMoneyAmount ?? 0,
        stolenMoneyPercentage: parsed?.stolenMoneyPercentage ?? rules?.spyEffectStolenMoneyPercentage ?? 0,
        resetSuperweapons: parsed?.resetSuperweapons ?? rules?.spyEffectResetSuperweapons ?? false,
        stolenTechIndex,
        stolenTechIndexSet: parsed?.stolenTechIndexSet ??
            rules?.spyEffectStolenTechIndexSet ??
            stolenTechIndex > 0,
        unitVeterancy: parsed?.unitVeterancy ?? rules?.spyEffectUnitVeterancy ?? false,
        revealProduction: parsed?.revealProduction ?? rules?.spyEffectRevealProduction ?? false,
        undoReverseEngineer: parsed?.undoReverseEngineer ?? rules?.spyEffectUndoReverseEngineer ?? false,
    };
}

export function calculateAresStolenMoney(
    availableCredits: number,
    amount: number,
    percentage: number,
): number {
    if (!Number.isFinite(availableCredits) || availableCredits <= 0) return 0;
    const requested = Number.isSafeInteger(amount) && amount > 0
        ? amount
        : Number.isFinite(percentage) && percentage > 0 && percentage <= 1
            ? Math.floor(availableCredits * percentage)
            : 0;
    return Math.min(availableCredits, requested);
}

function applyAresStolenMoney(
    infiltrator: any,
    target: any,
    amount: number,
    percentage: number,
): number {
    const available = target.owner.credits;
    const stolen = calculateAresStolenMoney(available, amount, percentage);
    if (stolen > 0) {
        target.owner.credits = available - stolen;
        infiltrator.owner.credits += stolen;
    }
    return stolen;
}

function normalizePositiveFrames(value: unknown): number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : 0;
}

function upgradeValues(value: any): any[] {
    if (value === undefined || value === null) return [];
    if (typeof value === "string") return [value];
    if (typeof value[Symbol.iterator] === "function") return [...value];
    return [value];
}

function upgradeObjects(building: any, game: any): any[] {
    const result: any[] = [];
    for (const value of [
        ...upgradeValues(building?.upgrades),
        ...upgradeValues(building?.attachedUpgrades),
        ...upgradeValues(building?.upgradeObjects),
    ]) {
        if (typeof value === "string") {
            try {
                result.push(game?.rules?.getBuilding?.(value));
            }
            catch {
                continue;
            }
        }
        else if (value) {
            result.push(value);
        }
    }
    return result;
}

export function resetAresBuildingSuperWeapons(building: any, game?: any): number {
    const reset = new Set<any>();
    const resetSuperWeapon = (superWeapon: any) => {
        if (!superWeapon || reset.has(superWeapon)) return;
        reset.add(superWeapon);
        superWeapon.resetTimer(game);
    };
    for (const trait of getBuildingSuperWeaponTraits(building)) {
        const resolved = trait.getSuperWeapon?.(building) ??
            building.owner?.superWeaponsTrait?.get?.(trait.name);
        resetSuperWeapon(resolved);
    }
    for (const name of getAresSuperWeaponProviderNames(building.rules ?? building)) {
        resetSuperWeapon(building.owner?.superWeaponsTrait?.get?.(name));
    }
    for (const upgrade of upgradeObjects(building, game)) {
        for (const trait of getBuildingSuperWeaponTraits(upgrade)) {
            const resolved = trait.getSuperWeapon?.(upgrade) ??
                upgrade.owner?.superWeaponsTrait?.get?.(trait.name) ??
                building.owner?.superWeaponsTrait?.get?.(trait.name);
            resetSuperWeapon(resolved);
        }
        const owner = upgrade.owner ?? building.owner;
        for (const name of getAresSuperWeaponProviderNames(upgrade.rules ?? upgrade)) {
            resetSuperWeapon(owner?.superWeaponsTrait?.get?.(name));
        }
    }
    return reset.size;
}

function revealAresRadar(target: any, infiltrator: any, game: any): void {
    const targetShroud = game.mapShroudTrait?.getPlayerShroud?.(target.owner);
    const infiltratorShroud = game.mapShroudTrait?.getPlayerShroud?.(infiltrator.owner);
    if (!targetShroud || !infiltratorShroud || targetShroud === infiltratorShroud) return;
    infiltratorShroud.merge(targetShroud);
    infiltratorShroud.invalidateFull?.();
}

export function applyCustomAresSpyInfiltration(
    agent: any,
    target: any,
    game: any,
    effect: AresSpyEffectRules,
): void {
    if (effect.resetRadar) {
        game.mapShroudTrait.resetShroud(target.owner, game);
    }
    const outage = normalizePositiveFrames(effect.powerOutageDuration);
    if (outage > 0) {
        target.owner.powerTrait?.setBlackoutFor?.(outage, game);
    }
    if (effect.stolenTechIndexSet && effect.stolenTechIndex >= 0 && effect.stolenTechIndex < 32) {
        agent.owner.production?.addStolenTech?.(effect.stolenTechIndex);
    }
    if (effect.undoReverseEngineer) {
        target.owner.production?.clearReverseEngineeredPlans?.();
    }
    if (effect.resetSuperweapons) {
        resetAresBuildingSuperWeapons(target, game);
    }
    applyAresStolenMoney(agent, target, effect.stolenMoneyAmount, effect.stolenMoneyPercentage);
    const factoryType = target.factoryTrait?.type;
    if (effect.unitVeterancy &&
        (factoryType === FACTORY_TYPE.InfantryType || factoryType === FACTORY_TYPE.UnitType)) {
        agent.owner.production?.addVeteranType?.(factoryType);
    }
    if (effect.revealProduction && Number.isSafeInteger(target.id) && target.id >= 0) {
        agent.owner.production?.addRevealedFactory?.(target.id);
    }
    if (effect.revealRadar && target.rules.radar) {
        revealAresRadar(target, agent, game);
    }
}

function hasRetailSuperWeapon(target: any): boolean {
    return getBuildingSuperWeaponTraits(target).length > 0 ||
        !!target.rules?.superWeapon ||
        !!target.rules?.superWeapon2;
}

export function applyRetailAresSpyInfiltration(agent: any, target: any, game: any): void {
    if (target.rules.radar &&
        ![...target.owner.buildings].some((building: any) => building.rules.spySat)) {
        game.mapShroudTrait.resetShroud(target.owner, game);
        return;
    }
    if (target.rules.power > 0) {
        target.owner.powerTrait?.setBlackoutFor?.(
            normalizePositiveFrames(game.rules.general.spyPowerBlackout),
            game,
        );
        return;
    }
    if (game.rules.ai?.buildTech?.includes(target.name)) {
        const sideId = target.rules.aiBasePlanningSideId;
        const legacySide = target.rules.aiBasePlanningSide;
        if (sideId !== undefined) agent.owner.production?.addStolenTech?.(sideId);
        if (legacySide !== undefined) agent.owner.production?.addStolenTech?.(legacySide);
        return;
    }
    if (hasRetailSuperWeapon(target)) {
        getAvailableBuildingSuperWeapon(target)?.superWeapon.resetTimer(game);
        return;
    }
    if (target.rules.storage > 0) {
        const authoredPercentage = game.rules.general.spyMoneyStealPercent;
        const percentage = Number.isFinite(authoredPercentage)
            ? Math.min(1, Math.max(0, authoredPercentage))
            : 0;
        applyAresStolenMoney(agent, target, 0, percentage);
        return;
    }
    const factoryType = target.factoryTrait?.type;
    if (factoryType === FACTORY_TYPE.InfantryType || factoryType === FACTORY_TYPE.UnitType) {
        agent.owner.production?.addVeteranType?.(factoryType);
    }
}

export class AresSpyEffectTrait implements NotifyDestroy, NotifyOwnerChange, NotifySell {
    [NotifyOwnerChange.onChange](building: any): void {
        building.owner?.production?.removeRevealedFactory?.(building.id);
    }

    [NotifyDestroy.onDestroy](building: any, world: any): void {
        this.clearReveals(building, world);
    }

    [NotifySell.onSell](building: any, world: any): void {
        this.clearReveals(building, world);
    }

    private clearReveals(building: any, world: any): void {
        const players = [
            ...(world?.getCombatants?.() ?? []),
            ...(world?.playerList?.getAll?.() ?? []),
        ];
        for (const player of new Set(players)) {
            player.production?.removeRevealedFactory?.(building.id);
        }
    }
}

export function canRevealAresProduction(building: any, viewer: any): boolean {
    if (!viewer || !viewer.production || !building || building.isDestroyed) return false;
    if (building.owner === viewer) return false;
    if (!Number.isSafeInteger(building.id) || building.id < 0) return false;
    return viewer.production.hasRevealedFactory?.(building.id) === true;
}

export function resolveAresRevealedProductionRules(building: any, viewer: any): any | undefined {
    if (!canRevealAresProduction(building, viewer)) return undefined;
    const factoryType = building.factoryTrait?.type ?? building.rules?.factory;
    const production = building.owner?.production;
    if (!production) return undefined;
    let queue: any;
    if (factoryType === FACTORY_TYPE.BuildingType) {
        const queueType = building.rules.buildCat === COMBAT_BUILD_CATEGORY
            ? QueueType.Armory
            : QueueType.Structures;
        queue = production.getQueue?.(queueType);
    }
    else if (
        factoryType === FACTORY_TYPE.InfantryType ||
        factoryType === FACTORY_TYPE.UnitType ||
        factoryType === FACTORY_TYPE.NavalUnitType ||
        factoryType === FACTORY_TYPE.AircraftType
    ) {
        queue = production.getQueueForFactory?.(factoryType);
    }
    return queue?.getFirst?.()?.rules;
}
