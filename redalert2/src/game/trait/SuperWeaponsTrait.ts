import { NotifyWarpChange } from "@/game/trait/interface/NotifyWarpChange";
import { SuperWeapon, SuperWeaponStatus } from "@/game/SuperWeapon";
import { SuperWeaponEffect, EffectStatus } from "@/game/superweapon/SuperWeaponEffect";
import { NotifyPower } from "@/game/trait/interface/NotifyPower";
import { NotifyTick } from "@/game/trait/interface/NotifyTick";
import { SuperWeaponType } from "@/game/type/SuperWeaponType";
import { NotifySuperWeaponActivate } from "@/game/trait/interface/NotifySuperWeaponActivate";
import { SuperWeaponActivateEvent } from "@/game/event/SuperWeaponActivateEvent";
import { ParadropEffect } from "@/game/superweapon/ParadropEffect";
import { NukeEffect } from "@/game/superweapon/NukeEffect";
import { LightningStormEffect } from "@/game/superweapon/LightningStormEffect";
import { IronCurtainEffect } from "@/game/superweapon/IronCurtainEffect";
import { ChronoSphereEffect } from "@/game/superweapon/ChronoSphereEffect";
import { PsychicDominatorEffect } from "@/game/superweapon/PsychicDominatorEffect";
import { GeneticConverterEffect } from "@/game/superweapon/GeneticConverterEffect";
import { PsychicRevealEffect } from "@/game/superweapon/PsychicRevealEffect";
import { ForceShieldEffect } from "@/game/superweapon/ForceShieldEffect";
import { SpyPlaneEffect } from "@/game/superweapon/SpyPlaneEffect";
import { GenericWarheadEffect } from "@/game/superweapon/GenericWarheadEffect";
import { UnitDeliveryEffect } from "@/game/superweapon/UnitDeliveryEffect";
import { SonarPulseEffect } from "@/game/superweapon/SonarPulseEffect";
import { EMPulseEffect } from "@/game/superweapon/EMPulseEffect";
import { DropPodEffect } from "@/game/superweapon/DropPodEffect";
import { HunterSeekerEffect } from "@/game/superweapon/HunterSeekerEffect";
import { NotifySuperWeaponDeactivate } from "@/game/trait/interface/NotifySuperWeaponDeactivate";
import { ObjectType } from "@/engine/type/ObjectType";
import { isAresEmpOperational } from "@/extensions/ares/AresEMP";
import { createAresSuperWeaponRadarEvent } from "@/extensions/ares/AresSuperWeaponRadar";
import {
    applyAresSuperWeaponMoney,
    canAresSuperWeaponTransactMoney,
} from "@/extensions/ares/AresSuperWeaponMoney";
import {
    evaluateAresSuperWeaponAvailabilityForOwner,
    hasAresSuperWeaponAvailabilityConfiguration,
} from "@/extensions/ares/AresSuperWeaponAvailability";
export class SuperWeaponsTrait {
    private effects: SuperWeaponEffect[] = [];
    [NotifyTick.onTick](t: any) {
        for (const e of t.getCombatants()) {
            this.reconcileAresAvailability(e, t);
            for (const i of e.superWeaponsTrait.getAll()) {
                if (i.rules.isPowered) {
                    this.updateTimer(i, !i.owner.powerTrait?.isLowPower?.(), t.currentTick, t);
                }
                i.update(t);
            }
        }
        for (const r of this.effects) {
            if (r.status === EffectStatus.NotStarted) {
                r.onStart(t);
                r.status = EffectStatus.Running;
            }
            if (r.onTick(t)) {
                r.status = EffectStatus.Finished;
                t.traits
                    .filter(NotifySuperWeaponDeactivate)
                    .forEach((e) => {
                    e[NotifySuperWeaponDeactivate.onDeactivate](r.type, r.owner, t);
                });
            }
        }
        this.effects = this.effects.filter((e) => e.status !== EffectStatus.Finished);
    }
    private reconcileAresAvailability(player: any, world: any): void {
        const rules = world?.rules?.superWeaponRules?.values?.();
        if (!rules || !player.superWeaponsTrait) return;
        for (const superWeaponRules of rules) {
            if (!superWeaponRules.ares) continue;
            const current = player.superWeaponsTrait.get(superWeaponRules.name);
            const result = evaluateAresSuperWeaponAvailabilityForOwner(
                superWeaponRules.ares,
                player,
                superWeaponRules.name,
                current?.shotsFired ?? player.superWeaponsTrait.getAresShotsFired?.(superWeaponRules.name) ?? 0,
            );
            if (result.available) {
                if (!current) {
                    const superWeapon = world.createSuperWeapon(superWeaponRules.name, player);
                    player.superWeaponsTrait.add(superWeapon);
                    if (superWeapon.rules.isPowered && player.powerTrait?.isLowPower()) {
                        superWeapon.pauseTimer(world.currentTick);
                    }
                }
            }
            else if (current && !current.isGift) {
                player.superWeaponsTrait.remove(superWeaponRules.name);
            }
        }
    }
    [NotifyPower.onPowerLow](e: any, t: any) {
        e.superWeaponsTrait
            ?.getAll()
            ?.filter((e: any) => e.rules.isPowered)
            .forEach((e: any) => {
            this.updateTimer(e, false, undefined, t);
        });
    }
    [NotifyPower.onPowerRestore](e: any, t: any) {
        e.superWeaponsTrait
            ?.getAll()
            ?.filter((e: any) => e.rules.isPowered)
            .forEach((e: any) => {
            this.updateTimer(e, true, undefined, t);
        });
    }
    [NotifyPower.onPowerChange](e: any, t: any) { }
    [NotifyWarpChange.onChange](e: any, t: any) {
        const i = e.superWeaponTrait?.getSuperWeapon(e);
        if (e.owner.powerTrait && e.isBuilding() && e.superWeaponTrait && i) {
            this.updateTimer(i, !e.owner.powerTrait.isLowPower(), undefined, t);
        }
    }
    private updateTimer(e: any, t: boolean, currentTick?: number, world?: any) {
        const i = this.superWeaponHasValidBuilding(e);
        if (t && i) {
            e.resumeTimer(currentTick);
        }
        else {
            e.pauseTimer(currentTick, world);
        }
    }
    private superWeaponHasValidBuilding(t: any) {
        return [...t.owner.buildings].find((e: any) =>
            e.superWeaponTrait?.getSuperWeapon(e) === t &&
            (!t.rules.isPowered || isAresEmpOperational(e)));
    }
    private addEffect(e: SuperWeaponEffect) {
        this.effects.push(e);
    }
    activateSuperWeapon(t: number, e: any, i: any, r: any, s: any): boolean {
        const a = e.superWeaponsTrait
            ?.getAll()
            .find((e: any) => e.rules.index === t);
        if (a && a.status === SuperWeaponStatus.Ready) {
            if (a.rules.ares && hasAresSuperWeaponAvailabilityConfiguration(a.rules.ares) &&
                !evaluateAresSuperWeaponAvailabilityForOwner(
                a.rules.ares,
                e,
                a.name,
                a.shotsFired ?? e.superWeaponsTrait?.getAresShotsFired?.(a.name) ?? 0,
            ).available) {
                return false;
            }
            const moneyAmount = a.rules.ares?.moneyAmount;
            if (!canAresSuperWeaponTransactMoney(e.credits, moneyAmount)) {
                // Antares aborts before consuming the charge or dispatching
                // the effect when a negative Money.Amount cannot be paid.
                console.warn(`Superweapon "${a.name}" cannot launch: insufficient credits for Money.Amount=${moneyAmount}`);
                return false;
            }
            if (!applyAresSuperWeaponMoney(e, moneyAmount)) {
                // Keep the charge and one-shot removal untouched if a host
                // owner changes its balance between validation and mutation.
                console.warn(`Superweapon "${a.name}" launch transaction failed; effect skipped.`);
                return false;
            }
            if (a.oneTimeOnly) {
                e.superWeaponsTrait.remove(a.name);
                for (const n of e.buildings) {
                    if (n.rules.superWeapon === a.name && n.superWeaponTrait) {
                        n.superWeaponTrait.addSuperWeaponToPlayerIfNeeded(e, i);
                    }
                }
            }
            else if (a.rules.ares?.useChargeDrain === true) {
                const ratio = a.rules.ares.swChargeToDrainRatio ??
                    i.rules.general?.chargeToDrainRatio ??
                    1;
                if (!a.startChargeDrain(ratio, i)) {
                    return false;
                }
            }
            else {
                a.resetTimer();
            }
            a.shotsFired = (a.shotsFired ?? 0) + 1;
            if (a.rules.ares) {
                e.superWeaponsTrait?.recordAresSuperWeaponShot?.(a.name, a.shotsFired);
            }
            this.activateEffect(a.rules, e, i, r, s);
            return true;
        }
        return false;
    }

