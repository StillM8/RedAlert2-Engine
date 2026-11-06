import { ChronoSphereEffect } from "@/game/superweapon/ChronoSphereEffect";
import { DropPodEffect } from "@/game/superweapon/DropPodEffect";
import { EMPulseEffect } from "@/game/superweapon/EMPulseEffect";
import { ForceShieldEffect } from "@/game/superweapon/ForceShieldEffect";
import { GenericWarheadEffect } from "@/game/superweapon/GenericWarheadEffect";
import { GeneticConverterEffect } from "@/game/superweapon/GeneticConverterEffect";
import { HunterSeekerEffect } from "@/game/superweapon/HunterSeekerEffect";
import { IronCurtainEffect } from "@/game/superweapon/IronCurtainEffect";
import { LightningStormEffect } from "@/game/superweapon/LightningStormEffect";
import { NukeEffect } from "@/game/superweapon/NukeEffect";
import { ParadropEffect } from "@/game/superweapon/ParadropEffect";
import { PsychicDominatorEffect } from "@/game/superweapon/PsychicDominatorEffect";
import { PsychicRevealEffect } from "@/game/superweapon/PsychicRevealEffect";
import { SonarPulseEffect } from "@/game/superweapon/SonarPulseEffect";
import { SpyPlaneEffect } from "@/game/superweapon/SpyPlaneEffect";
import { SuperWeaponEffect, EffectStatus } from "@/game/superweapon/SuperWeaponEffect";
import { UnitDeliveryEffect } from "@/game/superweapon/UnitDeliveryEffect";

export const ARES_SUPER_WEAPON_EFFECT_STATE_VERSION = 1 as const;

export type AresSuperWeaponEffectKind =
    | "paradrop"
    | "nuke"
    | "lightning-storm"
    | "iron-curtain"
    | "chrono-sphere"
    | "psychic-dominator"
    | "genetic-converter"
    | "psychic-reveal"
    | "force-shield"
    | "spy-plane"
    | "generic-warhead"
    | "unit-delivery"
    | "sonar-pulse"
    | "empulse"
    | "drop-pod"
    | "hunter-seeker"
    | "unknown";

export type AresSuperWeaponEffectScalar = string | number | boolean | null;

export interface AresSuperWeaponEffectCellState {
    readonly rx: number;
    readonly ry: number;
}

export interface AresChronoSphereSourceState {
    readonly ownerIndex: number;
    readonly tileRx: number;
    readonly tileRy: number;
    readonly ruleName?: string;
    readonly ruleIndex?: number;
}

export interface AresSuperWeaponEffectEntry {
    readonly index: number;
    readonly kind: AresSuperWeaponEffectKind;
    readonly type: AresSuperWeaponEffectScalar;
    readonly ownerIndex: number;
    readonly tileRx: number;
    readonly tileRy: number;
    readonly status: number;
    readonly unknownFields?: Record<string, unknown>;
    readonly state?: number;
    readonly failedAttempts?: number;
    readonly spawnDelay?: number;
    readonly passengerCount?: number | null;
    readonly targetTile?: AresSuperWeaponEffectCellState | null;
    readonly planeId?: number | null;
    readonly squadInfantryType?: string | null;
    readonly squadCount?: number | null;
    readonly weaponType?: string | null;
    readonly manifestStartTimer?: number;
    readonly manifestEndTimer?: number;
    readonly nextDirectHitTimer?: number;
    readonly nextRandomHitTimer?: number;
    readonly clouds?: ReadonlyArray<{
        readonly tileRx: number;
        readonly tileRy: number;
        readonly durationTicks: number;
        readonly ticksLeft: number;
    }>;
    readonly delayTicks?: number;
    readonly tile2?: AresSuperWeaponEffectCellState | null;
    readonly objectsToTeleport?: ReadonlyArray<{
        readonly objectId: number;
        readonly destRx: number | null;
        readonly destRy: number | null;
    }>;
    readonly ticksLeft?: number;
    readonly initialDeferment?: number;
    readonly configured?: boolean;
    readonly firstAnim?: string | null;
    readonly firstAnimHeight?: number;
    readonly secondAnim?: string | null;
    readonly secondAnimHeight?: number;
    readonly controlAnim?: string | null;
    readonly capture?: boolean;
    readonly ripple?: boolean;
    readonly captureMindControlled?: boolean;
    readonly capturePermaMindControlled?: boolean;
    readonly captureImmuneToPsionics?: boolean;
    readonly permanentCapture?: boolean;
    readonly duration?: number;
    readonly fadeSoundTime?: number;
    readonly specialSound?: string | null;
    readonly fadeSoundPlayed?: boolean;
    readonly remainingTicks?: number;
    readonly pendingFrames?: number;
    readonly launched?: boolean;
    readonly launchSiteIds?: readonly number[];
    readonly completed?: boolean;
}

export interface AresSuperWeaponEffectsState {
    readonly version: typeof ARES_SUPER_WEAPON_EFFECT_STATE_VERSION;
    readonly effects: readonly AresSuperWeaponEffectEntry[];
    readonly pendingChronoSphereSources: readonly AresChronoSphereSourceState[];
}

export interface AresSuperWeaponEffectStateSource {
    readonly effects?: readonly SuperWeaponEffect[];
    readonly chronoSphereSources?: Iterable<readonly [any, any]>;
}

export interface AresSuperWeaponEffectRestoreContext {
    strict?: boolean;
    world?: any;
    resolveTile?(rx: number, ry: number): any;
    resolveObjectById?(id: number): any;
    resolvePlayerByIndex?(index: number): any;
    resolveInfantryRules?(name: string): any;
    resolveSuperWeaponRule?(name?: string, index?: number): any;
    resolveRuleByName?(name: string): any;
    resolveRuleByIndex?(index: number): any;
}

export interface PreparedAresSuperWeaponEffectStateRestore {
    readonly effects: SuperWeaponEffect[];
    readonly pendingChronoSphereSources: Array<[any, any]>;
    apply(): void;
}

export interface AresSuperWeaponEffectStateTarget {
    effects: SuperWeaponEffect[];
    chronoSphereSources?: Map<any, any>;
}

