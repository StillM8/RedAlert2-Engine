import { ObjectType } from "@/engine/type/ObjectType";
import {
    normalizeObjectTechLevelOverrideState,
    type ObjectTechLevelOverrideState,
} from "@/game/rules/Rules";
import { CountdownTimer, type CountdownTimerState } from "@/game/CountdownTimer";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import type { AresAttachEffectRestoreContext } from "@/extensions/ares/AresAttachEffectState";
import {
    parseAresAnimationDamage,
    type AresAnimationDamageDefinition,
} from "@/extensions/ares/AresAnimationDamage";
import type { AresAnimationDamageRestoreContext } from "@/extensions/ares/AresAnimationDamageRuntime";
import { parseMakeInfantryAnimation, type AresMakeInfantryRestoreContext } from "@/extensions/ares/AresMakeInfantry";
import {
    captureAresPreferredTargetingCells,
    restoreAresPreferredTargetingCells,
    type AresPreferredTargetingCellsState,
} from "@/extensions/ares/AresSuperWeaponTargetingCell";
import { MoveTrait } from "@/game/gameobject/trait/MoveTrait";
import { TntChargeTrait, type TntChargeTraitRestoreContext } from "@/game/gameobject/trait/TntChargeTrait";
import { InvulnerableTrait } from "@/game/gameobject/trait/InvulnerableTrait";
import {
    MindControllableTrait,
    type MindControllableTraitRestoreContext,
} from "@/game/gameobject/trait/MindControllableTrait";
import {
    MindControllerTrait,
    type MindControllerTraitRestoreContext,
} from "@/game/gameobject/trait/MindControllerTrait";
import {
    PrismSupportTrait,
    type PrismSupportTraitRestoreContext,
} from "@/game/gameobject/trait/PrismSupportTrait";
import type { ProductionRestoreContext } from "@/game/player/production/Production";
import {
    validateAresLaserFenceSnapshot,
    type AresLaserFenceSnapshot,
} from "@/extensions/ares/AresLaserFences";
import {
    validateAresSuperWeaponEffectState,
    type AresSuperWeaponEffectRestoreContext,
    type PreparedAresSuperWeaponEffectStateRestore,
} from "@/extensions/ares/AresSuperWeaponEffectState";
import { SuperWeaponsTrait as WorldSuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";

/**
 * Canonical snapshot walk for extension-owned simulation state.
 *
 * The current full-game save format resumes an action log rather than
 * restoring a complete snapshot, which left every versioned extension codec
 * unreachable from production code. This walk gives save, replay, and
 * snapshot hosts one entry point over the existing codecs:
 *
 *   - Production.captureState / restoreDeterministicState
 *   - SuperWeapon.serializeAresState / restoreAresState
 *   - AresAttachEffectTrait.serializeState / restoreState
 *   - AresAnimationDamageRuntime.captureState / restoreState
 *   - Ares preferred AI targeting cells (map actions 135/140)
 *
 * Identity follows docs/DeterministicIdentity.md: players are keyed by their
 * canonical PlayerList slot, objects by canonical object id, and authored
 * superweapon rules by stable authored name. Strict restore validates every
 * reference before mutating anything so a rejected payload cannot half-apply.
 */

export const EXTENSION_STATE_SNAPSHOT_VERSION = 1 as const;

export interface ExtensionStateSuperWeaponEntry {
    name: string;
    state: unknown;
}

export interface ExtensionStatePlayerEntry {
    /** Canonical PlayerList slot, not the display name. */
    playerListIndex: number;
    productionState?: unknown;
    buildLimitState?: unknown;
    preferredTargetingCells?: AresPreferredTargetingCellsState;
    superWeapons: ExtensionStateSuperWeaponEntry[];
}

export interface ExtensionStateObjectEntry {
    objectId: number;
    state: unknown;
}

export interface ExtensionStateSnapshot {
    version: typeof EXTENSION_STATE_SNAPSHOT_VERSION;
    animationDamageState?: unknown;
    makeInfantryState?: unknown;
    superWeaponEffectsState?: unknown;
    triggerState?: unknown;
    objectTechLevelState?: ObjectTechLevelOverrideState;
    countdownTimerState?: CountdownTimerState;
    players: ExtensionStatePlayerEntry[];
    attachEffects: ExtensionStateObjectEntry[];
    moveStates?: ExtensionStateObjectEntry[];
    tntChargeStates?: ExtensionStateObjectEntry[];
    prismSupportStates?: ExtensionStateObjectEntry[];
    protectionStates?: ExtensionStateObjectEntry[];
    mindControlStates?: ExtensionStateObjectEntry[];
    mindControllerStates?: ExtensionStateObjectEntry[];
    laserFenceState?: AresLaserFenceSnapshot;
}

export interface ExtensionStateRestoreOptions {
    /** Reject unresolved references before mutating anything. */
    strict?: boolean;
    animationDamageContext?: AresAnimationDamageRestoreContext;
    attachEffectContext?: AresAttachEffectRestoreContext;
    productionContext?: ProductionRestoreContext;
    tntChargeContext?: TntChargeTraitRestoreContext;
    prismSupportContext?: PrismSupportTraitRestoreContext;
    mindControlContext?: MindControllableTraitRestoreContext;
    mindControllerContext?: MindControllerTraitRestoreContext;
    superWeaponEffectsContext?: Partial<AresSuperWeaponEffectRestoreContext>;
    superWeaponEffectContext?: Partial<AresSuperWeaponEffectRestoreContext>;
    /** World passed through to SuperWeapon.restoreAresState house hooks. */
    superWeaponWorld?: unknown;
}

function isCanonicalId(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function superWeaponKey(weapon: any): string {
    return String(weapon?.name ?? weapon?.rules?.name ?? "");
}

function collectSuperWeapons(player: any): any[] {
    return player?.superWeaponsTrait?.getAll?.() ?? [];
}

function collectObjects(game: any): any[] {
    return game?.world?.getAllObjects?.() ?? game?.getAllObjects?.() ?? [];
}

function findWorldSuperWeaponsTrait(game: any): any {
    try {
        const found = game?.traits?.find?.(WorldSuperWeaponsTrait);
        if (found) return found;
    }
    catch {
    }
    return game?.traits?.getAll?.().find((trait: any) =>
        trait instanceof WorldSuperWeaponsTrait ||
        ((typeof trait?.captureAresState === "function" ||
            typeof trait?.serializeAresState === "function" ||
            typeof trait?.captureState === "function") &&
            typeof trait?.prepareAresStateRestore === "function"),
    );
}

function findAttachEffectTrait(object: any): AresAttachEffectTrait | undefined {
    const traits = object?.traits?.getAll?.() ?? [];
    return traits.find((trait: unknown) => trait instanceof AresAttachEffectTrait);
}

function findMoveTrait(object: any): MoveTrait | undefined {
    if (object?.moveTrait instanceof MoveTrait) return object.moveTrait;
    const traits = object?.traits?.getAll?.() ?? [];
    return traits.find((trait: unknown) => trait instanceof MoveTrait);
}

function findTntChargeTrait(object: any): TntChargeTrait | undefined {
    if (object?.tntChargeTrait instanceof TntChargeTrait) return object.tntChargeTrait;
    const traits = object?.traits?.getAll?.() ?? [];
    return traits.find((trait: any) => trait instanceof TntChargeTrait);
}

function findPrismSupportTrait(object: any): PrismSupportTrait | undefined {
    if (object?.prismSupportTrait instanceof PrismSupportTrait) return object.prismSupportTrait;
    const traits = object?.traits?.getAll?.() ?? [];
    return traits.find((trait: any) => trait instanceof PrismSupportTrait);
}

function findProtectionTrait(object: any): InvulnerableTrait | undefined {
    if (object?.invulnerableTrait instanceof InvulnerableTrait) return object.invulnerableTrait;
    const traits = object?.traits?.getAll?.() ?? [];
    return traits.find((trait: any) => trait instanceof InvulnerableTrait);
}

function findMindControllableTrait(object: any): MindControllableTrait | undefined {
    if (object?.mindControllableTrait instanceof MindControllableTrait) return object.mindControllableTrait;
    const traits = object?.traits?.getAll?.() ?? [];
    return traits.find((trait: any) => trait instanceof MindControllableTrait);
}

function findMindControllerTrait(object: any): MindControllerTrait | undefined {
    if (object?.mindControllerTrait instanceof MindControllerTrait) return object.mindControllerTrait;
    const traits = object?.traits?.getAll?.() ?? [];
    return traits.find((trait: any) => trait instanceof MindControllerTrait);
}

function findObject(game: any, objectId: number): any | undefined {
    try {
        const direct = game?.getObjectById?.(objectId);
        if (direct) return direct;
    }
    catch {
        return collectObjects(game).find((object: any) => object?.id === objectId);
    }
    return collectObjects(game).find((object: any) => object?.id === objectId);
}

function captureObjectStates(
    game: any,
    findTrait: (object: any) => any,
    method: "captureState" | "serializeState",
): ExtensionStateObjectEntry[] {
    return collectObjects(game)
        .map((object: any) => ({ objectId: object?.id, trait: findTrait(object) }))
        .filter((entry: any) => entry.trait && isCanonicalId(entry.objectId))
        .map((entry: any) => ({ objectId: entry.objectId, state: entry.trait[method]() }))
        .sort((a, b) => a.objectId - b.objectId);
}

function resolvePlayerByIndex(game: any, index: number): any {
    const player = (game?.playerList?.getAll?.() ?? [])[index];
    return player?.playerListIndex === index ? player : undefined;
}

function resolveObjectById(game: any, id: number): any {
    const object = findObject(game, id);
    return object?.id === id ? object : undefined;
}

function resolveAttachEffectDefinition(game: any, kind: string, ownerName: string): unknown {
    if (kind === "warhead") {
        try {
            return game?.rules?.getWarhead?.(ownerName)?.aresAttachEffect;
        }
        catch {
            return undefined;
        }
    }
    for (const type of [ObjectType.Building, ObjectType.Infantry, ObjectType.Vehicle, ObjectType.Aircraft]) {
        try {
            const definition = game?.rules?.getObject?.(ownerName, type)?.aresAttachEffect;
            if (definition !== undefined) return definition;
        }
        catch {
            continue;
        }
    }
    return undefined;
}

function resolveAnimationDefinition(
    game: any,
    name: string,
): AresAnimationDamageDefinition | undefined {
    try {
        return parseAresAnimationDamage(name, game?.art?.getAnimation?.(name)?.art);
    }
    catch {
        return undefined;
    }
}

function validatePreferredTargetingCells(
    state: AresPreferredTargetingCellsState | undefined,
): AresPreferredTargetingCellsState | undefined {
    if (state === undefined) return undefined;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        throw new Error("Invalid preferred targeting cell state");
    }
    const normalized: AresPreferredTargetingCellsState = {};
    for (const kind of ["offensive", "defensive"] as const) {
        const cell = state[kind];
        if (cell === undefined) continue;
        if (!cell || typeof cell !== "object" ||
            !Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)) {
            throw new Error(`Invalid preferred targeting cell state: ${kind}`);
        }
        normalized[kind] = { x: cell.x, y: cell.y };
    }
    return normalized;
}