    /** Stop a charge-drain superweapon without changing ordinary SW timers. */
    deactivateSuperWeapon(t: number, e: any): boolean {
        const weapon = e.superWeaponsTrait
            ?.getAll()
            .find((candidate: any) => candidate.rules.index === t);
        if (!weapon?.isChargeDrainActive?.()) return false;
        if (weapon.rules.ares?.swUnstoppable === true) return false;
        return weapon.deactivateChargeDrain();
    }
    private activateEffect(e: any, i: any, r: any, s: any, a: any, n: boolean = false) {
        const o = e.type;
        const extensionType = e.ares?.extensionType;
        const eventType = o ?? e.typeId;
        if (o !== undefined || extensionType !== undefined) {
            if (e.ares?.swCreateRadarEvent === true) {
                createAresSuperWeaponRadarEvent(s, r);
            }
            const t: SuperWeaponEffect[] = [];
            if (extensionType === "GenericWarhead") {
                const damage = e.ares?.swDamage;
                const warhead = e.ares?.swWarhead;
                if (!Number.isFinite(damage) || !warhead) {
                    console.warn(`GenericWarhead superweapon "${e.name}" needs SW.Damage and SW.Warhead; skipped.`);
                }
                else {
                    t.push(new GenericWarheadEffect(
                        eventType,
                        i,
                        s,
                        damage,
                        warhead,
                        e.ares?.swAffectsHouse,
                        e.ares?.swAffectsTarget,
                    ));
                }
            }
            if (extensionType === "UnitDelivery") {
                const deliverTypes = e.ares?.deliverTypes ?? [];
                if (!deliverTypes.length) {
                    console.warn(`UnitDelivery superweapon "${e.name}" has no Deliver.Types; skipped.`);
                }
                else {
                    t.push(new UnitDeliveryEffect(
                        eventType,
                        i,
                        s,
                        deliverTypes,
                        e.ares?.swDeferment ?? 20,
                        e.ares?.deliverOwner,
                        e.ares?.deliverBaseNormal ?? true,
                    ));
                }
            }
            if (extensionType === "SonarPulse") {
                t.push(new SonarPulseEffect(
                    eventType,
                    i,
                    s,
                    e.ares?.swRange,
                    e.ares?.swAffectsHouse ?? "Enemies",
                    e.ares?.swAffectsTarget ?? "Water",
                    e.ares?.sonarPulseDelay ?? 60,
                    e.ares?.swCreateRadarEvent ?? false,
                ));
            }
            if (extensionType === "EMPulse") {
                t.push(new EMPulseEffect(
                    eventType,
                    i,
                    s,
                    e.ares,
                    i.superWeaponsTrait?.get?.(e.name),
                ));
            }
            if (extensionType === "DropPod") {
                t.push(new DropPodEffect(
                    eventType,
                    i,
                    s,
                    e.ares,
                ));
            }
            if (extensionType === "HunterSeeker") {
                t.push(new HunterSeekerEffect(
                    eventType,
                    i,
                    s,
                    e.ares,
                ));
            }
            switch (o) {
                case SuperWeaponType.AmerParaDrop:
                    for (const [l, c] of r.rules.general.paradrop.amerParaDrop.entries()) {
                        if (r.rules.hasObject(c.inf, ObjectType.Infantry)) {
                            t.push(new ParadropEffect(o, i, s, c, l));
                        }
                        else {
                            console.warn(`Can't paradrop unknown infantry type "${c.inf}"`);
                        }
                    }
                    break;
                case SuperWeaponType.ParaDrop: {
                    const e = r.rules.general.paradrop.getParadropSquads(i.country.sideId ?? i.country.side);
                    for (const [h, u] of e.entries()) {
                        if (r.rules.hasObject(u.inf, ObjectType.Infantry)) {
                            t.push(new ParadropEffect(o, i, s, u, h));
                        }
                        else {
                            console.warn(`Can't paradrop unknown infantry type "${u.inf}"`);
                        }
                    }
                    break;
                }
                case SuperWeaponType.MultiMissile:
                    if (!e.weaponType) {
                        throw new Error("Missing WeaponType in super weapon rules");
                    }
                    t.push(new NukeEffect(o, i, s, e.weaponType));
                    break;
                case SuperWeaponType.LightningStorm:
                    t.push(new LightningStormEffect(o, i, s, e.ares?.swDeferment, e.ares?.swRange));
                    break;
                case SuperWeaponType.IronCurtain:
                    t.push(new IronCurtainEffect(o, i, s));
                    break;
                case SuperWeaponType.ChronoSphere:
                    if (!a) {
                        throw new Error("Missing tile2 action param");
                    }
                    t.push(new ChronoSphereEffect(o, i, s, a, e.ares?.swRange));
                    break;
                case SuperWeaponType.PsychicDominator:
                    t.push(new PsychicDominatorEffect(o, i, s, e.ares?.swDeferment, e.ares?.swRange));
                    break;
                case SuperWeaponType.GeneticConverter:
                    t.push(new GeneticConverterEffect(o, i, s, e.range, e.ares?.swRange));
                    break;
                case SuperWeaponType.PsychicReveal:
                    t.push(new PsychicRevealEffect(o, i, s, e.ares?.swRange));
                    break;
                case SuperWeaponType.ForceShield:
                    t.push(new ForceShieldEffect(o, i, s, e.ares?.swRange));
                    break;
                case SuperWeaponType.SpyPlane:
                    t.push(new SpyPlaneEffect(o, i, s));
                    break;
            }
            for (const d of t) {
                this.addEffect(d);
            }
            r.traits.filter(NotifySuperWeaponActivate).forEach((e) => {
                e[NotifySuperWeaponActivate.onActivate](eventType, i, r, s, a);
            });
            r.events.dispatch(new SuperWeaponActivateEvent(eventType, i, s, a, n));
        }
    }
}