interface ResolvedEffectState {
    readonly state: AresSuperWeaponEffectEntry;
    readonly effect: SuperWeaponEffect;
    readonly owner?: any;
    readonly tile?: any;
    readonly targetTile?: any;
    readonly plane?: any;
    readonly passengerRules?: any;
    readonly tile2?: any;
    readonly objectsToTeleport?: Array<{ obj: any; destTile: any }>;
    readonly clouds?: Array<{ tile: any; durationTicks: number; ticksLeft: number }>;
    readonly launchSites?: any[];
}

const knownKinds = new Set<AresSuperWeaponEffectKind>([
    "paradrop",
    "nuke",
    "lightning-storm",
    "iron-curtain",
    "chrono-sphere",
    "psychic-dominator",
    "genetic-converter",
    "psychic-reveal",
    "force-shield",
    "spy-plane",
    "generic-warhead",
    "unit-delivery",
    "sonar-pulse",
    "empulse",
    "drop-pod",
    "hunter-seeker",
]);

function isCanonicalId(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isIndex(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= -1;
}

function integer(value: unknown, fallback: number, minimum: number): number {
    return Number.isSafeInteger(value) && (value as number) >= minimum ? value as number : fallback;
}

function finiteNumber(value: unknown, label: string, fallback: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Invalid Ares superweapon effect state: ${label}`);
    }
    return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error(`Invalid Ares superweapon effect state: ${label}`);
    }
    return value as number;
}

function negativeOneOrNonNegativeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < -1) {
        throw new Error(`Invalid Ares superweapon effect state: ${label}`);
    }
    return value as number;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | null {
    if (value === undefined || value === null) return null;
    return nonNegativeInteger(value, label);
}

function scalar(value: unknown): AresSuperWeaponEffectScalar {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
}

function primitiveTree(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown | undefined {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value !== "object" || depth >= 4) return undefined;
    if (seen.has(value)) return undefined;
    seen.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
        result = value.map((item) => primitiveTree(item, depth + 1, seen)).filter((item) => item !== undefined);
    }
    else {
        const object: Record<string, unknown> = {};
        for (const key of Object.keys(value as object).sort()) {
            if (["__proto__", "constructor", "prototype"].includes(key)) continue;
            const entry = primitiveTree((value as any)[key], depth + 1, seen);
            if (entry !== undefined) object[key] = entry;
        }
        result = Object.keys(object).length ? object : undefined;
    }
    seen.delete(value);
    return result;
}

function captureUnknownFields(effect: any): Record<string, unknown> | undefined {
    const excluded = new Set(["type", "owner", "tile", "status"]);
    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(effect ?? {}).sort()) {
        if (excluded.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) continue;
        const value = primitiveTree(effect[key]);
        if (value !== undefined) fields[key] = value;
    }
    return Object.keys(fields).length ? fields : undefined;
}

function validateUnknownFields(value: unknown, label: string): Record<string, unknown> | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid Ares superweapon effect state: ${label}.unknownFields`);
    }
    const fields: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right, "en-US"))) {
        if (["type", "owner", "tile", "status", "index", "kind", "__proto__", "constructor", "prototype"].includes(key)) {
            throw new Error(`Invalid Ares superweapon effect state: ${label}.unknownFields.${key}`);
        }
        const normalized = primitiveTree(entry);
        if (normalized === undefined && entry !== undefined) {
            throw new Error(`Invalid Ares superweapon effect state: ${label}.unknownFields.${key}`);
        }
        if (normalized !== undefined) fields[key] = normalized;
    }
    return Object.keys(fields).length ? fields : undefined;
}

function cellState(value: any): AresSuperWeaponEffectCellState | null {
    if (!value || !Number.isSafeInteger(value.rx) || !Number.isSafeInteger(value.ry)) return null;
    return { rx: value.rx, ry: value.ry };
}

function objectId(value: any): number | null {
    return isCanonicalId(value?.id) ? value.id : null;
}

function effectKind(effect: any): AresSuperWeaponEffectKind {
    if (effect instanceof ParadropEffect) return "paradrop";
    if (effect instanceof NukeEffect) return "nuke";
    if (effect instanceof LightningStormEffect) return "lightning-storm";
    if (effect instanceof IronCurtainEffect) return "iron-curtain";
    if (effect instanceof ChronoSphereEffect) return "chrono-sphere";
    if (effect instanceof PsychicDominatorEffect) return "psychic-dominator";
    if (effect instanceof GeneticConverterEffect) return "genetic-converter";
    if (effect instanceof PsychicRevealEffect) return "psychic-reveal";
    if (effect instanceof ForceShieldEffect) return "force-shield";
    if (effect instanceof SpyPlaneEffect) return "spy-plane";
    if (effect instanceof GenericWarheadEffect) return "generic-warhead";
    if (effect instanceof UnitDeliveryEffect) return "unit-delivery";
    if (effect instanceof SonarPulseEffect) return "sonar-pulse";
    if (effect instanceof EMPulseEffect) return "empulse";
    if (effect instanceof DropPodEffect) return "drop-pod";
    if (effect instanceof HunterSeekerEffect) return "hunter-seeker";
    return "unknown";
}

function activeEffects(effects: readonly SuperWeaponEffect[] | undefined): SuperWeaponEffect[] {
    return (effects ?? []).filter((effect): effect is SuperWeaponEffect =>
        !!effect && effect.status !== EffectStatus.Finished,
    );
}

function baseEntry(effect: any, index: number, kind: AresSuperWeaponEffectKind): AresSuperWeaponEffectEntry {
    return {
        index,
        kind,
        type: scalar(effect?.type),
        ownerIndex: isCanonicalId(effect?.owner?.playerListIndex) ? effect.owner.playerListIndex : -1,
        tileRx: integer(effect?.tile?.rx, -1, -1),
        tileRy: integer(effect?.tile?.ry, -1, -1),
        status: integer(effect?.status, EffectStatus.NotStarted, 0),
    };
}

