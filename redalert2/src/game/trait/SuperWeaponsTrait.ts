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
import { AresSuperWeaponEffectEvent } from "@/game/event/AresSuperWeaponEffectEvent";
import { ObjectType } from "@/engine/type/ObjectType";
import { isAresEmpOperational } from "@/extensions/ares/AresEMP";
import { createAresSuperWeaponRadarEvent } from "@/extensions/ares/AresSuperWeaponRadar";
import {
    applyAresSuperWeaponMoney,
    canAresSuperWeaponTransactMoney,
} from "@/extensions/ares/AresSuperWeaponMoney";
import {
    createAresSuperWeaponAvailabilityOwnerSnapshot,
    evaluateAresSuperWeaponAvailabilityForOwnerSnapshot,
    evaluateAresSuperWeaponAvailabilityForOwner,
    hasAresSuperWeaponAvailabilityConfiguration,
    type AresSuperWeaponAvailabilityOwnerSnapshot,
} from "@/extensions/ares/AresSuperWeaponAvailability";
import {
    getAvailableBuildingSuperWeapon,
    getBuildingSuperWeaponTraits,
} from "@/game/gameobject/trait/SuperWeaponTrait";
export class SuperWeaponsTrait {
    private effects: SuperWeaponEffect[] = [];
    private aresAvailabilityRulesSource: any;
    private aresAvailabilityRulesSourceSize = -1;
    private aresAvailabilityRules: readonly any[] = [];
    private aresAvailabilityResultCache = new WeakMap<object, Map<object, {
        snapshot: AresSuperWeaponAvailabilityOwnerSnapshot;
        shotsFired: number;
        result: ReturnType<typeof evaluateAresSuperWeaponAvailabilityForOwnerSnapshot>;
    }>>();
    private readonly aresOwnerSnapshotCache = new WeakMap<object, {
        collection: unknown;
        size: number | undefined;
        stateKey: string;
        countryId?: string;
        isAi: boolean;
        defeated: boolean;
        snapshot: AresSuperWeaponAvailabilityOwnerSnapshot;
    }>();
    private readonly effectPresentationRules = new WeakMap<SuperWeaponEffect, {
        rules: any;
        noSfxWarning: boolean;
    }>();
    /**
     * Ares fires ChronoSphere first and ChronoWarp second.  The second-stage
     * superweapon only supplies the destination; all chronoshift semantics
     * come from the ChronoSphere that selected the source cell.
     */
    private readonly chronoSphereSources = new WeakMap<object, {
        rules: any;
        tile: any;
    }>();

