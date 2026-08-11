import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { AresDriverTrait, canAresDriverReclaim } from "./AresKillingDrivers";
import { fnv32aStrings } from "@/util/math";

/** The two actions exposed by Antares' shared vehicle-hijack path. */
export type AresVehicleHijackAction = "none" | "drive" | "hijack";

export interface AresVehicleThiefRules {
    vehicleThief?: boolean;
    canDrive?: boolean;
    canBeDriven?: boolean;
    hijackerAllowed?: boolean;
    hijackerBreakMindControl?: boolean;
    hijackerOneTime?: boolean;
    hijackerKillPilots?: number;
    hijackerEnterSound?: string;
    hijackerLeaveSound?: string;
    operator?: string[];
    operatorAny?: boolean;
}

export interface AresVehicleHijackGame {
    areAllied?(player1: any, player2: any): boolean;
    changeObjectOwner?(object: any, owner: any): void;
    limboObject?(object: any, data: any): void;
    unlimboObject?(object: any, tile: any, skipSelection?: boolean): void;
    destroyObject?(object: any, source?: any, silent?: boolean): void;
    getUnitSelection?(): any;
    playSoundAt?(sound: string, tile: any): void;
    map?: any;
}

export interface AresVehicleHijackTarget {
    owner?: any;
    rules?: AresVehicleThiefRules & Record<string, any>;
    aresDriverTrait?: AresDriverTrait;
    aresVehicleHijackerTrait?: AresVehicleHijackerTrait;
    transportTrait?: { units: any[] };
    mindControllableTrait?: {
        isActive?(): boolean;
        getController?(): any;
        getOriginalOwner?(): any;
        makePermanent?(): void;
        restore?(game: any): void;
    };
    warpedOutTrait?: { isActive?(): boolean };
    isVehicle?(): boolean;
    isAircraft?(): boolean;
    isInfantry?(): boolean;
    isDestroyed?: boolean;
    isCrashing?: boolean;
    isSpawned?: boolean;
    limboData?: any;
    zone?: ZoneType;
    bunkerLinkedItem?: any;
    tile?: any;
    position?: any;
    [key: string]: any;
}