function captureEntry(effect: any, index: number): AresSuperWeaponEffectEntry {
    const kind = effectKind(effect);
    const base = baseEntry(effect, index, kind);
    const value = effect as any;
    if (kind === "paradrop") {
        const squad = value.paradropSquad;
        return {
            ...base,
            state: integer(value.state, 0, 0),
            failedAttempts: integer(value.failedAttempts, 0, 0),
            spawnDelay: integer(value.spawnDelay, 0, 0),
            passengerCount: optionalNonNegativeInteger(value.passengerCount, "passengerCount"),
            targetTile: cellState(value.targetTile),
            planeId: objectId(value.pdPlane),
            squadInfantryType: typeof squad?.inf === "string" ? squad.inf : null,
            squadCount: isCanonicalId(squad?.num) ? squad.num : null,
        };
    }
    if (kind === "nuke") {
        return {
            ...base,
            weaponType: typeof value.weaponType === "string" ? value.weaponType : null,
        };
    }
    if (kind === "lightning-storm") {
        const clouds = Array.isArray(value.clouds) ? value.clouds.flatMap((cloud: any) => {
            const tile = cellState(cloud?.tile);
            if (!tile || !Number.isSafeInteger(cloud?.durationTicks) || !Number.isSafeInteger(cloud?.ticksLeft)) {
                return [];
            }
            return [{
                tileRx: tile.rx,
                tileRy: tile.ry,
                durationTicks: cloud.durationTicks,
                ticksLeft: cloud.ticksLeft,
            }];
        }) : [];
        return {
            ...base,
            state: integer(value.state, 0, 0),
            manifestStartTimer: integer(value.manifestStartTimer, 0, 0),
            manifestEndTimer: integer(value.manifestEndTimer, 0, -1),
            nextDirectHitTimer: integer(value.nextDirectHitTimer, 0, 0),
            nextRandomHitTimer: integer(value.nextRandomHitTimer, 0, 0),
            clouds,
        };
    }
    if (kind === "chrono-sphere") {
        return {
            ...base,
            delayTicks: integer(value.delayTicks, 0, 0),
            tile2: cellState(value.tile2),
            objectsToTeleport: Array.isArray(value.objectsToTeleport)
                ? value.objectsToTeleport.flatMap((entry: any) => {
                    const id = objectId(entry?.obj);
                    if (id === null) return [];
                    const destination = cellState(entry?.destTile);
                    return [{
                        objectId: id,
                        destRx: destination?.rx ?? null,
                        destRy: destination?.ry ?? null,
                    }];
                })
                : [],
        };
    }
    if (kind === "psychic-dominator") {
        return {
            ...base,
            ticksLeft: integer(value.ticksLeft, 0, 0),
            initialDeferment: integer(value.initialDeferment, 0, 0),
            configured: value.configured === true,
            firstAnim: typeof value.firstAnim === "string" ? value.firstAnim : null,
            firstAnimHeight: finiteNumber(value.firstAnimHeight, "firstAnimHeight", 750),
            secondAnim: typeof value.secondAnim === "string" ? value.secondAnim : null,
            secondAnimHeight: finiteNumber(value.secondAnimHeight, "secondAnimHeight", 0),
            controlAnim: typeof value.controlAnim === "string" ? value.controlAnim : null,
            capture: value.capture !== false,
            ripple: value.ripple !== false,
            captureMindControlled: value.captureMindControlled !== false,
            capturePermaMindControlled: value.capturePermaMindControlled !== false,
            captureImmuneToPsionics: value.captureImmuneToPsionics === true,
            permanentCapture: value.permanentCapture !== false,
        };
    }
    if (kind === "force-shield") {
        return {
            ...base,
            ticksLeft: integer(value.ticksLeft, 0, 0),
            duration: integer(value.duration, 0, 0),
            fadeSoundTime: integer(value.fadeSoundTime, 0, 0),
            specialSound: typeof value.specialSound === "string" ? value.specialSound : null,
            fadeSoundPlayed: value.fadeSoundPlayed === true,
            configured: value.configured === true,
        };
    }
    if (kind === "unit-delivery") {
        return { ...base, remainingTicks: integer(value.remainingTicks, 0, 0) };
    }
    if (kind === "empulse") {
        return {
            ...base,
            pendingFrames: integer(value.pendingFrames, 0, 0),
            launched: value.launched === true,
            launchSiteIds: Array.isArray(value.launchSites)
                ? value.launchSites.map((site: any) => objectId(site)).filter((id: number | null): id is number => id !== null)
                : [],
        };
    }
    if (kind === "drop-pod") {
        return { ...base, completed: value.completed === true };
    }
    if (kind === "unknown") {
        const unknownFields = captureUnknownFields(effect);
        return unknownFields === undefined ? base : { ...base, unknownFields };
    }
    return base;
}

function captureSources(sources: Iterable<readonly [any, any]> | undefined): AresChronoSphereSourceState[] {
    const entries: AresChronoSphereSourceState[] = [];
    for (const [owner, source] of sources ?? []) {
        const ownerIndex = owner?.playerListIndex;
        const tile = cellState(source?.tile);
        if (!isCanonicalId(ownerIndex) || !tile) continue;
        const rule = source?.rules;
        const ruleName = typeof rule?.name === "string" && rule.name.length > 0 ? rule.name : undefined;
        const ruleIndex = isCanonicalId(rule?.index) ? rule.index : undefined;
        entries.push({
            ownerIndex,
            tileRx: tile.rx,
            tileRy: tile.ry,
            ...(ruleName !== undefined ? { ruleName } : {}),
            ...(ruleIndex !== undefined ? { ruleIndex } : {}),
        });
    }
    return entries.sort((left, right) => left.ownerIndex - right.ownerIndex);
}

export function serializeAresSuperWeaponEffectState(
    source: AresSuperWeaponEffectStateSource,
): AresSuperWeaponEffectsState {
    const effects = activeEffects(source.effects);
    return {
        version: ARES_SUPER_WEAPON_EFFECT_STATE_VERSION,
        effects: effects.map((effect, index) => captureEntry(effect, index)),
        pendingChronoSphereSources: captureSources(source.chronoSphereSources),
    };
}