function validateBuildLimitState(state: unknown): unknown {
    if (state === undefined) return undefined;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        throw new Error("Invalid BuildLimit state");
    }
    const candidate = state as { version?: unknown; limitedUnitsBuiltByFamily?: unknown };
    if (candidate.version !== 1 || !candidate.limitedUnitsBuiltByFamily ||
        typeof candidate.limitedUnitsBuiltByFamily !== "object" || Array.isArray(candidate.limitedUnitsBuiltByFamily)) {
        throw new Error("Invalid BuildLimit state");
    }
    const limitedUnitsBuiltByFamily: Record<string, number> = {};
    for (const [family, count] of Object.entries(candidate.limitedUnitsBuiltByFamily as Record<string, unknown>)) {
        if (!family || !Number.isSafeInteger(count) || (count as number) < 0) {
            throw new Error("Invalid BuildLimit history");
        }
        limitedUnitsBuiltByFamily[family] = count as number;
    }
    return { version: 1, limitedUnitsBuiltByFamily };
}

function parseObjectEntries(
    value: unknown,
    label: string,
): ExtensionStateObjectEntry[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new Error(`Invalid extension state snapshot: ${label} must be an array`);
    }
    const ids = new Set<number>();
    return value.map((entry: any) => {
        if (!entry || typeof entry !== "object" || !isCanonicalId(entry.objectId) || !("state" in entry)) {
            throw new Error(`Invalid extension state snapshot: ${label} entry`);
        }
        if (ids.has(entry.objectId)) {
            throw new Error(`Invalid extension state snapshot: duplicate ${label} object ${entry.objectId}`);
        }
        ids.add(entry.objectId);
        return { objectId: entry.objectId, state: entry.state };
    });
}

