import { fnv32aStrings } from "@/util/math";

/**
 * The owner selectors accepted by Antares' KillDriver.Owner extension.  The
 * public Ares documentation only requires KillDriver/ProtectedDriver/CanDrive;
 * the additional selectors are kept here because Antares 3.0p1 exposes them
 * and they are useful to rules authored for that runtime.
 */
export type AresKillDriverOwner =
    | "default"
    | "invoker"
    | "killer"
    | "victim"
    | "civilian"
    | "special"
    | "neutral"
    | "random";

export interface AresKillingDriverRules {
    killDriver?: boolean;
    killDriverBelowPercent?: number;
    killDriverChance?: number;
    killDriverOwner?: string;
    killDriverRemoveVeterancy?: boolean;
    protectedDriver?: boolean;
    protectedDriverMinHealth?: number;
    canDrive?: boolean;
}

export interface AresDriverTarget {
    rules?: any;
    owner?: any;
    healthTrait?: { health?: number };
    isVehicle?(): boolean;
    isAircraft?(): boolean;
    isDestroyed?: boolean;
    isCrashing?: boolean;
    isSpawned?: boolean;
    limboData?: any;
    warpedOutTrait?: { isActive?(): boolean };
    aresDriverTrait?: AresDriverTrait;
    transportTrait?: { units: any[] };
    unitOrderTrait?: { getTasks?(): any[] };
    moveTrait?: { setDisabled?(disabled: boolean): void };
    attackTrait?: { setDisabled?(disabled: boolean): void };
    mindControllableTrait?: {
        getController?(): any;
        makePermanent?(): void;
    };
    position?: any;
    tile?: any;
    zone?: any;
    onBridge?: boolean;
    veteranTrait?: any;
    [key: string]: any;
}

export interface AresKillingDriverGame {
    changeObjectOwner?(object: any, owner: any): void;
    getCivilianPlayer?(): any;
    getAllPlayers?(): any[];
    areAllied?(player1: any, player2: any): boolean;
    generateRandom?(): number;
    generateRandomInt?(min: number, max: number): number;
    destroyObject?(object: any, source?: any, silent?: boolean): void;
    unlimboObject?(object: any, tile: any, skipSelection?: boolean): void;
}