function validateCell(value: unknown, label: string, allowNull: boolean): AresSuperWeaponEffectCellState | null {
    if (value === null || value === undefined) {
        if (allowNull) return null;
        throw new Error(`Invalid Ares superweapon effect state: ${label} is required`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid Ares superweapon effect state: ${label}`);
    }
    const candidate = value as Record<string, unknown>;
    if (!Number.isSafeInteger(candidate.rx) || !Number.isSafeInteger(candidate.ry) ||
        (candidate.rx as number) < 0 || (candidate.ry as number) < 0) {
        throw new Error(`Invalid Ares superweapon effect state: ${label}`);
    }
    return { rx: candidate.rx as number, ry: candidate.ry as number };
}

function validateEntry(value: unknown, label: string): AresSuperWeaponEffectEntry {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid Ares superweapon effect state: ${label} must be an object`);
    }
    const candidate = value as Record<string, unknown>;
    const index = nonNegativeInteger(candidate.index, `${label}.index`);
    if (typeof candidate.kind !== "string" || candidate.kind.length === 0) {
        throw new Error(`Invalid Ares superweapon effect state: ${label}.kind`);
    }
    const kind = knownKinds.has(candidate.kind as AresSuperWeaponEffectKind)
        ? candidate.kind as AresSuperWeaponEffectKind
        : "unknown";
    const type = candidate.type;
    if (type !== null && typeof type !== "string" && typeof type !== "number" &&
        typeof type !== "boolean") {
        throw new Error(`Invalid Ares superweapon effect state: ${label}.type`);
    }
    if (typeof type === "number" && !Number.isFinite(type)) {
        throw new Error(`Invalid Ares superweapon effect state: ${label}.type`);
    }
    const ownerIndex = candidate.ownerIndex;
    if (!isIndex(ownerIndex)) throw new Error(`Invalid Ares superweapon effect state: ${label}.ownerIndex`);
    const tileRx = candidate.tileRx;
    const tileRy = candidate.tileRy;
    if (!isIndex(tileRx) || !isIndex(tileRy) ||
        ((tileRx as number) < 0) !== ((tileRy as number) < 0)) {
        throw new Error(`Invalid Ares superweapon effect state: ${label}.tile`);
    }
    const status = candidate.status;
    if (!Number.isSafeInteger(status) || (status as number) < EffectStatus.NotStarted ||
        (status as number) > EffectStatus.Finished) {
        throw new Error(`Invalid Ares superweapon effect state: ${label}.status`);
    }
    const base: AresSuperWeaponEffectEntry = {
        index,
        kind,
        type: type === undefined ? null : type as AresSuperWeaponEffectScalar,
        ownerIndex,
        tileRx,
        tileRy,
        status: status as number,
    };
    if (kind === "unknown") {
        const unknownFields = validateUnknownFields(candidate.unknownFields, label);
        return unknownFields === undefined ? base : { ...base, unknownFields };
    }

    if (kind === "paradrop") {
        const passengerCount = candidate.passengerCount;
        const squadInfantryType = candidate.squadInfantryType;
        const squadCount = candidate.squadCount;
        if (passengerCount !== undefined && passengerCount !== null) nonNegativeInteger(passengerCount, `${label}.passengerCount`);
        if (squadInfantryType !== undefined && squadInfantryType !== null &&
            (typeof squadInfantryType !== "string" || squadInfantryType.length === 0)) {
            throw new Error(`Invalid Ares superweapon effect state: ${label}.squadInfantryType`);
        }
        if (squadCount !== undefined && squadCount !== null) nonNegativeInteger(squadCount, `${label}.squadCount`);
        if ((squadInfantryType === undefined) !== (squadCount === undefined) &&
            (squadInfantryType !== null || squadCount !== null)) {
            throw new Error(`Invalid Ares superweapon effect state: ${label}.squad`);
        }
        return {
            ...base,
            state: nonNegativeInteger(candidate.state, `${label}.state`),
            failedAttempts: nonNegativeInteger(candidate.failedAttempts, `${label}.failedAttempts`),
            spawnDelay: nonNegativeInteger(candidate.spawnDelay, `${label}.spawnDelay`),
            passengerCount: passengerCount === undefined ? null : passengerCount as number | null,
            targetTile: validateCell(candidate.targetTile, `${label}.targetTile`, true),
            planeId: candidate.planeId === undefined ? null : optionalNonNegativeInteger(candidate.planeId, `${label}.planeId`),
            squadInfantryType: squadInfantryType === undefined ? null : squadInfantryType as string | null,
            squadCount: squadCount === undefined ? null : squadCount as number | null,
        };
    }
    if (kind === "nuke") {
        if (candidate.weaponType !== undefined && candidate.weaponType !== null &&
            typeof candidate.weaponType !== "string") {
            throw new Error(`Invalid Ares superweapon effect state: ${label}.weaponType`);
        }
        return { ...base, weaponType: candidate.weaponType === undefined ? null : candidate.weaponType as string | null };
    }
    if (kind === "lightning-storm") {
        if (!Array.isArray(candidate.clouds)) {
            throw new Error(`Invalid Ares superweapon effect state: ${label}.clouds`);
        }
        const clouds = candidate.clouds.map((cloud: any, cloudIndex: number) => {
            if (!cloud || typeof cloud !== "object") {
                throw new Error(`Invalid Ares superweapon effect state: ${label}.clouds[${cloudIndex}]`);
            }
            const tile = validateCell({ rx: cloud.tileRx, ry: cloud.tileRy }, `${label}.clouds[${cloudIndex}].tile`, false)!;
            const durationTicks = nonNegativeInteger(cloud.durationTicks, `${label}.clouds[${cloudIndex}].durationTicks`);
            const ticksLeft = nonNegativeInteger(cloud.ticksLeft, `${label}.clouds[${cloudIndex}].ticksLeft`);
            if (ticksLeft > durationTicks) {
                throw new Error(`Invalid Ares superweapon effect state: ${label}.clouds[${cloudIndex}].ticksLeft`);
            }
            return { tileRx: tile.rx, tileRy: tile.ry, durationTicks, ticksLeft };
        });
        return {
            ...base,
            state: nonNegativeInteger(candidate.state, `${label}.state`),
            manifestStartTimer: nonNegativeInteger(candidate.manifestStartTimer, `${label}.manifestStartTimer`),
            manifestEndTimer: negativeOneOrNonNegativeInteger(candidate.manifestEndTimer, `${label}.manifestEndTimer`),
            nextDirectHitTimer: nonNegativeInteger(candidate.nextDirectHitTimer, `${label}.nextDirectHitTimer`),
            nextRandomHitTimer: nonNegativeInteger(candidate.nextRandomHitTimer, `${label}.nextRandomHitTimer`),
            clouds,
        };
    }
    if (kind === "chrono-sphere") {
        if (!Array.isArray(candidate.objectsToTeleport)) {
            throw new Error(`Invalid Ares superweapon effect state: ${label}.objectsToTeleport`);
        }
        const ids = new Set<number>();
        const objectsToTeleport = candidate.objectsToTeleport.map((entry: any, entryIndex: number) => {
            if (!entry || typeof entry !== "object") {
                throw new Error(`Invalid Ares superweapon effect state: ${label}.objectsToTeleport[${entryIndex}]`);
            }
            const id = nonNegativeInteger(entry.objectId, `${label}.objectsToTeleport[${entryIndex}].objectId`);
            if (ids.has(id)) throw new Error(`Invalid Ares superweapon effect state: duplicate teleport object ${id}`);
            ids.add(id);
            const destination = entry.destRx === null || entry.destRy === null
                ? null
                : validateCell({ rx: entry.destRx, ry: entry.destRy }, `${label}.objectsToTeleport[${entryIndex}].destination`, false);
            if ((entry.destRx === null) !== (entry.destRy === null)) {
                throw new Error(`Invalid Ares superweapon effect state: ${label}.objectsToTeleport[${entryIndex}].destination`);
            }
            return {
                objectId: id,
                destRx: destination?.rx ?? null,
                destRy: destination?.ry ?? null,
            };
        });
        return {
            ...base,
            delayTicks: nonNegativeInteger(candidate.delayTicks, `${label}.delayTicks`),
            tile2: validateCell(candidate.tile2, `${label}.tile2`, true),
            objectsToTeleport,
        };
    }
    if (kind === "psychic-dominator") {
        const optionalAnimation = (value: unknown, field: string): string | null => {
            if (value === undefined || value === null) return null;
            if (typeof value !== "string") throw new Error(`Invalid Ares superweapon effect state: ${label}.${field}`);
            return value;
        };
        const booleanValue = (value: unknown, field: string, fallback: boolean): boolean => {
            if (value === undefined) return fallback;
            if (typeof value !== "boolean") throw new Error(`Invalid Ares superweapon effect state: ${label}.${field}`);
            return value;
        };
        const nonNegative = (value: unknown, field: string, fallback: number): number =>
            value === undefined ? fallback : nonNegativeInteger(value, `${label}.${field}`);
        const finite = (value: unknown, field: string, fallback: number): number =>
            finiteNumber(value, `${label}.${field}`, fallback);
        return {
            ...base,
            ticksLeft: nonNegativeInteger(candidate.ticksLeft, `${label}.ticksLeft`),
            initialDeferment: nonNegativeInteger(candidate.initialDeferment, `${label}.initialDeferment`),
            configured: booleanValue(candidate.configured, "configured", false),
            firstAnim: optionalAnimation(candidate.firstAnim, "firstAnim"),
            firstAnimHeight: finite(candidate.firstAnimHeight, "firstAnimHeight", 750),
            secondAnim: optionalAnimation(candidate.secondAnim, "secondAnim"),
            secondAnimHeight: finite(candidate.secondAnimHeight, "secondAnimHeight", 0),
            controlAnim: optionalAnimation(candidate.controlAnim, "controlAnim"),
            capture: booleanValue(candidate.capture, "capture", true),
            ripple: booleanValue(candidate.ripple, "ripple", true),
            captureMindControlled: booleanValue(candidate.captureMindControlled, "captureMindControlled", true),
            capturePermaMindControlled: booleanValue(candidate.capturePermaMindControlled, "capturePermaMindControlled", true),
            captureImmuneToPsionics: booleanValue(candidate.captureImmuneToPsionics, "captureImmuneToPsionics", false),
            permanentCapture: booleanValue(candidate.permanentCapture, "permanentCapture", true),
        };
    }
    if (kind === "force-shield") {
        const booleanValue = (value: unknown, field: string, fallback: boolean): boolean => {
            if (value === undefined) return fallback;
            if (typeof value !== "boolean") throw new Error(`Invalid Ares superweapon effect state: ${label}.${field}`);
            return value;
        };
        const nonNegative = (value: unknown, field: string, fallback: number): number =>
            value === undefined ? fallback : nonNegativeInteger(value, `${label}.${field}`);
        const specialSound = candidate.specialSound === undefined || candidate.specialSound === null
            ? null
            : typeof candidate.specialSound === "string"
                ? candidate.specialSound
                : (() => { throw new Error(`Invalid Ares superweapon effect state: ${label}.specialSound`); })();
        return {
            ...base,
            ticksLeft: nonNegative(candidate.ticksLeft, "ticksLeft", 0),
            duration: nonNegative(candidate.duration, "duration", 0),
            fadeSoundTime: nonNegative(candidate.fadeSoundTime, "fadeSoundTime", 0),
            specialSound,
            fadeSoundPlayed: booleanValue(candidate.fadeSoundPlayed, "fadeSoundPlayed", false),
            configured: booleanValue(candidate.configured, "configured", false),
        };
    }
    if (kind === "unit-delivery") {
        return { ...base, remainingTicks: nonNegativeInteger(candidate.remainingTicks, `${label}.remainingTicks`) };
    }
    if (kind === "empulse") {
        if (typeof candidate.launched !== "boolean") {
            throw new Error(`Invalid Ares superweapon effect state: ${label}.launched`);
        }
        if (!Array.isArray(candidate.launchSiteIds)) {
            throw new Error(`Invalid Ares superweapon effect state: ${label}.launchSiteIds`);
        }
        const ids = new Set<number>();
        const launchSiteIds = candidate.launchSiteIds.map((id: unknown, idIndex: number) => {
            const normalized = nonNegativeInteger(id, `${label}.launchSiteIds[${idIndex}]`);
            if (ids.has(normalized)) throw new Error(`Invalid Ares superweapon effect state: duplicate launch site ${normalized}`);
            ids.add(normalized);
            return normalized;
        });
        return {
            ...base,
            pendingFrames: nonNegativeInteger(candidate.pendingFrames, `${label}.pendingFrames`),
            launched: candidate.launched,
            launchSiteIds,
        };
    }
    if (kind === "drop-pod") {
        if (typeof candidate.completed !== "boolean") {
            throw new Error(`Invalid Ares superweapon effect state: ${label}.completed`);
        }
        return { ...base, completed: candidate.completed };
    }
    return base;
}