function parseSnapshot(snapshot: unknown): ExtensionStateSnapshot {
    if (!snapshot || typeof snapshot !== "object") {
        throw new Error("Invalid extension state snapshot: expected an object");
    }
    const candidate = snapshot as ExtensionStateSnapshot;
    if (candidate.version !== EXTENSION_STATE_SNAPSHOT_VERSION) {
        throw new Error(
            `Unsupported extension state snapshot version: ${String((snapshot as any).version)}`,
        );
    }
    if (!Array.isArray(candidate.players) || !Array.isArray(candidate.attachEffects)) {
        throw new Error("Invalid extension state snapshot: collections must be arrays");
    }
    const playerSlots = new Set<number>();
    for (const entry of candidate.players) {
        if (!entry || typeof entry !== "object" || !isCanonicalId(entry.playerListIndex) ||
            !Array.isArray(entry.superWeapons)) {
            throw new Error("Invalid extension state snapshot: player entry");
        }
        if (playerSlots.has(entry.playerListIndex)) {
            throw new Error(`Invalid extension state snapshot: duplicate player slot ${entry.playerListIndex}`);
        }
        validateBuildLimitState(entry.buildLimitState);
        playerSlots.add(entry.playerListIndex);
        const weaponNames = new Set<string>();
        for (const weapon of entry.superWeapons) {
            if (!weapon || typeof weapon !== "object" || typeof weapon.name !== "string" || weapon.name.length === 0 ||
                !("state" in weapon)) {
                throw new Error("Invalid extension state snapshot: superweapon entry");
            }
            if (weaponNames.has(weapon.name)) {
                throw new Error(`Invalid extension state snapshot: duplicate superweapon ${weapon.name}`);
            }
            weaponNames.add(weapon.name);
        }
    }
    if (candidate.objectTechLevelState !== undefined) {
        normalizeObjectTechLevelOverrideState(candidate.objectTechLevelState);
    }
    parseObjectEntries(candidate.moveStates, "moveStates");
    parseObjectEntries(candidate.tntChargeStates, "tntChargeStates");
    parseObjectEntries(candidate.prismSupportStates, "prismSupportStates");
    parseObjectEntries(candidate.protectionStates, "protectionStates");
    parseObjectEntries(candidate.mindControlStates, "mindControlStates");
    parseObjectEntries(candidate.mindControllerStates, "mindControllerStates");
    if (candidate.laserFenceState !== undefined) {
        validateAresLaserFenceSnapshot(candidate.laserFenceState);
    }
    if (candidate.superWeaponEffectsState !== undefined) {
        validateAresSuperWeaponEffectState(candidate.superWeaponEffectsState);
    }
    if (candidate.countdownTimerState !== undefined) {
        new CountdownTimer().restoreState(candidate.countdownTimerState);
    }
    return candidate;
}