function normalized(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function isNeutral(owner: any): boolean {
    return owner?.isNeutral === true || owner?.multiplayPassive === true || owner?.rules?.multiplayPassive === true;
}

function isMindControlled(target: AresVehicleHijackTarget): boolean {
    return target.mindControllableTrait?.isActive?.() === true ||
        target.mindControlledBy != null ||
        target.mindControlledByHouse != null;
}

function isTargetOnFloor(target: AresVehicleHijackTarget): boolean {
    return target.zone === undefined || target.zone !== ZoneType.Air;
}

function isDriverless(target: AresVehicleHijackTarget): boolean {
    return target.aresDriverTrait?.isDriverKilled?.() === true;
}

function isFriendly(game: AresVehicleHijackGame, driver: AresVehicleHijackTarget, target: AresVehicleHijackTarget): boolean {
    return driver.owner === target.owner ||
        game.areAllied?.(driver.owner, target.owner) === true;
}

function canUseAsPassenger(target: AresVehicleHijackTarget): boolean {
    return !!target.transportTrait &&
        (target.rules?.operatorAny === true || (target.rules?.operator?.length ?? 0) > 0);
}

/**
 * Antares' GetActionHijack translated to the standalone object model.
 *
 * The original hook checks a mix of vanilla state and extension fields.  The
 * standalone equivalent deliberately asks for capabilities on the normalized
 * objects instead of reproducing the hook boundary.  In particular, a
 * CanDrive-only infantry does not steal an arbitrary neutral vehicle: it
 * reclaims a vehicle whose driver was removed by KillDriver.
 */
export function getAresVehicleHijackAction(
    driver: AresVehicleHijackTarget,
    target: AresVehicleHijackTarget,
    game: AresVehicleHijackGame,
): AresVehicleHijackAction {
    if (!driver?.isInfantry?.() || !target ||
        (!target.isVehicle?.() && !target.isAircraft?.()) ||
        driver.isDestroyed || driver.isCrashing || driver.isSpawned === false || driver.limboData ||
        target.isDestroyed || target.isCrashing || target.isSpawned === false || target.limboData ||
        target.warpedOutTrait?.isActive?.() || target.bunkerLinkedItem || !isTargetOnFloor(target)) {
        return "none";
    }

    // Ares rejects trains and balloon-hover objects from the hijack path.
    if (target.rules?.train || target.rules?.balloonHover) return "none";
    if (driver.deployerTrait?.isDeployed?.()) return "none";

    const driverRules = (driver.rules ?? {}) as AresVehicleThiefRules;
    const targetRules = (target.rules ?? {}) as AresVehicleThiefRules;
    const vehicleThief = driverRules.vehicleThief === true;
    const canDrive = driverRules.canDrive === true;
    if (!vehicleThief && !canDrive) return "none";

    if (vehicleThief && isMindControlled(target) && driverRules.hijackerBreakMindControl === false) {
        return "none";
    }

    // CanDrive is the generic driver/reclaim capability.  It is intentionally
    // limited to the neutral, driverless object produced by KillDriver.
    if (canDrive && canAresDriverReclaim(driver, target)) {
        return "drive";
    }

    // VehicleThief is an enemy-only action.  Allied and passive-neutral
    // objects are not stolen through this path.
    if (!vehicleThief || isFriendly(game, driver, target) || isNeutral(target.owner)) {
        return "none";
    }
    if (targetRules.hijackerAllowed === false) return "none";

    return "hijack";
}

/** Stores an absorbed hijacker so it can be recovered when the stolen vehicle dies. */
export class AresVehicleHijackerTrait implements NotifyDestroy {
    private hijacker?: any;
    private hijackerHealth = -1;
    private hijackerVeterancy = 0;
    private oneTime = false;
    private killPilots = 0;
    private leaveSound?: string;

    remember(hijacker: any, rules: AresVehicleThiefRules): void {
        this.hijacker = hijacker;
        this.hijackerHealth = hijacker?.healthTrait?.health ?? -1;
        this.hijackerVeterancy = hijacker?.veteranLevel ?? hijacker?.veteranTrait?.veteranLevel ?? 0;
        this.oneTime = rules.hijackerOneTime === true;
        this.killPilots = rules.hijackerKillPilots ?? 0;
        this.leaveSound = rules.hijackerLeaveSound;
    }

    hasHijacker(): boolean {
        return !!this.hijacker;
    }

    getKillPilots(): number {
        return this.killPilots;
    }

    /** Applies Antares' pilot-count adjustment before normal crew survivors. */
    adjustSurvivorPilotCount(count: number): number {
        return this.killPilots < 0
            ? 0
            : Math.max(0, count - this.killPilots);
    }

    clear(): void {
        this.hijacker = undefined;
        this.hijackerHealth = -1;
        this.hijackerVeterancy = 0;
        this.oneTime = false;
        this.killPilots = 0;
        this.leaveSound = undefined;
    }

    getHash(): number {
        return fnv32aStrings([
            "AresVehicleHijackerTrait",
            this.hijacker?.id ?? -1,
            this.oneTime ? 1 : 0,
            this.hijackerHealth,
            this.hijackerVeterancy,
            this.killPilots,
        ]);
    }

    debugGetState(): any {
        return {
            hijackerId: this.hijacker?.id,
            oneTime: this.oneTime,
            hijackerHealth: this.hijackerHealth,
            hijackerVeterancy: this.hijackerVeterancy,
            killPilots: this.killPilots,
            leaveSound: this.leaveSound,
        };
    }

    /** Reimburse a stored hijacker when its stolen vehicle enters a grinder. */
    reimburseOnRecycle(grinder: any, game: any): number {
        const hijacker = this.hijacker;
        const grinderOwner = grinder?.owner;
        if (!hijacker || !grinderOwner) return 0;

        const refund = game.sellTrait?.computeRefundValue?.(hijacker) ??
            Math.max(0, hijacker.purchaseValue ?? hijacker.rules?.cost ?? 0);
        if (refund > 0) grinderOwner.credits += refund;
        if (!hijacker.isDestroyed) {
            if (game.destroyObject) {
                game.destroyObject(hijacker, undefined, true);
            }
            else {
                hijacker.isDestroyed = true;
                hijacker.isSpawned = false;
                hijacker.limboData = undefined;
                hijacker.owner?.removeOwnedObject?.(hijacker);
            }
        }
        this.clear();
        return refund;
    }

    [NotifyDestroy.onDestroy](vehicle: AresVehicleHijackTarget, game: any): void {
        const hijacker = this.hijacker;
        const health = this.hijackerHealth;
        const veterancy = this.hijackerVeterancy;
        const oneTime = this.oneTime;
        const leaveSound = this.leaveSound;
        this.clear();
        if (!hijacker || oneTime || hijacker.isDestroyed || hijacker.owner?.isDefeated) return;

        // Antares recreates the hijacker at half of the saved health (with a
        // minimum of 10) when the stolen vehicle is destroyed.  Our engine
        // retains the original infantry object in limbo, so no object-ID or
        // type lookup is needed and the save/hash identity remains stable.
        if (hijacker.healthTrait && health >= 0) {
            // Antares stores this in the integer Health field; preserve its
            // truncating division rather than creating fractional hit points.
            hijacker.healthTrait.health = Math.floor(Math.max(health, 10) / 2);
        }
        if (hijacker.veteranTrait && Number.isFinite(veterancy)) {
            (hijacker.veteranTrait as any).veteranLevel = veterancy;
        }
        const tile = vehicle.tile ?? vehicle.position?.tile;
        if (tile && hijacker.limboData && game.unlimboObject) {
            game.unlimboObject(hijacker, tile, true);
            if (leaveSound) game.playSoundAt?.(leaveSound, tile);
        }
        else if (tile) {
            hijacker.position ??= {};
            hijacker.position.tile = tile;
            hijacker.isSpawned = true;
            if (leaveSound) game.playSoundAt?.(leaveSound, tile);
        }
        else {
            game.destroyObject?.(hijacker, undefined, true);
        }
    }

    dispose(): void {
        this.clear();
    }
}

function getHijackerTrait(target: AresVehicleHijackTarget): AresVehicleHijackerTrait {
    if (!target.aresVehicleHijackerTrait) {
        target.aresVehicleHijackerTrait = new AresVehicleHijackerTrait();
        if (target.addTrait) target.addTrait(target.aresVehicleHijackerTrait);
        else target.traits?.add?.(target.aresVehicleHijackerTrait);
    }
    return target.aresVehicleHijackerTrait;
}

function limboDriver(driver: AresVehicleHijackTarget, game: AresVehicleHijackGame): void {
    const selectionModel = game.getUnitSelection?.()?.getOrCreateSelectionModel?.(driver);
    game.limboObject?.(driver, {
        selected: false,
        controlGroup: selectionModel?.getControlGroupNumber?.(),
        inTransport: true,
    });
    if (!game.limboObject) {
        driver.limboData = { selected: false, inTransport: true };
        driver.isSpawned = false;
    }
}

function consumeDriver(driver: AresVehicleHijackTarget, game: AresVehicleHijackGame): void {
    if (game.destroyObject) {
        game.destroyObject(driver, undefined, true);
    }
    else {
        driver.isDestroyed = true;
        driver.isSpawned = false;
    }
}

interface ReleasedMindControl {
    controller?: any;
    originalOwner?: any;
}

function releaseMindControl(target: AresVehicleHijackTarget, game: AresVehicleHijackGame): ReleasedMindControl {
    const controllable = target.mindControllableTrait;
    const controller = controllable?.getController?.();
    const originalOwner = controllable?.getOriginalOwner?.();
    controller?.mindControllerTrait?.cleanTarget?.(target);
    if (controllable?.isActive?.() && controllable.restore) {
        controllable.restore(game as any);
    }
    else {
        controllable?.makePermanent?.();
    }
    target.mindControlledBy = undefined;
    target.mindControlledByHouse = undefined;
    return { controller, originalOwner };
}

function transferMindControl(controller: any, target: AresVehicleHijackTarget, game: AresVehicleHijackGame): void {
    if (!controller?.mindControllerTrait?.control ||
        !target.mindControllableTrait ||
        target.rules?.immuneToPsionics === true) {
        return;
    }
    controller.mindControllerTrait.control(target, game as any);
}

/**
 * Performs the data-defined Drive/Hijack action after the infantry reaches
 * the target.  Returns false when the target became invalid in the meantime.
 */
export function applyAresVehicleHijack(
    driver: AresVehicleHijackTarget,
    target: AresVehicleHijackTarget,
    game: AresVehicleHijackGame,
): boolean {
    const action = getAresVehicleHijackAction(driver, target, game);
    if (action === "none") return false;

    const driverRules = (driver.rules ?? {}) as AresVehicleThiefRules;
    const oldOwner = target.owner;
    releaseMindControl(target, game);
    const driverControl = releaseMindControl(driver, game);
    const captureOwner = driverControl.originalOwner ?? driver.owner;

    const asPassenger = action === "drive" && canUseAsPassenger(target);
    if (asPassenger) {
        limboDriver(driver, game);
    }
    else if (action === "hijack") {
        limboDriver(driver, game);
        getHijackerTrait(target).remember(driver, driverRules);
    }
    else {
        consumeDriver(driver, game);
    }

    if (game.changeObjectOwner) game.changeObjectOwner(target, captureOwner);
    else target.owner = captureOwner;

    target.aresDriverTrait?.clearDriverKilled?.();
    target.unitOrderTrait?.clearOrders?.();
    target.unitOrderTrait?.cancelAllTasks?.();
    target.moveTrait?.setDisabled?.(false);
    target.attackTrait?.setDisabled?.(false);

    if (asPassenger) {
        target.transportTrait?.units.push(driver);
    }

    // A mind-controlled hijacker transfers its controller link to the
    // captured vehicle. If the vehicle is psionics-immune, the controller
    // loses both links, matching Ares' fallback behavior.
    if (driverControl.controller) {
        transferMindControl(driverControl.controller, target, game);
    }

    const enterSound = driverRules.hijackerEnterSound;
    if (enterSound && target.tile) game.playSoundAt?.(enterSound, target.tile);

    // `oldOwner` is intentionally read before the transfer: it is useful to
    // debugger consumers and prevents a future event implementation from
    // accidentally reporting the new owner as both sides.
    target.aresLastHijack = { action, oldOwner, newOwner: captureOwner };
    return true;
}