export function validateAresSuperWeaponEffectState(state: unknown): AresSuperWeaponEffectsState {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        throw new Error("Invalid Ares superweapon effect state: expected an object");
    }
    const candidate = state as Record<string, unknown>;
    if (candidate.version !== ARES_SUPER_WEAPON_EFFECT_STATE_VERSION) {
        throw new Error(`Unsupported Ares superweapon effect state version: ${String(candidate.version)}`);
    }
    if (!Array.isArray(candidate.effects)) {
        throw new Error("Invalid Ares superweapon effect state: effects must be an array");
    }
    const indices = new Set<number>();
    const effects = candidate.effects.map((entry, index) => {
        const normalized = validateEntry(entry, `effects[${index}]`);
        if (indices.has(normalized.index)) {
            throw new Error(`Invalid Ares superweapon effect state: duplicate index ${normalized.index}`);
        }
        indices.add(normalized.index);
        return normalized;
    }).sort((left, right) => left.index - right.index);
    const sources = candidate.pendingChronoSphereSources === undefined
        ? []
        : candidate.pendingChronoSphereSources;
    if (!Array.isArray(sources)) {
        throw new Error("Invalid Ares superweapon effect state: pendingChronoSphereSources must be an array");
    }
    const owners = new Set<number>();
    const pendingChronoSphereSources = sources.map((source: any, index: number): AresChronoSphereSourceState => {
        if (!source || typeof source !== "object") {
            throw new Error(`Invalid Ares superweapon effect state: pendingChronoSphereSources[${index}]`);
        }
        const ownerIndex = nonNegativeInteger(source.ownerIndex, `pendingChronoSphereSources[${index}].ownerIndex`);
        if (owners.has(ownerIndex)) {
            throw new Error(`Invalid Ares superweapon effect state: duplicate pending source owner ${ownerIndex}`);
        }
        owners.add(ownerIndex);
        const tile = validateCell({ rx: source.tileRx, ry: source.tileRy }, `pendingChronoSphereSources[${index}].tile`, false)!;
        if (source.ruleName !== undefined &&
            (typeof source.ruleName !== "string" || source.ruleName.length === 0)) {
            throw new Error(`Invalid Ares superweapon effect state: pendingChronoSphereSources[${index}].ruleName`);
        }
        if (source.ruleIndex !== undefined) nonNegativeInteger(source.ruleIndex, `pendingChronoSphereSources[${index}].ruleIndex`);
        return {
            ownerIndex,
            tileRx: tile.rx,
            tileRy: tile.ry,
            ...(source.ruleName !== undefined ? { ruleName: source.ruleName as string } : {}),
            ...(source.ruleIndex !== undefined ? { ruleIndex: source.ruleIndex as number } : {}),
        };
    }).sort((left, right) => left.ownerIndex - right.ownerIndex);
    return { version: ARES_SUPER_WEAPON_EFFECT_STATE_VERSION, effects, pendingChronoSphereSources };
}

