import {
    AresIfvModeRules,
    AresPoweredByRules,
    DEFAULT_ARES_IFV_MODE,
    DEFAULT_ARES_WEAPON_TURRET_INDEX,
    getAresWeaponTurretIndex,
} from "@/extensions/ares/AresTechnoExtensions";

/**
 * Runtime decision inputs intentionally use structural probes.  This keeps
 * the adapter independent from Techno, Vehicle, Building, and their traits;
 * integration can pass those objects later without making this module own
 * lifecycle or state changes.
 */
export interface AresIfvPassengerLike {
    ifvMode?: number;
    rules?: { ifvMode?: number };
}

export interface AresIfvDecision {
    mode: number;
    weaponNumber: number;
    turretIndex: number;
    uiName?: string;
}

export interface AresPoweredByProviderLike {
    typeId?: string;
    name?: string;
    rules?: { id?: string; name?: string };
    isWarpedOut?: boolean | (() => boolean);
    underEMP?: boolean | (() => boolean);
    operated?: boolean | (() => boolean);
    powerOnline?: boolean | (() => boolean);
    warpedOutTrait?: { isActive?: () => boolean };
    empTrait?: { isUnderEMP?: () => boolean };
    operatorTrait?: { isOffline?: () => boolean };
    poweredTrait?: { isPoweredOn?: () => boolean };
}

export interface AresPoweredByDecision {
    powered: boolean;
    matchingProviderCount: number;
    onlineProvider?: AresPoweredByProviderLike;
}

type BooleanProbe = boolean | (() => boolean) | undefined;

function normalizeId(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function finiteMode(value: unknown): number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : DEFAULT_ARES_IFV_MODE;
}

function readBoolean(value: BooleanProbe): boolean | undefined {
    if (typeof value === "function") return value();
    return value;
}

function passengerMode(passenger: AresIfvPassengerLike | undefined): number {
    return finiteMode(passenger?.ifvMode ?? passenger?.rules?.ifvMode);
}

/**
 * Resolves the weapon/turret decision for an IFV and its first passenger.
 * Ares uses the first passenger only; WeaponX is 1-based while IFVMode is
 * 0-based, so IFVMode=4 selects Weapon5.
 */
export function resolveAresIfvDecision(
    hostRules: AresIfvModeRules,
    passengers: readonly AresIfvPassengerLike[] = [],
): AresIfvDecision | undefined {
    const passenger = passengers[0];
    if (!passenger) return undefined;

    const mode = passengerMode(passenger);
    const weaponNumber = mode + 1;
    const uiName = hostRules.weaponUiNames.get(weaponNumber);
    return {
        mode,
        weaponNumber,
        turretIndex: getAresWeaponTurretIndex(hostRules, weaponNumber),
        ...(uiName === undefined ? {} : { uiName }),
    };
}

/** Returns the authored provider/building ID used for case-insensitive matching. */
export function getAresPoweredByProviderId(provider: AresPoweredByProviderLike): string {
    return [provider.typeId, provider.rules?.id, provider.rules?.name, provider.name]
        .find(value => typeof value === "string" && value.trim().length > 0) ?? "";
}

export function matchesAresPoweredByProvider(
    rules: AresPoweredByRules,
    provider: AresPoweredByProviderLike,
): boolean {
    const providerId = normalizeId(getAresPoweredByProviderId(provider));
    if (!providerId) return false;
    return rules.providers.some(expected => normalizeId(expected) === providerId);
}

function isWarpedOut(provider: AresPoweredByProviderLike): boolean {
    return readBoolean(provider.isWarpedOut) ??
        readBoolean(provider.warpedOutTrait?.isActive
            ? () => provider.warpedOutTrait!.isActive!()
            : undefined) ?? false;
}

function isUnderEmp(provider: AresPoweredByProviderLike): boolean {
    return readBoolean(provider.underEMP) ??
        readBoolean(provider.empTrait?.isUnderEMP
            ? () => provider.empTrait!.isUnderEMP!()
            : undefined) ?? false;
}

function isOperated(provider: AresPoweredByProviderLike): boolean {
    const explicit = readBoolean(provider.operated);
    if (explicit !== undefined) return explicit;
    const operatorOffline = readBoolean(provider.operatorTrait?.isOffline
        ? () => provider.operatorTrait!.isOffline!()
        : undefined);
    return operatorOffline === undefined ? true : !operatorOffline;
}

function isPowerOnline(provider: AresPoweredByProviderLike): boolean {
    return readBoolean(provider.powerOnline) ??
        readBoolean(provider.poweredTrait?.isPoweredOn
            ? () => provider.poweredTrait!.isPoweredOn!()
            : undefined) ?? false;
}

/**
 * Applies Antares' provider eligibility gates without mutating provider or
 * player state. Missing power state is offline by default; missing operator
 * state is operated, matching objects with no operator restriction.
 */
export function isAresPoweredByProviderOnline(provider: AresPoweredByProviderLike): boolean {
    return !isWarpedOut(provider) &&
        !isUnderEmp(provider) &&
        isOperated(provider) &&
        isPowerOnline(provider);
}

/**
 * Resolves the current PoweredBy state from the owner's provider collection.
 * The fixed Ares relation is OR: one matching online provider is sufficient.
 */
export function resolveAresPoweredByDecision(
    rules: AresPoweredByRules,
    providers: readonly AresPoweredByProviderLike[] = [],
): AresPoweredByDecision {
    const matchingProviders = providers.filter(provider => matchesAresPoweredByProvider(rules, provider));
    const onlineProvider = matchingProviders.find(isAresPoweredByProviderOnline);
    return {
        powered: onlineProvider !== undefined,
        matchingProviderCount: matchingProviders.length,
        ...(onlineProvider === undefined ? {} : { onlineProvider }),
    };
}

export function isAresPoweredBySatisfied(
    rules: AresPoweredByRules,
    providers: readonly AresPoweredByProviderLike[] = [],
): boolean {
    return resolveAresPoweredByDecision(rules, providers).powered;
}

export { DEFAULT_ARES_WEAPON_TURRET_INDEX };