export function captureExtensionState(game: any): ExtensionStateSnapshot {
    const worldSuperWeapons = findWorldSuperWeaponsTrait(game);
    const superWeaponEffectsState =
        worldSuperWeapons?.captureAresState?.() ??
        worldSuperWeapons?.serializeAresState?.() ??
        worldSuperWeapons?.captureState?.();
    const objectTechLevelState = game?.rules?.captureObjectTechLevelOverrideState?.();
    const playerList = game?.playerList?.getAll?.() ?? [];
    const players: ExtensionStatePlayerEntry[] = playerList.map((player: any, index: number): ExtensionStatePlayerEntry => {
        if (player?.playerListIndex !== index) {
            throw new Error(`Cannot capture extension state: player slot ${index} is not canonical`);
        }
        return {
            playerListIndex: index,
            productionState: typeof player?.production?.captureState === "function"
                ? player.production.captureState()
                : undefined,
            ...(typeof player?.captureBuildLimitState === "function"
                ? { buildLimitState: player.captureBuildLimitState() }
                : {}),
            preferredTargetingCells: captureAresPreferredTargetingCells(player),
            superWeapons: collectSuperWeapons(player)
                .map((weapon: any) => ({
                    name: superWeaponKey(weapon),
                    state: weapon.serializeAresState(),
                }))
                .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
        };
    });
    const makeInfantryState = game?.aresMakeInfantryService?.captureState?.();
    const laserFenceState = game?.aresLaserFenceRuntime?.captureState?.();
    const countdownTimerState = game?.countdownTimer?.captureState?.();
    return {
        version: EXTENSION_STATE_SNAPSHOT_VERSION,
        animationDamageState: game?.aresAnimationDamageRuntime?.captureState?.(),
        ...(makeInfantryState !== undefined ? { makeInfantryState } : {}),
        ...(superWeaponEffectsState !== undefined ? { superWeaponEffectsState } : {}),
        triggerState: game?.triggers?.captureState?.(),
        ...(objectTechLevelState !== undefined ? { objectTechLevelState } : {}),
        ...(countdownTimerState !== undefined ? { countdownTimerState } : {}),
        players,
        attachEffects: captureObjectStates(game, findAttachEffectTrait, "serializeState"),
        moveStates: captureObjectStates(game, findMoveTrait, "captureState"),
        tntChargeStates: captureObjectStates(game, findTntChargeTrait, "captureState"),
        prismSupportStates: captureObjectStates(game, findPrismSupportTrait, "captureState"),
        protectionStates: captureObjectStates(game, findProtectionTrait, "captureState"),
        mindControlStates: captureObjectStates(game, findMindControllableTrait, "captureState"),
        mindControllerStates: captureObjectStates(game, findMindControllerTrait, "captureState"),
        ...(laserFenceState !== undefined ? { laserFenceState } : {}),
    };
}