function resolveFromWorld(context: AresSuperWeaponEffectRestoreContext, resolver: keyof AresSuperWeaponEffectRestoreContext, ...args: any[]): any {
    const fn = context[resolver] as ((...values: any[]) => any) | undefined;
    if (typeof fn === "function") return fn(...args);
    return undefined;
}

function tileMatches(tile: any, rx: number, ry: number): boolean {
    return !!tile && tile.rx === rx && tile.ry === ry;
}

function resolveTileForState(
    state: { rx: number; ry: number },
    fallback: any,
    context: AresSuperWeaponEffectRestoreContext,
    label: string,
): any {
    const resolved = resolveFromWorld(context, "resolveTile", state.rx, state.ry) ??
        context.world?.map?.tiles?.getByMapCoords?.(state.rx, state.ry);
    if (resolved !== undefined && resolved !== null) {
        if (!tileMatches(resolved, state.rx, state.ry)) {
            if (context.strict) throw new Error(`Cannot restore Ares superweapon effect ${label}: tile identity changed`);
        }
        return resolved;
    }
    const hasResolver = typeof context.resolveTile === "function" ||
        typeof context.world?.map?.tiles?.getByMapCoords === "function";
    if (!hasResolver && tileMatches(fallback, state.rx, state.ry)) return fallback;
    if (context.strict) throw new Error(`Cannot restore Ares superweapon effect ${label}: tile is unresolved`);
    return undefined;
}

function resolveObjectForState(
    id: number | null,
    context: AresSuperWeaponEffectRestoreContext,
    label: string,
    fallback?: any,
): any {
    if (id === null) return undefined;
    const resolved = resolveFromWorld(context, "resolveObjectById", id) ??
        context.world?.getObjectById?.(id) ??
        context.world?.world?.getAllObjects?.().find((object: any) => object?.id === id);
    if (resolved !== undefined && resolved !== null) {
        if (resolved.id !== id && context.strict) {
            throw new Error(`Cannot restore Ares superweapon effect ${label}: object identity changed`);
        }
        return resolved;
    }
    const hasResolver = typeof context.resolveObjectById === "function" ||
        typeof context.world?.getObjectById === "function" ||
        typeof context.world?.world?.getAllObjects === "function";
    if (!hasResolver && fallback?.id === id) return fallback;
    if (context.strict) throw new Error(`Cannot restore Ares superweapon effect ${label}: object ${id} is unresolved`);
    return undefined;
}

function resolvePlayerForState(
    index: number,
    fallback: any,
    context: AresSuperWeaponEffectRestoreContext,
    label: string,
): any {
    const resolved = resolveFromWorld(context, "resolvePlayerByIndex", index) ??
        context.world?.playerList?.getAll?.().find((player: any) => player?.playerListIndex === index);
    if (resolved !== undefined && resolved !== null) {
        if (resolved.playerListIndex !== index && context.strict) {
            throw new Error(`Cannot restore Ares superweapon effect ${label}: player identity changed`);
        }
        return resolved;
    }
    const hasResolver = typeof context.resolvePlayerByIndex === "function" ||
        typeof context.world?.playerList?.getAll === "function";
    if (!hasResolver && fallback?.playerListIndex === index) return fallback;
    if (context.strict) throw new Error(`Cannot restore Ares superweapon effect ${label}: player ${index} is unresolved`);
    return undefined;
}

