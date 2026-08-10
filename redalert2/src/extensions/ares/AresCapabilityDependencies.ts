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
    { capabilityId: "ares.target-filters", dependsOn: ["ares.dynamic-sides-countries", "ares.additional-armor-types"], reason: "Target relations and armor suitability are data-defined." },
    { capabilityId: "ares.warhead-effects", dependsOn: ["ares.additional-armor-types"], reason: "Warhead effects consume normalized Versus/armor and target semantics." },
    { capabilityId: "ares.emp", dependsOn: ["ares.effective-ini", "ares.warhead-effects"], reason: "EMP is a generic warhead effect with persistent Techno state." },
    { capabilityId: "ares.emp-threshold", dependsOn: ["ares.emp"], reason: "EMP thresholds extend the generic EMP counter." },
    { capabilityId: "ares.superweapons", dependsOn: ["ares.effective-ini", "ares.target-filters"], reason: "Custom handlers share common Ares superweapon targeting and charging data." },
    { capabilityId: "ares.superweapon-target-requirements", dependsOn: ["ares.superweapons"], reason: "Manual SW.RequiresTarget/SW.RequiresHouse validation runs before any custom or vanilla effect consumes the activation." },
    { capabilityId: "ares.superweapon-charge-state", dependsOn: ["ares.superweapons"], reason: "InitialReady and VirtualCharge alter the shared superweapon acquisition and timer state before custom effects activate." },
    { capabilityId: "ares.superweapon-post-dependent", dependsOn: ["ares.superweapons"], reason: "PostDependent selects a second-stage superweapon through the common authored superweapon registry." },
    { capabilityId: "ares.superweapon-unit-delivery", dependsOn: ["ares.superweapons", "ares.custom-foundations"], reason: "UnitDelivery places arbitrary TechnoTypes, including irregular buildings." },
    { capabilityId: "ares.superweapon-sonar-pulse", dependsOn: ["ares.superweapons"], reason: "SonarPulse is a ranged superweapon with generic cloak suppression." },
    { capabilityId: "ares.superweapon-empulse", dependsOn: ["ares.superweapons", "ares.emp"], reason: "EMPulse selects launch buildings and delivers their configured EMP warhead through the native EMP runtime." },
    { capabilityId: "ares.superweapon-drop-pod", dependsOn: ["ares.superweapons"], reason: "DropPod creates data-defined TechnoTypes at deterministic valid landing cells and applies configured owner/veterancy semantics." },
    { capabilityId: "ares.staged-weapons", dependsOn: ["ares.additional-armor-types", "ares.warhead-effects"], reason: "Weapon stages eventually select normalized weapons and warhead effects." },
    { capabilityId: "ares.projectile-extensions", dependsOn: ["ares.warhead-effects"], reason: "Projectile extensions deliver normalized warhead effects deterministically." },
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
