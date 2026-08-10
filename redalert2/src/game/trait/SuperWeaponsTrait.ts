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
import { NotifySuperWeaponDeactivate } from "@/game/trait/interface/NotifySuperWeaponDeactivate";
import { ObjectType } from "@/engine/type/ObjectType";
import { isAresEmpOperational } from "@/extensions/ares/AresEMP";
export class SuperWeaponsTrait {
    private effects: SuperWeaponEffect[] = [];
    [NotifyTick.onTick](t: any) {
        for (const e of t.getCombatants()) {
            for (const i of e.superWeaponsTrait.getAll()) {
                if (i.rules.isPowered) {
                    this.updateTimer(i, !i.owner.powerTrait?.isLowPower?.());
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
    [NotifyPower.onPowerLow](e: any, t: any) {
        e.superWeaponsTrait
            ?.getAll()
            ?.filter((e: any) => e.rules.isPowered)
            .forEach((e: any) => {
            this.updateTimer(e, false);
        });
    }
    [NotifyPower.onPowerRestore](e: any, t: any) {
        e.superWeaponsTrait
            ?.getAll()
            ?.filter((e: any) => e.rules.isPowered)
            .forEach((e: any) => {
            this.updateTimer(e, true);
        });
    }
    [NotifyPower.onPowerChange](e: any, t: any) { }
    [NotifyWarpChange.onChange](e: any, t: any) {
        const i = e.superWeaponTrait?.getSuperWeapon(e);
        if (e.owner.powerTrait && e.isBuilding() && e.superWeaponTrait && i) {
            this.updateTimer(i, !e.owner.powerTrait.isLowPower());
        }
    }
    private updateTimer(e: any, t: boolean) {
        const i = this.superWeaponHasValidBuilding(e);
        if (t && i) {
            e.resumeTimer();
        }
        else {
            e.pauseTimer();
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
    activateSuperWeapon(t: number, e: any, i: any, r: any, s: any) {
        const a = e.superWeaponsTrait
            ?.getAll()
            .find((e: any) => e.rules.index === t);
        if (a && a.status === SuperWeaponStatus.Ready) {
            if (a.oneTimeOnly) {
                e.superWeaponsTrait.remove(a.name);
                for (const n of e.buildings) {
                    if (n.rules.superWeapon === a.name && n.superWeaponTrait) {
                        n.superWeaponTrait.addSuperWeaponToPlayerIfNeeded(e, i);
                    }
                }
            }
            else {
                a.resetTimer();
            }
            this.activateEffect(a.rules, e, i, r, s);
        }
    }
    private activateEffect(e: any, i: any, r: any, s: any, a: any, n: boolean = false) {
        const o = e.type;
        const extensionType = e.ares?.extensionType;
        const eventType = o ?? e.typeId;
        if (o !== undefined || extensionType !== undefined) {
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
                    t.push(new LightningStormEffect(o, i, s));
                    break;
                case SuperWeaponType.IronCurtain:
                    t.push(new IronCurtainEffect(o, i, s));
                    break;
                case SuperWeaponType.ChronoSphere:
                    if (!a) {
                        throw new Error("Missing tile2 action param");
                    }
                    t.push(new ChronoSphereEffect(o, i, s, a));
                    break;
                case SuperWeaponType.PsychicDominator:
                    t.push(new PsychicDominatorEffect(o, i, s));
                    break;
                case SuperWeaponType.GeneticConverter:
                    t.push(new GeneticConverterEffect(o, i, s, e.range));
                    break;
                case SuperWeaponType.PsychicReveal:
                    t.push(new PsychicRevealEffect(o, i, s));
                    break;
                case SuperWeaponType.ForceShield:
                    t.push(new ForceShieldEffect(o, i, s));
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