function resolveRuleForState(
    source: AresChronoSphereSourceState,
    fallback: any,
    context: AresSuperWeaponEffectRestoreContext,
): any {
    if (source.ruleName === undefined && source.ruleIndex === undefined) return fallback?.rules;
    const byName = source.ruleName === undefined
        ? undefined
        : resolveFromWorld(context, "resolveRuleByName", source.ruleName) ??
            resolveFromWorld(context, "resolveSuperWeaponRule", source.ruleName, source.ruleIndex);
    const byIndex = source.ruleIndex === undefined
        ? undefined
        : resolveFromWorld(context, "resolveRuleByIndex", source.ruleIndex) ??
            resolveFromWorld(context, "resolveSuperWeaponRule", source.ruleName, source.ruleIndex);
    const resolved = byName ?? byIndex;
    if (resolved !== undefined && resolved !== null) return resolved;
    const hasResolver = typeof context.resolveSuperWeaponRule === "function" ||
        typeof context.resolveRuleByName === "function" ||
        typeof context.resolveRuleByIndex === "function";
    if (!hasResolver && tileMatches(fallback?.tile, source.tileRx, source.tileRy)) return fallback.rules;
    if (context.strict) {
        throw new Error(`Cannot restore Ares superweapon effect ChronoSphere source ${source.ownerIndex}: rule is unresolved`);
    }
    return undefined;
}

function prepareEffect(
    state: AresSuperWeaponEffectEntry,
    effect: SuperWeaponEffect,
    context: AresSuperWeaponEffectRestoreContext,
): ResolvedEffectState {
    const value = effect as any;
    const kind = effectKind(effect);
    if (kind !== "unknown" && state.kind !== "unknown" && kind !== state.kind && context.strict) {
        throw new Error(`Cannot restore Ares superweapon effect ${state.index}: effect kind changed`);
    }
    if (state.kind !== "unknown" && state.type !== null && scalar(value.type) !== state.type && context.strict) {
        throw new Error(`Cannot restore Ares superweapon effect ${state.index}: effect type changed`);
    }
    const owner = state.ownerIndex < 0
        ? undefined
        : resolvePlayerForState(state.ownerIndex, value.owner, context, String(state.index));
    const tile = state.tileRx < 0 || state.tileRy < 0
        ? undefined
        : resolveTileForState({ rx: state.tileRx, ry: state.tileRy }, value.tile, context, String(state.index));
    const resolved: ResolvedEffectState = { state, effect, owner, tile };
    if (state.kind === "paradrop") {
        const targetTile = state.targetTile
            ? resolveTileForState(state.targetTile, value.targetTile, context, `${state.index}.targetTile`)
            : undefined;
        const plane = state.planeId === null
            ? undefined
            : resolveObjectForState(state.planeId, context, `${state.index}.plane`, value.pdPlane);
        const hasInfantryResolver = typeof context.resolveInfantryRules === "function";
        const passengerRules = state.squadInfantryType
            ? hasInfantryResolver
                ? resolveFromWorld(context, "resolveInfantryRules", state.squadInfantryType)
                : value.passengerRules
            : value.passengerRules;
        if (context.strict && state.squadInfantryType && state.status === EffectStatus.Running && !passengerRules) {
            throw new Error(`Cannot restore Ares superweapon effect ${state.index}: passenger rules are unresolved`);
        }
        return { ...resolved, targetTile, plane, passengerRules };
    }
    if (state.kind === "lightning-storm") {
        const clouds = state.clouds?.map((cloud, cloudIndex) => ({
            tile: resolveTileForState({ rx: cloud.tileRx, ry: cloud.tileRy }, value.clouds?.[cloudIndex]?.tile, context, `${state.index}.clouds[${cloudIndex}]`),
            durationTicks: cloud.durationTicks,
            ticksLeft: cloud.ticksLeft,
        })) ?? [];
        return { ...resolved, clouds };
    }
    if (state.kind === "chrono-sphere") {
        const tile2 = state.tile2
            ? resolveTileForState(state.tile2, value.tile2, context, `${state.index}.tile2`)
            : undefined;
        const objectsToTeleport = state.objectsToTeleport?.map((entry, entryIndex) => {
            const obj = resolveObjectForState(
                entry.objectId,
                context,
                `${state.index}.objectsToTeleport[${entryIndex}]`,
                value.objectsToTeleport?.[entryIndex]?.obj,
            );
            const destTile = entry.destRx === null || entry.destRy === null
                ? undefined
                : resolveTileForState({ rx: entry.destRx, ry: entry.destRy }, value.objectsToTeleport?.[entryIndex]?.destTile, context, `${state.index}.objectsToTeleport[${entryIndex}].destination`);
            return { obj, destTile };
        }) ?? [];
        return { ...resolved, tile2, objectsToTeleport };
    }
    if (state.kind === "empulse") {
        const launchSites = state.launchSiteIds?.map((id, siteIndex) =>
            resolveObjectForState(id, context, `${state.index}.launchSites[${siteIndex}]`, value.launchSites?.[siteIndex]),
        ) ?? [];
        return { ...resolved, launchSites };
    }
    return resolved;
}