    /** Read-only query used by Ares AI inactive-effect constraints. */
    hasActiveEffect(type: any): boolean {
        return this.effects.some((effect) =>
            effect.status !== EffectStatus.Finished && effect.type === type,
        );
    }
    [NotifyTick.onTick](t: any) {
        const aresAvailabilityRules = this.getAresAvailabilityRules(t);
        for (const e of t.getCombatants()) {
            this.reconcileAresAvailability(e, t, aresAvailabilityRules);
            for (const i of e.superWeaponsTrait.getAll()) {
                if (i.rules.isPowered) {
                    this.updateTimer(i, !i.owner.powerTrait?.isLowPower?.(), t.currentTick, t);
                }
                i.update(t);
            }
        }
        for (const r of this.effects) {
            if (r.status === EffectStatus.NotStarted) {
                const presentation = this.effectPresentationRules.get(r);
                if (presentation && (presentation.rules?.ares?.swAnimation || presentation.rules?.ares?.swSound)) {
                    t.events.dispatch(new AresSuperWeaponEffectEvent(
                        presentation.rules,
                        r.owner,
                        r.tile,
                        presentation.noSfxWarning,
                    ));
                }
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
    private getAresAvailabilityRules(world: any): readonly any[] {
        const source = world?.rules?.superWeaponRules;
        const size = typeof source?.size === "number" ? source.size : -1;
        if (source === this.aresAvailabilityRulesSource && size === this.aresAvailabilityRulesSourceSize) {
            return this.aresAvailabilityRules;
        }
        this.aresAvailabilityRulesSource = source;
        this.aresAvailabilityRulesSourceSize = size;
        this.aresAvailabilityRules = source?.values
            ? [...source.values()].filter((rules: any) => !!rules?.ares)
            : [];
        this.aresAvailabilityResultCache = new WeakMap();
        return this.aresAvailabilityRules;
    }
    private getAresOwnerSnapshot(player: any): AresSuperWeaponAvailabilityOwnerSnapshot {
        const collection = player?.buildings ?? player?.getOwnedObjectsByType?.(ObjectType.Building) ?? [];
        const size = typeof collection?.size === "number"
            ? collection.size
            : typeof collection?.length === "number" ? collection.length : undefined;
        let stateKey = "";
        if (collection && typeof collection[Symbol.iterator] === "function") {
            for (const building of collection as Iterable<any>) {
                const rules = building?.rules ?? {};
                stateKey += [
                    building?.id ?? building?.name ?? "",
                    building?.limboData ? "limbo" : "active",
                    rules.superWeapon ?? "",
                    rules.superWeapon2 ?? "",
                    Array.isArray(rules.superWeapons) ? rules.superWeapons.join(",") : rules.superWeapons ?? "",
                ].join("\u0001") + "\u0002";
            }
        }
        const countryId = player?.country?.id ?? player?.country?.name;
        const isAi = player?.isAi === true;
        const defeated = player?.defeated === true;
        const cached = typeof player === "object" && player !== null
            ? this.aresOwnerSnapshotCache.get(player)
            : undefined;
        if (cached && cached.collection === collection && cached.size === size && cached.stateKey === stateKey &&
            cached.countryId === countryId && cached.isAi === isAi && cached.defeated === defeated) {
            return cached.snapshot;
        }
        const snapshot = createAresSuperWeaponAvailabilityOwnerSnapshot(player);
        if (typeof player === "object" && player !== null) {
            this.aresOwnerSnapshotCache.set(player, {
                collection,
                size,
                stateKey,
                countryId,
                isAi,
                defeated,
                snapshot,
            });
        }
        return snapshot;
    }
    private reconcileAresAvailability(player: any, world: any, rules: readonly any[]): void {
        if (!rules.length || !player.superWeaponsTrait) return;
        const snapshot = this.getAresOwnerSnapshot(player);
        let playerResults = this.aresAvailabilityResultCache.get(player);
        if (!playerResults) {
            playerResults = new Map();
            this.aresAvailabilityResultCache.set(player, playerResults);
        }
        for (const superWeaponRules of rules) {
            const current = player.superWeaponsTrait.get(superWeaponRules.name);
            const shotsFired = current?.shotsFired ??
                player.superWeaponsTrait.getAresShotsFired?.(superWeaponRules.name) ?? 0;
            const cached = playerResults.get(superWeaponRules);
            const result = cached?.snapshot === snapshot && cached.shotsFired === shotsFired
                ? cached.result
                : evaluateAresSuperWeaponAvailabilityForOwnerSnapshot(
                    superWeaponRules.ares,
                    snapshot,
                    superWeaponRules.name,
                    shotsFired,
                );
            if (!cached || cached.snapshot !== snapshot || cached.shotsFired !== shotsFired) {
                playerResults.set(superWeaponRules, { snapshot, shotsFired, result });
            }
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
        const provider = getAvailableBuildingSuperWeapon(e);
        if (e.owner.powerTrait && e.isBuilding() && provider) {
            this.updateTimer(provider.superWeapon, !e.owner.powerTrait.isLowPower(), undefined, t);
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
            getBuildingSuperWeaponTraits(e).some(trait => trait.getSuperWeapon(e) === t) &&
            (!t.rules.isPowered || isAresEmpOperational(e)));
    }
    private addEffect(e: SuperWeaponEffect, rules?: any, noSfxWarning: boolean = false) {
        this.effects.push(e);
        if (rules?.ares) {
            this.effectPresentationRules.set(e, { rules, noSfxWarning });
        }
    }
    activateSuperWeapon(t: number, e: any, i: any, r: any, s: any): boolean {
        const a = e.superWeaponsTrait
            ?.getAll()
            .find((e: any) => e.rules.index === t);
        if (!a) {
            // ChronoWarp is a PostClick dependent in Ares and commonly has
            // no provider building of its own. Resolve its authored rule from
            // the action index and consume the pending ChronoSphere source.
            const rules = i?.rules?.getSuperWeaponByIndex?.(t);
            const isChronoWarp = rules?.type === SuperWeaponType.ChronoWarp ||
                rules?.ares?.extensionType === "ChronoWarp";
            if (isChronoWarp && r && this.chronoSphereSources.has(e)) {
                // A dependent ChronoWarp action carries its only click in
                // tile; it has no tile2 because the ChronoSphere source was
                // selected by the preceding action.
                this.activateEffect(rules, e, i, r, s, false, s ?? r);
                return true;
            }
            return false;
        }
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
                    getBuildingSuperWeaponTraits(n)
                        .filter(trait => trait.name === a.name)
                        .forEach(trait => trait.addSuperWeaponToPlayerIfNeeded(e, i));
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
            if (a.rules.ares?.useChargeDrain !== true) {
                a.shotsFired = (a.shotsFired ?? 0) + 1;
                if (a.rules.ares) {
                    e.superWeaponsTrait?.recordAresSuperWeaponShot?.(a.name, a.shotsFired);
                }
            }
            const hasChronoWarpDependent = e.superWeaponsTrait?.getAll?.().some((candidate: any) =>
                candidate.rules?.type === SuperWeaponType.ChronoWarp ||
                candidate.rules?.ares?.extensionType === "ChronoWarp",
            ) === true ||
                [...(i?.rules?.superWeaponRules?.values?.() ?? [])].some((candidate: any) =>
                    candidate.type === SuperWeaponType.ChronoWarp ||
                    candidate.ares?.extensionType === "ChronoWarp",
                );
            if (a.rules.type === SuperWeaponType.ChronoSphere && (s || hasChronoWarpDependent)) {
                if (s) {
                    // The existing UI sends both clicks as one ChronoSphere
                    // activation. It already owns the complete effect, so it
                    // must not leave a source for a later standalone warp.
                    this.chronoSphereSources.delete(e);
                }
                else {
                    // Ares' native path sends the first click through the
                    // ChronoSphere and the second through ChronoWarp. Keep
                    // the source generic and house-local for that path.
                    this.chronoSphereSources.set(e, {
                        rules: a.rules,
                        tile: r,
                    });
                }
            }
            const isChronoWarp = a.rules.type === SuperWeaponType.ChronoWarp ||
                a.rules.ares?.extensionType === "ChronoWarp";
            this.activateEffect(a.rules, e, i, r, s, false, isChronoWarp ? s ?? r : undefined);
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
    private activateEffect(
        e: any,
        i: any,
        r: any,
        s: any,
        a: any,
        n: boolean = false,
        chronoWarpDestination?: any,
    ) {
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
            if (extensionType === "ChronoWarp") {
                const source = this.chronoSphereSources.get(i);
                const destination = s ?? chronoWarpDestination;
                if (source && destination) {
                    const sourceRules = source.rules;
                    t.push(new ChronoSphereEffect(
                        SuperWeaponType.ChronoSphere,
                        i,
                        source.tile,
                        destination,
                        sourceRules.ares?.swRange,
                        {
                            affectedTargets: sourceRules.ares?.swAffectsTarget,
                            reconsiderBuildings: sourceRules.ares?.chronosphereReconsiderBuildings,
                            killOrganic: sourceRules.ares?.chronosphereKillOrganic,
                            killTeleporters: sourceRules.ares?.chronosphereKillTeleporters,
                            affectsIronCurtain: sourceRules.ares?.chronosphereAffectsIronCurtain,
                            affectsUnwarpable: sourceRules.ares?.chronosphereAffectsUnwarpable,
                            affectsUndeployable: sourceRules.ares?.chronosphereAffectsUndeployable,
                            blowUnplaceable: sourceRules.ares?.chronosphereBlowUnplaceable,
                            killCargo: sourceRules.ares?.chronosphereKillCargo,
                        },
                    ));
                    this.chronoSphereSources.delete(i);
                }
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
                        if (!this.chronoSphereSources.has(i)) {
                            throw new Error("Missing tile2 action param");
                        }
                        // A first-stage ChronoSphere activation only records
                        // its source. The existing two-click UI supplies
                        // tile2 in the same call and continues below.
                        break;
                    }
                    t.push(new ChronoSphereEffect(o, i, s, a, e.ares?.swRange, {
                        affectedTargets: e.ares?.swAffectsTarget,
                        reconsiderBuildings: e.ares?.chronosphereReconsiderBuildings,
                        killOrganic: e.ares?.chronosphereKillOrganic,
                        killTeleporters: e.ares?.chronosphereKillTeleporters,
                        affectsIronCurtain: e.ares?.chronosphereAffectsIronCurtain,
                        affectsUnwarpable: e.ares?.chronosphereAffectsUnwarpable,
                        affectsUndeployable: e.ares?.chronosphereAffectsUndeployable,
                        blowUnplaceable: e.ares?.chronosphereBlowUnplaceable,
                        killCargo: e.ares?.chronosphereKillCargo,
                    }));
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
                this.addEffect(d, e, n);
            }
            r.traits.filter(NotifySuperWeaponActivate).forEach((e) => {
                e[NotifySuperWeaponActivate.onActivate](eventType, i, r, s, a);
            });
            r.events.dispatch(new SuperWeaponActivateEvent(eventType, i, s, a, n, e));
        }
    }
}
