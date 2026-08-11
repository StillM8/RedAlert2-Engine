import { ARES_FEATURE_CATALOG } from "./AresFeatureCatalog";

export interface AresCapabilityDependency {
    capabilityId: string;
    dependsOn: readonly string[];
    reason: string;
}

/**
 * High-level semantic dependencies.  This is intentionally independent of
 * Antares' C++ hook layout: it describes the order in which the standalone
 * engine must establish normalized data and runtime services.
 */
export const ARES_CAPABILITY_DEPENDENCIES: readonly AresCapabilityDependency[] = [
    { capabilityId: "ares.effective-ini", dependsOn: [], reason: "All Ares data must be loaded with include ordering and provenance." },
    { capabilityId: "ares.dynamic-sides-countries", dependsOn: ["ares.effective-ini"], reason: "Authored side/country IDs must exist before ownership, lobby, or presentation can resolve." },
    { capabilityId: "ares.additional-armor-types", dependsOn: ["ares.effective-ini"], reason: "Armor IDs and Versus values are normalized from effective rules." },
    { capabilityId: "ares.generic-prerequisites", dependsOn: ["ares.effective-ini", "ares.dynamic-sides-countries"], reason: "Prerequisite expressions resolve objects, countries, and sides." },
    { capabilityId: "ares.custom-foundations", dependsOn: ["ares.effective-ini"], reason: "Foundation geometry is parsed from effective TechnoType art/rules." },
    { capabilityId: "ares.custom-animation-palettes", dependsOn: ["ares.effective-ini"], reason: "Custom animation/projectile palettes are resolved from effective art data and the active theater." },
    { capabilityId: "ares.operator", dependsOn: ["ares.effective-ini"], reason: "Operator requirements are normalized from TechnoTypes and evaluated against existing passenger/garrison state." },
    { capabilityId: "ares.killing-drivers", dependsOn: ["ares.effective-ini", "ares.operator"], reason: "Driver removal uses normalized vehicle state and the Operator passenger rules when deciding which occupants are removed or ejected." },
    { capabilityId: "ares.vehicle-thief", dependsOn: ["ares.killing-drivers", "ares.operator"], reason: "VehicleThief/CanDrive consumes the normalized DriverKilled state and uses Operator passengers when a reclaimed vehicle needs a physical driver." },
    { capabilityId: "ares.target-filters", dependsOn: ["ares.dynamic-sides-countries", "ares.additional-armor-types"], reason: "Target relations and armor suitability are data-defined." },
    { capabilityId: "ares.warhead-effects", dependsOn: ["ares.additional-armor-types"], reason: "Warhead effects consume normalized Versus/armor and target semantics." },
    { capabilityId: "ares.emp", dependsOn: ["ares.effective-ini", "ares.warhead-effects"], reason: "EMP is a generic warhead effect with persistent Techno state." },
    { capabilityId: "ares.emp-threshold", dependsOn: ["ares.emp"], reason: "EMP thresholds extend the generic EMP counter." },
    { capabilityId: "ares.superweapons", dependsOn: ["ares.effective-ini", "ares.target-filters"], reason: "Custom handlers share common Ares superweapon targeting and charging data." },
    { capabilityId: "ares.superweapon-target-requirements", dependsOn: ["ares.superweapons"], reason: "Manual SW.RequiresTarget/SW.RequiresHouse validation runs before any custom or vanilla effect consumes the activation." },
    { capabilityId: "ares.superweapon-shroud-targeting", dependsOn: ["ares.superweapons"], reason: "SW.FireIntoShroud is a common launch gate evaluated against the owner's visibility before the superweapon consumes its charge." },
    { capabilityId: "ares.superweapon-fire-mode", dependsOn: ["ares.superweapons"], reason: "SW.AutoFire/SW.ManualFire determine whether an activation action is a valid human click or an AI-created launch." },
    { capabilityId: "ares.superweapon-charge-drain", dependsOn: ["ares.superweapons", "ares.superweapon-money"], reason: "Charge-drain timing owns the active superweapon timer and schedules Money.DrainAmount/DrainDelay transactions." },
    { capabilityId: "ares.firestorm-wall", dependsOn: ["ares.superweapon-charge-drain"], reason: "Firestorm wall interception depends on the handler's owner activation state and the projectile collision path." },
    { capabilityId: "ares.superweapon-battery", dependsOn: ["ares.superweapons", "ares.superweapon-charge-drain"], reason: "Battery applies house power and building-state effects while its shared charge-drain handler is active." },
    { capabilityId: "ares.superweapon-charge-state", dependsOn: ["ares.superweapons"], reason: "InitialReady and VirtualCharge alter the shared superweapon acquisition and timer state before custom effects activate." },
    { capabilityId: "ares.superweapon-deferment", dependsOn: ["ares.superweapons"], reason: "SW.Deferment is consumed by supported superweapon state machines after their normalized definitions are loaded." },
    { capabilityId: "ares.superweapon-post-dependent", dependsOn: ["ares.superweapons"], reason: "PostDependent selects a second-stage superweapon through the common authored superweapon registry." },
    { capabilityId: "ares.superweapon-radar-event", dependsOn: ["ares.superweapons"], reason: "CreateRadarEvent uses the common RadarTrait launch-event path after a superweapon activates." },
    { capabilityId: "ares.superweapon-ai-targeting", dependsOn: ["ares.superweapons", "ares.target-filters"], reason: "Ares AI modes derive deterministic target/house requirements before the host AI chooses a launch cell." },
    { capabilityId: "ares.superweapon-money", dependsOn: ["ares.superweapons"], reason: "Money.Amount is checked and applied by the common superweapon activation path." },
    { capabilityId: "ares.superweapon-range", dependsOn: ["ares.superweapons"], reason: "SW.Range is normalized once and consumed by ranged superweapon effect handlers." },
    { capabilityId: "ares.superweapon-unit-delivery", dependsOn: ["ares.superweapons", "ares.custom-foundations"], reason: "UnitDelivery places arbitrary TechnoTypes, including irregular buildings." },
    { capabilityId: "ares.superweapon-sonar-pulse", dependsOn: ["ares.superweapons"], reason: "SonarPulse is a ranged superweapon with generic cloak suppression." },
    { capabilityId: "ares.superweapon-empulse", dependsOn: ["ares.superweapons", "ares.emp"], reason: "EMPulse selects launch buildings and delivers their configured EMP warhead through the native EMP runtime." },
    { capabilityId: "ares.superweapon-drop-pod", dependsOn: ["ares.superweapons"], reason: "DropPod creates data-defined TechnoTypes at deterministic valid landing cells and applies configured owner/veterancy semantics." },
    { capabilityId: "ares.superweapon-hunter-seeker", dependsOn: ["ares.superweapons", "ares.target-filters"], reason: "Hunter Seeker launches data-defined aircraft and uses common house/target identity plus deterministic pursuit/detonation." },
    { capabilityId: "ares.staged-weapons", dependsOn: ["ares.additional-armor-types", "ares.warhead-effects"], reason: "Weapon stages eventually select normalized weapons and warhead effects." },
    { capabilityId: "ares.projectile-extensions", dependsOn: ["ares.effective-ini", "ares.target-filters", "ares.warhead-effects"], reason: "Projectile extensions resolve effective child weapons, target relations, and normalized warhead effects deterministically." },
    { capabilityId: "ares.presentation", dependsOn: ["ares.dynamic-sides-countries"], reason: "Presentation resolves the side/country identity without becoming simulation identity." },
    { capabilityId: "ares.save-load", dependsOn: ["ares.dynamic-sides-countries", "ares.emp", "ares.superweapons"], reason: "Persistent authored identities and extension timers need stable state serialization." },
    { capabilityId: "ares.deterministic-content", dependsOn: ["ares.effective-ini", "ares.dynamic-sides-countries", "ares.additional-armor-types", "ares.generic-prerequisites"], reason: "Simulation content identity must include effective definitions, not just filenames." },
];