function applyResolvedEffect(resolved: ResolvedEffectState): void {
    const state = resolved.state;
    const effect = resolved.effect as any;
    effect.type = state.type === null ? undefined : state.type;
    if (resolved.owner !== undefined || state.ownerIndex < 0) effect.owner = resolved.owner;
    if (resolved.tile !== undefined || state.tileRx < 0 || state.tileRy < 0) effect.tile = resolved.tile;
    effect.status = state.status;
    if (state.kind === "unknown" && state.unknownFields) {
        for (const [key, field] of Object.entries(state.unknownFields)) effect[key] = field;
    }
    if (state.kind === "paradrop") {
        effect.state = state.state;
        effect.failedAttempts = state.failedAttempts;
        effect.spawnDelay = state.spawnDelay;
        effect.passengerCount = state.passengerCount ?? undefined;
        effect.targetTile = resolved.targetTile;
        effect.pdPlane = resolved.plane;
        if (state.squadInfantryType !== null && state.squadInfantryType !== undefined) {
            effect.paradropSquad = { inf: state.squadInfantryType, num: state.squadCount };
        }
        if (resolved.passengerRules !== undefined) effect.passengerRules = resolved.passengerRules;
    }
    else if (state.kind === "nuke") {
        if (state.weaponType !== null && state.weaponType !== undefined) effect.weaponType = state.weaponType;
    }
    else if (state.kind === "lightning-storm") {
        effect.state = state.state;
        effect.manifestStartTimer = state.manifestStartTimer;
        effect.manifestEndTimer = state.manifestEndTimer;
        effect.nextDirectHitTimer = state.nextDirectHitTimer;
        effect.nextRandomHitTimer = state.nextRandomHitTimer;
        effect.clouds = resolved.clouds;
    }
    else if (state.kind === "chrono-sphere") {
        effect.delayTicks = state.delayTicks;
        effect.tile2 = resolved.tile2;
        effect.objectsToTeleport = resolved.objectsToTeleport;
    }
    else if (state.kind === "psychic-dominator") {
        effect.ticksLeft = state.ticksLeft;
        effect.initialDeferment = state.initialDeferment;
        effect.configured = state.configured;
        effect.firstAnim = state.firstAnim ?? undefined;
        effect.firstAnimHeight = state.firstAnimHeight;
        effect.secondAnim = state.secondAnim ?? undefined;
        effect.secondAnimHeight = state.secondAnimHeight;
        effect.controlAnim = state.controlAnim ?? undefined;
        effect.capture = state.capture;
        effect.ripple = state.ripple;
        effect.captureMindControlled = state.captureMindControlled;
        effect.capturePermaMindControlled = state.capturePermaMindControlled;
        effect.captureImmuneToPsionics = state.captureImmuneToPsionics;
        effect.permanentCapture = state.permanentCapture;
    }
    else if (state.kind === "force-shield") {
        effect.ticksLeft = state.ticksLeft;
        effect.duration = state.duration;
        effect.fadeSoundTime = state.fadeSoundTime;
        effect.specialSound = state.specialSound ?? undefined;
        effect.fadeSoundPlayed = state.fadeSoundPlayed;
        effect.configured = state.configured;
    }
    else if (state.kind === "unit-delivery") {
        effect.remainingTicks = state.remainingTicks;
    }
    else if (state.kind === "empulse") {
        effect.pendingFrames = state.pendingFrames;
        effect.launched = state.launched;
        effect.launchSites = resolved.launchSites;
    }
    else if (state.kind === "drop-pod") {
        effect.completed = state.completed;
    }
}

export function prepareAresSuperWeaponEffectStateRestore(
    state: unknown,
    effects: readonly SuperWeaponEffect[] | undefined,
    chronoSphereSources: Iterable<readonly [any, any]> | undefined,
    context: AresSuperWeaponEffectRestoreContext = {},
): PreparedAresSuperWeaponEffectStateRestore {
    const normalized = validateAresSuperWeaponEffectState(state);
    const targetEffects = activeEffects(effects);
    const sourceEntries = new Map<any, any>();
    for (const [owner, source] of chronoSphereSources ?? []) sourceEntries.set(owner, source);
    const resolvedEffects: ResolvedEffectState[] = [];
    const restoredEffects: SuperWeaponEffect[] = [];
    if (context.strict && targetEffects.length !== normalized.effects.length) {
        throw new Error("Cannot restore Ares superweapon effects: effect set is incomplete");
    }
    for (const entry of normalized.effects) {
        const target = targetEffects[entry.index];
        if (!target) {
            if (context.strict) {
                throw new Error(`Cannot restore Ares superweapon effect ${entry.index}: effect is unresolved`);
            }
            continue;
        }
        if (context.strict && target.status === EffectStatus.Finished) {
            throw new Error(`Cannot restore Ares superweapon effect ${entry.index}: effect is finished`);
        }
        const resolved = prepareEffect(entry, target, context);
        resolvedEffects.push(resolved);
        restoredEffects.push(target);
    }

    const pending: Array<[any, any]> = [];
    for (const source of normalized.pendingChronoSphereSources) {
        const owner = resolvePlayerForState(source.ownerIndex, undefined, context, `source ${source.ownerIndex}`);
        if (owner === undefined && context.strict) {
            throw new Error(`Cannot restore Ares superweapon effect ChronoSphere source ${source.ownerIndex}: player is unresolved`);
        }
        const tile = resolveTileForState(
            { rx: source.tileRx, ry: source.tileRy },
            undefined,
            context,
            `source ${source.ownerIndex}`,
        );
        if (tile === undefined && context.strict) {
            throw new Error(`Cannot restore Ares superweapon effect ChronoSphere source ${source.ownerIndex}: tile is unresolved`);
        }
        const existing = sourceEntries.get(owner);
        const rules = resolveRuleForState(source, existing, context);
        if (rules === undefined && context.strict) {
            throw new Error(`Cannot restore Ares superweapon effect ChronoSphere source ${source.ownerIndex}: rule is unresolved`);
        }
        if (owner !== undefined) pending.push([owner, { rules, tile }]);
    }
    return {
        effects: restoredEffects,
        pendingChronoSphereSources: pending,
        apply: () => {
            for (const resolved of resolvedEffects) applyResolvedEffect(resolved);
        },
    };
}

export function restoreAresSuperWeaponEffectState(
    target: AresSuperWeaponEffectStateTarget,
    state: unknown,
    context: AresSuperWeaponEffectRestoreContext = {},
): void {
    const sources = target.chronoSphereSources?.entries?.() ?? [];
    const effectiveContext = context && ((context as any).map || (context as any).playerList || (context as any).getObjectById)
        ? { ...context, world: context }
        : context;
    const plan = prepareAresSuperWeaponEffectStateRestore(state, target.effects, sources, effectiveContext);
    plan.apply();
    target.effects = plan.effects;
    if (target.chronoSphereSources &&
        typeof target.chronoSphereSources.clear === "function" &&
        typeof target.chronoSphereSources.set === "function") {
        target.chronoSphereSources.clear();
        for (const [owner, source] of plan.pendingChronoSphereSources) {
            target.chronoSphereSources.set(owner, source);
        }
    }
}

export const captureAresSuperWeaponEffectState = serializeAresSuperWeaponEffectState;
export const captureAresSuperWeaponEffectsState = serializeAresSuperWeaponEffectState;
export const validateAresSuperWeaponEffectsState = validateAresSuperWeaponEffectState;
export const restoreAresSuperWeaponEffectsState = restoreAresSuperWeaponEffectState;