function strictValidator(
    target: any,
    method: string,
    label: string,
    ...args: unknown[]
): void {
    const validator = target?.[method];
    if (typeof validator !== "function") {
        throw new Error(`Cannot restore extension state: ${label} strict validator is unavailable`);
    }
    try {
        validator.apply(target, args);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot restore extension state: ${label}: ${message}`);
    }
}

/**
 * Restores the extension-owned state captured by {@link captureExtensionState}.
 * Strict mode resolves every player, superweapon, production, attach-effect,
 * and animation-damage reference before applying any mutation.
 */
export function restoreExtensionState(
    game: any,
    snapshot: unknown,
    options: ExtensionStateRestoreOptions = {},
): void {
    const parsed = parseSnapshot(snapshot);
    const strict = options.strict === true;
    const playerList = game?.playerList?.getAll?.() ?? [];
    const productionContext: ProductionRestoreContext = {
        resolveObjectById: id => resolveObjectById(game, id),
        ...(options.productionContext ?? {}),
        strict,
    };
    const attachEffectContext: AresAttachEffectRestoreContext = {
        resolvePlayerByIndex: index => resolvePlayerByIndex(game, index),
        resolvePlayerByName: name => game?.getPlayerByName?.(name),
        resolveDefinition: (kind, ownerName) => resolveAttachEffectDefinition(game, kind, ownerName),
        ...(options.attachEffectContext ?? {}),
        strict,
    };
    const animationDamageContext: AresAnimationDamageRestoreContext = {
        resolveTile: (rx, ry) => game?.map?.tiles?.getByMapCoords?.(rx, ry),
        resolvePlayerByIndex: index => resolvePlayerByIndex(game, index),
        resolvePlayerByName: name => game?.getPlayerByName?.(name),
        resolveDefinition: name => resolveAnimationDefinition(game, name),
        ...(options.animationDamageContext ?? {}),
        strict,
    };
    const makeInfantryContext: AresMakeInfantryRestoreContext = {
        resolveTile: (rx, ry) => game?.map?.tiles?.getByMapCoords?.(rx, ry),
        resolvePlayerByIndex: index => resolvePlayerByIndex(game, index),
        resolvePlayerByName: name => game?.getPlayerByName?.(name),
        resolveObjectById: id => resolveObjectById(game, id),
        resolveAnimation: name => {
            try {
                const art = game?.art?.getAnimation?.(name);
                return art?.art ? parseMakeInfantryAnimation(name, art.art) : undefined;
            } catch {
                return undefined;
            }
        },
        resolveProduct: (index, name) => {
            try {
                const productName = name ?? game?.rules?.general?.animToInfantry?.[index];
                return productName ? game?.rules?.getObject?.(productName, ObjectType.Infantry) : undefined;
            } catch {
                return undefined;
            }
        },
        strict,
    };
    const effectWorld = options.superWeaponWorld ?? game;
    const effectContext: AresSuperWeaponEffectRestoreContext = {
        world: effectWorld,
        resolveTile: (rx, ry) => effectWorld?.map?.tiles?.getByMapCoords?.(rx, ry),
        resolveObjectById: id => resolveObjectById(effectWorld, id),
        resolvePlayerByIndex: index => resolvePlayerByIndex(effectWorld, index),
        resolveInfantryRules: name => {
            try {
                return effectWorld?.rules?.getObject?.(name, ObjectType.Infantry);
            }
            catch {
                return undefined;
            }
        },
        resolveSuperWeaponRule: (name, index) => {
            const rules = effectWorld?.rules?.superWeaponRules;
            const values = typeof rules?.values === "function" ? [...rules.values()] : [];
            return values.find((rule: any) =>
                name !== undefined && String(rule?.name ?? "") === name ||
                index !== undefined && rule?.index === index,
            );
        },
        ...(options.superWeaponEffectsContext ?? options.superWeaponEffectContext ?? {}),
        strict,
    };
    const tntChargeContext: TntChargeTraitRestoreContext = {
        resolvePlayerByIndex: index => resolvePlayerByIndex(game, index),
        resolveObjectById: id => resolveObjectById(game, id),
        ...(options.tntChargeContext ?? {}),
        strict,
    };
    const prismSupportContext: PrismSupportTraitRestoreContext = {
        resolveObjectById: id => resolveObjectById(game, id),
        ...(options.prismSupportContext ?? {}),
        strict,
    };
    const mindControlContext: MindControllableTraitRestoreContext = {
        resolveObjectById: id => resolveObjectById(game, id),
        resolvePlayerByIndex: index => resolvePlayerByIndex(game, index),
        resolvePlayerByName: name => game?.getPlayerByName?.(name),
        changeObjectOwner: (object, owner) => {
            if (typeof game?.changeObjectOwner === "function") {
                game.changeObjectOwner(object, owner);
            }
            else if (typeof game?.world?.changeObjectOwner === "function") {
                game.world.changeObjectOwner(object, owner);
            }
            else {
                object.owner = owner;
            }
        },
        ...(options.mindControlContext ?? {}),
        strict,
    };
    const mindControllerContext: MindControllerTraitRestoreContext = {
        resolveObjectById: id => resolveObjectById(game, id),
        ...(options.mindControllerContext ?? {}),
        strict,
    };
    const productionRestores: Array<{ production: any; state: unknown }> = [];
    const buildLimitRestores: Array<{ player: any; state: unknown }> = [];
    const preferredCellRestores: Array<{ player: any; state: AresPreferredTargetingCellsState | undefined }> = [];
    const superWeaponRestores: Array<{ weapon: any; state: unknown }> = [];
    const attachEffectRestores: Array<{ trait: any; state: unknown }> = [];
    const moveRestores: Array<{ trait: MoveTrait; state: unknown }> = [];
    const tntChargeRestores: Array<{ trait: TntChargeTrait; state: unknown }> = [];
    const prismSupportRestores: Array<{ trait: PrismSupportTrait; state: unknown }> = [];
    const protectionRestores: Array<{ trait: InvulnerableTrait; state: unknown }> = [];
    const mindControlRestores: Array<{ trait: MindControllableTrait; state: unknown }> = [];
    const mindControllerRestores: Array<{ trait: MindControllerTrait; state: unknown }> = [];
    const superWeaponEffectRestores: Array<{
        trait: any;
        plan: PreparedAresSuperWeaponEffectStateRestore;
    }> = [];
    const laserFenceState = parsed.laserFenceState;
    const laserFenceRuntime = game?.aresLaserFenceRuntime;
    const countdownTimer = game?.countdownTimer;
    const unresolved = (detail: string): void => {
        if (strict) throw new Error(`Cannot restore extension state: ${detail}`);
    };
    const superWeaponEffectsTrait = findWorldSuperWeaponsTrait(game);
    if (parsed.superWeaponEffectsState !== undefined) {
        if (!superWeaponEffectsTrait) {
            unresolved("superweapon effect trait is unresolved");
        }
        else if (typeof superWeaponEffectsTrait.prepareAresStateRestore !== "function") {
            unresolved("superweapon effect trait restore is unresolved");
        }
        else {
            try {
                superWeaponEffectRestores.push({
                    trait: superWeaponEffectsTrait,
                    plan: superWeaponEffectsTrait.prepareAresStateRestore(
                        parsed.superWeaponEffectsState,
                        effectContext,
                    ),
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                unresolved(`superweapon effect state: ${message}`);
            }
        }
    }
    for (const entry of parsed.players) {
        const player = playerList[entry.playerListIndex];
        if (!player) {
            unresolved(`player slot ${entry.playerListIndex} is unresolved`);
            continue;
        }
        if (strict && player.playerListIndex !== entry.playerListIndex) {
            unresolved(`player slot ${entry.playerListIndex} identity changed`);
            continue;
        }
        if (entry.productionState !== undefined) {
            if (typeof player.production?.restoreDeterministicState === "function") {
                productionRestores.push({ production: player.production, state: entry.productionState });
            }
            else {
                unresolved(`production state for player slot ${entry.playerListIndex} is unresolved`);
            }
        }
        if (entry.buildLimitState !== undefined) {
            if (typeof player.restoreBuildLimitState === "function") {
                buildLimitRestores.push({ player, state: entry.buildLimitState });
            }
            else {
                unresolved(`BuildLimit state for player slot ${entry.playerListIndex} is unresolved`);
            }
        }
        preferredCellRestores.push({
            player,
            state: validatePreferredTargetingCells(entry.preferredTargetingCells),
        });
        for (const weaponEntry of entry.superWeapons) {
            const weapon = collectSuperWeapons(player)
                .find((candidate: any) => superWeaponKey(candidate) === weaponEntry.name);
            if (!weapon) {
                unresolved(`superweapon ${weaponEntry.name} is unresolved`);
                continue;
            }
            superWeaponRestores.push({ weapon, state: weaponEntry.state });
        }
    }
    for (const entry of parseObjectEntries(parsed.attachEffects, "attachEffects")) {
        const object = findObject(game, entry.objectId);
        const trait = object && findAttachEffectTrait(object);
        if (!trait) {
            unresolved(`attach-effect object ${entry.objectId} is unresolved`);
            continue;
        }
        attachEffectRestores.push({ trait, state: entry.state });
    }
    for (const entry of parseObjectEntries(parsed.moveStates, "moveStates")) {
        const object = findObject(game, entry.objectId);
        const trait = object && findMoveTrait(object);
        if (!trait) {
            unresolved(`move-state object ${entry.objectId} is unresolved`);
            continue;
        }
        moveRestores.push({ trait, state: entry.state });
    }
    for (const entry of parseObjectEntries(parsed.tntChargeStates, "tntChargeStates")) {
        const object = findObject(game, entry.objectId);
        const trait = object && findTntChargeTrait(object);
        if (!trait) {
            unresolved(`tnt-charge object ${entry.objectId} is unresolved`);
            continue;
        }
        tntChargeRestores.push({ trait, state: entry.state });
    }
    for (const entry of parseObjectEntries(parsed.prismSupportStates, "prismSupportStates")) {
        const object = findObject(game, entry.objectId);
        const trait = object && findPrismSupportTrait(object);
        if (!trait) {
            unresolved(`prism-support object ${entry.objectId} is unresolved`);
            continue;
        }
        prismSupportRestores.push({ trait, state: entry.state });
    }
    for (const entry of parseObjectEntries(parsed.protectionStates, "protectionStates")) {
        const object = findObject(game, entry.objectId);
        const trait = object && findProtectionTrait(object);
        if (!trait) {
            unresolved(`protection object ${entry.objectId} is unresolved`);
            continue;
        }
        protectionRestores.push({ trait, state: entry.state });
    }
    for (const entry of parseObjectEntries(parsed.mindControlStates, "mindControlStates")) {
        const object = findObject(game, entry.objectId);
        const trait = object && findMindControllableTrait(object);
        if (!trait) {
            unresolved(`mind-control object ${entry.objectId} is unresolved`);
            continue;
        }
        mindControlRestores.push({ trait, state: entry.state });
    }
    for (const entry of parseObjectEntries(parsed.mindControllerStates, "mindControllerStates")) {
        const object = findObject(game, entry.objectId);
        const trait = object && findMindControllerTrait(object);
        if (!trait) {
            unresolved(`mind-controller object ${entry.objectId} is unresolved`);
            continue;
        }
        mindControllerRestores.push({ trait, state: entry.state });
    }
    if (parsed.animationDamageState !== undefined && typeof game?.aresAnimationDamageRuntime?.restoreState !== "function") {
        unresolved("animation damage runtime is unresolved");
    }
    if (parsed.makeInfantryState !== undefined && typeof game?.aresMakeInfantryService?.restoreState !== "function") {
        unresolved("make-infantry runtime is unresolved");
    }
    if (parsed.triggerState !== undefined && typeof game?.triggers?.restoreState !== "function") {
        unresolved("trigger manager is unresolved");
    }
    if (parsed.countdownTimerState !== undefined && typeof countdownTimer?.restoreState !== "function") {
        unresolved("countdown timer is unresolved");
    }
    if (laserFenceState !== undefined && typeof laserFenceRuntime?.restoreState !== "function") {
        unresolved("laser fence runtime is unresolved");
    }
    if (strict) {
        if (parsed.objectTechLevelState !== undefined) {
            strictValidator(
                game.rules,
                "validateObjectTechLevelOverrideState",
                "object tech level state",
                parsed.objectTechLevelState,
                true,
            );
        }
        for (const { player, state } of buildLimitRestores) {
            strictValidator(
                player,
                "validateBuildLimitState",
                "BuildLimit state",
                state,
            );
        }
        for (const { production, state } of productionRestores) {
            strictValidator(
                production,
                "validateDeterministicState",
                "production state",
                state,
                productionContext,
            );
        }
        for (const { weapon, state } of superWeaponRestores) {
            strictValidator(weapon, "validateAresState", "superweapon state", state);
        }
        for (const { trait, state } of attachEffectRestores) {
            strictValidator(
                trait,
                "validateState",
                "attach-effect state",
                state,
                attachEffectContext,
            );
        }
        for (const { trait, state } of moveRestores) {
            strictValidator(trait, "validateState", "move state", state, { strict: true });
        }
        for (const { trait, state } of tntChargeRestores) {
            strictValidator(
                trait,
                "validateState",
                "tnt charge state",
                state,
                tntChargeContext,
            );
        }
        for (const { trait, state } of prismSupportRestores) {
            strictValidator(
                trait,
                "validateState",
                "prism support state",
                state,
                prismSupportContext,
            );
        }
        for (const { trait, state } of protectionRestores) {
            strictValidator(trait, "validateState", "protection state", state);
        }
        for (const { trait, state } of mindControlRestores) {
            strictValidator(
                trait,
                "validateState",
                "mind-control state",
                state,
                mindControlContext,
            );
        }
        for (const { trait, state } of mindControllerRestores) {
            strictValidator(
                trait,
                "validateState",
                "mind-controller state",
                state,
                mindControllerContext,
            );
        }
        if (laserFenceState !== undefined) {
            strictValidator(
                laserFenceRuntime,
                "validateState",
                "laser fence state",
                laserFenceState,
                true,
            );
        }
        if (parsed.animationDamageState !== undefined) {
            strictValidator(
                game.aresAnimationDamageRuntime,
                "validateState",
                "animation damage state",
                parsed.animationDamageState,
                animationDamageContext,
            );
        }
        if (parsed.makeInfantryState !== undefined) {
            strictValidator(
                game.aresMakeInfantryService,
                "validateState",
                "make-infantry state",
                parsed.makeInfantryState,
                makeInfantryContext,
            );
        }
        if (parsed.triggerState !== undefined) {
            strictValidator(
                game.triggers,
                "validateState",
                "trigger state",
                parsed.triggerState,
                { strict: true },
            );
        }
    }
    if (laserFenceState !== undefined) {
        laserFenceRuntime?.restoreState?.(laserFenceState, strict);
    }
    if (parsed.animationDamageState !== undefined) {
        game.aresAnimationDamageRuntime?.restoreState?.(parsed.animationDamageState, animationDamageContext);
    }
    if (parsed.makeInfantryState !== undefined) {
        game.aresMakeInfantryService?.restoreState?.(parsed.makeInfantryState, makeInfantryContext);
    }
    if (parsed.triggerState !== undefined) {
        game.triggers?.restoreState?.(parsed.triggerState, { strict });
    }
    if (parsed.objectTechLevelState !== undefined) {
        game.rules?.restoreObjectTechLevelOverrideState?.(parsed.objectTechLevelState, strict);
    }
    if (parsed.countdownTimerState !== undefined) {
        countdownTimer?.restoreState?.(parsed.countdownTimerState);
    }
    for (const { production, state } of productionRestores) {
        production.restoreDeterministicState(state, productionContext);
    }
    for (const { player, state } of buildLimitRestores) {
        player.restoreBuildLimitState(state);
    }
    for (const { player, state } of preferredCellRestores) {
        restoreAresPreferredTargetingCells(player, state);
    }
    for (const { weapon, state } of superWeaponRestores) {
        weapon.restoreAresState(state, options.superWeaponWorld);
    }
    for (const { trait, state } of attachEffectRestores) {
        trait.restoreState(state, attachEffectContext);
    }
    for (const { trait, state } of moveRestores) {
        trait.restoreState(state, { strict });
    }
    for (const { trait, state } of tntChargeRestores) {
        trait.restoreState(state, tntChargeContext);
    }
    for (const { trait, state } of prismSupportRestores) {
        trait.restoreState(state, prismSupportContext);
    }
    for (const { trait, state } of protectionRestores) {
        trait.restoreState(state);
    }
    for (const { trait, state } of mindControlRestores) {
        trait.restoreState(state, mindControlContext);
    }
    for (const { trait, state } of mindControllerRestores) {
        trait.restoreState(state, mindControllerContext);
    }
    for (const { trait, plan } of superWeaponEffectRestores) {
        trait.commitAresStateRestore(plan);
    }
}
