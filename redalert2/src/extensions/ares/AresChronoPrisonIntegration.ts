import {
    decideAresChronoPrison,
    type AresChronoPrisonPhase,
    type AresChronoPrisonRuntimeDecision,
} from "@/extensions/ares/AresChronoPrisonRuntime";
import type { AresChronoPrisonWeaponRules } from "@/extensions/ares/AresChronoPrisons";
import { EnterObjectEvent } from "@/game/event/EnterObjectEvent";
import { EnterTransportEvent } from "@/game/event/EnterTransportEvent";
import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
import { VeteranAbility } from "@/game/gameobject/unit/VeteranAbility";

export interface AresChronoPrisonWorld {
    events: {
        dispatch(event: any): void;
    };
    limboObject(object: any, limboData: {
        selected: boolean;
        controlGroup?: number;
        inTransport: boolean;
    }): void;
    changeObjectOwner?(object: any, owner: any): void;
    getUnitSelection?(): {
        isSelected?(object: any): boolean;
        getOrCreateSelectionModel?(object: any): {
            getControlGroupNumber?(): number | undefined;
        };
    };
}

export interface AresChronoPrisonIntegrationOptions {
    phase?: AresChronoPrisonPhase;
    warheadIsTemporal?: boolean;
    warheadCanAffect?: boolean;
}

const NOT_ABDUCTOR: AresChronoPrisonRuntimeDecision = {
    eligible: false,
    reason: "not-abductor",
    fallbackToConventionalDamage: true,
    fallbackToTemporalErase: false,
    waitForTemporalErasure: false,
    changeOwner: false,
};

function getMaxHitPoints(target: any): number {
    const healthTrait = target?.healthTrait;
    return healthTrait?.maxHitPoints ?? healthTrait?.getHitPoints?.() ?? 0;
}

function getPsionicsImmunity(target: any): boolean {
    return target?.rules?.immuneToPsionics === true ||
        target?.veteranTrait?.hasVeteranAbility?.(VeteranAbility.PSIONICSIMMUNE) === true;
}

function getWeaponRules(weaponRules: {
    aresChronoPrison?: AresChronoPrisonWeaponRules;
}): AresChronoPrisonWeaponRules | undefined {
    return weaponRules?.aresChronoPrison;
}

/**
 * Applies an eligible Ares Abductor hit to the live transport/limbo model.
 *
 * The decision remains pure and is evaluated before this function mutates
 * anything. A rejected attempt deliberately returns to the caller so the
 * ordinary Warhead damage path can continue unchanged.
 */
export function applyAresChronoPrison(
    attacker: any,
    target: any,
    weaponRules: { aresChronoPrison?: AresChronoPrisonWeaponRules },
    world: AresChronoPrisonWorld,
    options: AresChronoPrisonIntegrationOptions = {},
): AresChronoPrisonRuntimeDecision {
    const chronoWeapon = getWeaponRules(weaponRules);
    if (!chronoWeapon) return NOT_ABDUCTOR;

    const transport = attacker?.transportTrait;
    const targetMaxHitPoints = getMaxHitPoints(target);
    const targetHitPoints = target?.healthTrait?.getHitPoints?.() ?? 0;
    const targetIsLiveUnit = target?.isUnit?.() === true &&
        target?.isSpawned === true &&
        target?.isDestroyed !== true &&
        target?.isCrashing !== true &&
        target?.limboData === undefined;
    const decision = decideAresChronoPrison({
        weapon: chronoWeapon,
        target: {
            passengerCapable: targetIsLiveUnit,
            health: targetHitPoints,
            healthPercent: targetMaxHitPoints > 0 ? targetHitPoints / targetMaxHitPoints : 0,
            size: target?.rules?.size ?? 0,
            immuneToAbduction: target?.rules?.aresChronoPrison?.immuneToAbduction === true,
            psionicsImmune: getPsionicsImmunity(target),
            ironCurtained: target?.invulnerableTrait?.isActive?.() === true,
            warheadCanAffect: options.warheadCanAffect ?? true,
        },
        attacker: {
            sizeLimit: attacker?.rules?.sizeLimit ?? 0,
            passengerCapacity: transport?.getMaxCapacity?.() ?? 0,
            occupiedPassengerCapacity: transport?.getOccupiedCapacity?.() ?? 0,
        },
        techno: target?.rules?.aresChronoPrison,
        warheadIsTemporal: options.warheadIsTemporal,
        phase: options.phase,
    });
    if (!decision.eligible) return decision;

    const selection = world.getUnitSelection?.();
    const selectionModel = selection?.getOrCreateSelectionModel?.(target);
    const limboData = {
        selected: selection?.isSelected?.(target) ?? false,
        controlGroup: selectionModel?.getControlGroupNumber?.(),
        inTransport: true,
    };
    const sourceTile = target.tile;

    // TemporalTrait owns the relationship between the erased target and its
    // attackers. Release it before limboing the target so no stale temporal
    // attacker keeps referring to a passenger that is no longer on the map.
    target.temporalTrait?.releaseAttackersForAresAbduction?.(world);
    world.limboObject(target, limboData);
    transport.units.push(target);

    if (decision.changeOwner && world.changeObjectOwner && attacker.owner && target.owner !== attacker.owner) {
        world.changeObjectOwner(target, attacker.owner);
    }
    world.events.dispatch(new EnterTransportEvent(attacker));
    world.events.dispatch(new EnterObjectEvent(attacker, target));
    if (chronoWeapon.animation && sourceTile) {
        world.events.dispatch(new TriggerAnimEvent(
            chronoWeapon.animation,
            sourceTile,
            undefined,
            attacker.owner,
            attacker,
        ));
    }
    return decision;
}