function normalize(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function fraction(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    // IniSection already converts values such as 50% to 0.5.  Accepting a
    // bare 50 as 0.5 is useful for hand-authored Ares rules and is harmless
    // for the documented 0.0..1.0 form.
    const normalized = value > 1 ? value / 100 : value;
    return Math.max(0, Math.min(1, normalized));
}

function countryValues(player: any): string[] {
    const country = player?.country;
    return [
        country?.id,
        country?.name,
        country?.sideId,
        country?.rules?.id,
        country?.rules?.name,
        country?.rules?.sideId,
    ].filter((value): value is string => typeof value === "string").map(normalize);
}

function allPlayers(game: AresKillingDriverGame): any[] {
    return game.getAllPlayers?.() ?? [];
}

/**
 * Antares' IsDriverKillable predicate translated to the standalone object
 * model.  The checks deliberately operate on capabilities/flags rather than
 * on concrete unit names.
 */
export function isAresDriverKillable(
    target: AresDriverTarget,
    rules: AresKillingDriverRules = target.rules ?? {},
): boolean {
    if (!target || (!target.isVehicle?.() && !target.isAircraft?.())) return false;
    if (target.isDestroyed || target.isCrashing || target.limboData) return false;
    if (target.isSpawned === false) return false;

    // Antares does not kill pilots of aircraft that are expected to dock;
    // doing so would leave the airport slot occupied while the game believes
    // the aircraft was lost.
    if (target.isAircraft?.() &&
        (target.rules?.airportBound === true || (target.rules?.dock?.length ?? 0) > 0)) {
        return false;
    }
    if (target.warpedOutTrait?.isActive?.()) return false;
    if (target.rules?.natural || target.rules?.organic) return false;
    if (target.rules?.inWarFactory || target.inWarFactory) return false;

    const health = target.healthTrait?.health;
    if (typeof health !== "number") return false;
    const defaultLimit = rules.protectedDriver ? 0 : 1;
    const protectedLimit = fraction(rules.protectedDriverMinHealth, defaultLimit);
    const killLimit = fraction(rules.killDriverBelowPercent, 1);
    return health / 100 <= Math.min(protectedLimit, killLimit) + Number.EPSILON;
}

/** A vehicle/aircraft state trait corresponding to Antares' DriverKilled. */
export class AresDriverTrait {
    private driverKilled = false;

    isDriverKilled(): boolean {
        return this.driverKilled;
    }

    markDriverKilled(): void {
        this.driverKilled = true;
    }

    clearDriverKilled(): void {
        this.driverKilled = false;
    }

    getHash(): number {
        return fnv32aStrings(["AresDriverTrait", this.driverKilled ? 1 : 0]);
    }

    debugGetState(): { driverKilled: boolean } {
        return { driverKilled: this.driverKilled };
    }
}

function driverTrait(target: AresDriverTarget): AresDriverTrait {
    if (!target.aresDriverTrait) {
        target.aresDriverTrait = new AresDriverTrait();
        target.traits?.add?.(target.aresDriverTrait);
    }
    return target.aresDriverTrait;
}

function passengerName(passenger: any): string {
    return normalize(passenger?.name ?? passenger?.rules?.name);
}

function operatorPassengers(target: AresDriverTarget): any[] {
    const passengers = target.transportTrait?.units ?? [];
    const rules = target.rules ?? {};
    if (!passengers.length) return [];

    if (rules.operatorAny) return [...passengers];
    const required = new Set((rules.operator ?? []).map((value: unknown) => normalize(value)).filter(Boolean));
    if (!required.size) return [];
    const driver = passengers.find((passenger) => required.has(passengerName(passenger)));
    return driver ? [driver] : [];
}

function removePassenger(target: AresDriverTarget, passenger: any): void {
    const units = target.transportTrait?.units;
    if (!units) return;
    const index = units.indexOf(passenger);
    if (index !== -1) units.splice(index, 1);
}

function destroyPassenger(target: AresDriverTarget, passenger: any, source: any, game: AresKillingDriverGame): void {
    removePassenger(target, passenger);
    if (passenger.isDestroyed) return;
    game.destroyObject?.(passenger, source ? { player: source.owner, obj: source } : undefined, true);
    if (!game.destroyObject) {
        passenger.isDestroyed = true;
        passenger.limboData = undefined;
    }
}

function ejectPassenger(target: AresDriverTarget, passenger: any, game: AresKillingDriverGame): void {
    removePassenger(target, passenger);
    const tile = target.tile ?? target.position?.tile;
    if (tile) {
        passenger.position ??= {};
        passenger.position.tile = tile;
        passenger.position.tileElevation = target.position?.tileElevation ?? 0;
        passenger.zone = target.zone;
        passenger.onBridge = target.onBridge;
    }
    if (passenger.limboData && tile && game.unlimboObject) {
        game.unlimboObject(passenger, tile, true);
    }
    else if (passenger.limboData) {
        passenger.limboData = undefined;
    }
}

function clearMindControl(target: AresDriverTarget): void {
    const controller = target.mindControllableTrait?.getController?.();
    controller?.mindControllerTrait?.cleanTarget?.(target);
    target.mindControllableTrait?.makePermanent?.();
}

function disableDriverlessTarget(target: AresDriverTarget): void {
    target.unitOrderTrait?.getTasks?.().forEach((task: any) => task.cancel?.());
    target.moveTrait?.setDisabled?.(true);
    target.attackTrait?.setDisabled?.(true);
}

/**
 * Resolve Antares' KillDriver.Owner without introducing a global HouseClass
 * singleton.  The current host exposes a civilian player as its special
 * neutral owner; explicit owner selectors remain data-driven for future
 * multi-neutral profiles.
 */
export function resolveAresKillDriverOwner(
    mode: string | undefined,
    source: any,
    target: AresDriverTarget,
    game: AresKillingDriverGame,
): any {
    const normalized = normalize(mode || "special") as AresKillDriverOwner;
    const players = allPlayers(game);
    switch (normalized) {
        case "invoker":
        case "killer":
            return source?.owner ?? target.owner;
        case "victim":
            return target.owner;
        case "civilian":
            return players.find((player) => countryValues(player).includes("civilian")) ??
                game.getCivilianPlayer?.() ?? target.owner;
        case "neutral":
            return players.find((player) => countryValues(player).includes("neutral")) ??
                game.getCivilianPlayer?.() ?? target.owner;
        case "random": {
            if (!players.length) return target.owner;
            const index = game.generateRandomInt
                ? game.generateRandomInt(0, players.length - 1)
                : Math.floor((game.generateRandom?.() ?? 0) * players.length);
            return players[Math.max(0, Math.min(players.length - 1, index))];
        }
        case "default":
        case "special":
        default:
            return game.getCivilianPlayer?.() ??
                players.find((player) => countryValues(player).includes("special")) ??
                target.owner;
    }
}

function affectsTarget(target: AresDriverTarget, source: any, game: AresKillingDriverGame, rules: any): boolean {
    const sourcePlayer = source?.owner;
    if (!sourcePlayer) return false;
    const friendly = sourcePlayer === target.owner ||
        game.areAllied?.(sourcePlayer, target.owner) === true;
    if (friendly && rules.affectsAllies === false) return false;
    if (!friendly && rules.affectsEnemies === false) return false;
    return true;
}

/**
 * Apply the complete documented KillDriver effect and the Antares 3.0p1
 * owner/chance/health extensions.  The ordinary Warhead caller invokes this
 * before health damage, matching the public wording that the driver is killed
 * instead of the vehicle being damaged.  A protected or otherwise ineligible
 * target falls through to ordinary warhead damage, matching the safe failure
 * behavior of the original game.
 */
export function applyAresKillDriver(
    target: AresDriverTarget,
    source: any,
    game: AresKillingDriverGame,
    rules: AresKillingDriverRules & { affectsAllies?: boolean; affectsEnemies?: boolean },
): boolean {
    if (!rules.killDriver || !source || !affectsTarget(target, source, game, rules)) return false;
    const state = driverTrait(target);
    if (state.isDriverKilled() || !isAresDriverKillable(target, { ...target.rules, ...rules })) return false;

    const chance = fraction(rules.killDriverChance, 1);
    if (chance < 1 && (game.generateRandom?.() ?? 0) >= chance) return false;

    const newOwner = resolveAresKillDriverOwner(rules.killDriverOwner, source, target, game);
    if (!newOwner || newOwner === target.owner) return false;

    clearMindControl(target);
    for (const passenger of operatorPassengers(target)) {
        destroyPassenger(target, passenger, source, game);
    }
    for (const passenger of [...(target.transportTrait?.units ?? [])]) {
        ejectPassenger(target, passenger, game);
    }

    game.changeObjectOwner?.(target, newOwner);
    if (!game.changeObjectOwner) target.owner = newOwner;
    state.markDriverKilled();
    disableDriverlessTarget(target);
    return true;
}

/** Whether a data-defined infantry can reclaim a driverless vehicle. */
export function canAresDriverReclaim(driver: any, target: AresDriverTarget): boolean {
    return driver?.isInfantry?.() === true &&
        driver?.rules?.canDrive === true &&
        (target.isVehicle?.() === true || target.isAircraft?.() === true) &&
        target.aresDriverTrait?.isDriverKilled?.() === true;
}