function dependencyMap(): Map<string, AresCapabilityDependency> {
    const map = new Map<string, AresCapabilityDependency>();
    for (const dependency of ARES_CAPABILITY_DEPENDENCIES) map.set(dependency.capabilityId, dependency);
    return map;
}

/** Returns a deterministic dependency-first order and throws on cycles. */
export function resolveAresCapabilityOrder(capabilityIds: readonly string[] = ARES_FEATURE_CATALOG.map((feature) => feature.id)): string[] {
    const requested = new Set(capabilityIds);
    const known = dependencyMap();
    const state = new Map<string, "visiting" | "visited">();
    const result: string[] = [];

    const visit = (id: string, chain: string[]): void => {
        if (!requested.has(id)) return;
        const current = state.get(id);
        if (current === "visited") return;
        if (current === "visiting") throw new Error(`Ares capability dependency cycle: ${[...chain, id].join(" -> ")}`);
        state.set(id, "visiting");
        for (const dependency of known.get(id)?.dependsOn ?? []) visit(dependency, [...chain, id]);
        state.set(id, "visited");
        result.push(id);
    };

    for (const id of [...requested].sort()) visit(id, []);
    return result;
}

export function getAresCapabilityDependencies(id: string): AresCapabilityDependency | undefined {
    return dependencyMap().get(id);
}
