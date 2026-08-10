export interface ExtensionFeature {
    id: string;
    description: string;
    implemented: boolean;
    parserImplemented: boolean;
    runtimeImplemented: boolean;
    tests: string[];
    notes?: string;
}

/**
 * A deliberately small, explicit starting registry.  A feature is not marked
 * implemented merely because the scanner recognizes its spelling; runtime
 * support must be added and verified independently.
 */
export const DEFAULT_ARES_FEATURES: readonly ExtensionFeature[] = [
    {
        id: "ares.additional-armor-types",
        description: "Additional ArmorTypes and per-armor Versus values",
        implemented: true,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresCompatibilityScanner.test.ts", "AresArmor.test.ts"],
        notes: "Additional armor IDs, dynamic Versus values, and separate force-fire/retaliation/passive-acquire target gates are wired into weapon selection.",
    },
    {
        id: "ares.custom-sides",
        description: "Data-defined sides beyond the vanilla side set",
        implemented: true,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresSides.test.ts", "AresCompatibilityScanner.test.ts"],
        notes: "Dynamic side IDs, authored ordering, registry lookup, stable player identity, lobby ownership, and data-defined score presentation are verified; remaining legacy HUD adapters are tracked separately.",
    },
    {
        id: "ares.custom-countries",
        description: "Data-defined countries and side presentation",
        implemented: true,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresSides.test.ts", "CountryIcon.test.ts"],
        notes: "Country IDs, side IDs, lobby ordering, multiplayer filtering, provenance, stable player identity, and explicit presentation resources are data-driven; legacy adapters remain for older simulation paths.",
    },
    {
        id: "ares.generic-prerequisites",
        description: "Generic and composable prerequisite expressions",
        implemented: true,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresPrerequisites.test.ts"],
        notes: "Supports generic groups, alternate TechnoTypes, negative prerequisites, alternative lists, required theaters when map context is available, and stolen-tech gates.",
    },
    {
        id: "ares.factory-owner-prerequisites",
        description: "FactoryOwners and FactoryOwners.Forbidden production restrictions",
        implemented: false,
        parserImplemented: true,
        runtimeImplemented: false,
        tests: ["AresPrerequisites.test.ts"],
        notes: "Initial-factory-country checks, active HasAllPlans buildings, and Permanent capture plans are wired; save/load serialization of permanent plans remains to be implemented.",
    },
    {
        id: "ares.custom-foundations",
        description: "Non-rectangular building foundation cells",
        implemented: true,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresCompatibilityScanner.test.ts", "AresFoundation.test.ts"],
        notes: "Foundation=Custom cells are parsed with their optional outline and used by placement preview, build validation, and tile occupation; factory-specific exit behavior remains a separate compatibility task.",
    },
    {
        id: "ares.emp",
        description: "Ares EMP duration/cap counters, immunity, and Techno paralysis state",
        implemented: true,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresEMP.test.ts"],
        notes: "EMP.Duration/Cap, EMP.Modifier, ImmuneToEMP, AffectsEnemies, veteran EMPIMMUNE, per-Techno counters, movement/attack paralysis, unloading-boundary deferral, power-output blackout, factory/production suspension, spawner/slave suspension, powered-superweapon pause, and flying-aircraft crash entry are wired; sparkle presentation and full subsystem notifications remain separate.",
    },
    {
        id: "ares.emp-threshold",
        description: "EMP.Threshold parsing and destruction thresholds for airborne Technos",
        implemented: false,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresEMP.test.ts"],
        notes: "Positive thresholds and negative in-air thresholds are evaluated after EMP counter updates; parachuting and non-air targets follow the documented distinction. Full hover/aircraft edge coverage, persistence, and network certification remain separate.",
    },
    {
        id: "ares.custom-superweapons",
        description: "Data-defined superweapon handlers and target filters",
        implemented: false,
        parserImplemented: true,
        runtimeImplemented: false,
        tests: ["AresSuperWeapons.test.ts", "AresCompatibilityScanner.test.ts", "GenericWarheadEffect.test.ts"],
        notes: "GenericWarhead cell detonation and UnitDelivery placement with deterministic house/target filters are wired; the remaining custom handlers are still unsupported.",
    },
    {
        id: "ares.superweapon-target-requirements",
        description: "Manual Ares superweapon SW.RequiresTarget and SW.RequiresHouse gates",
        implemented: false,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresSuperWeaponTargeting.test.ts"],
        notes: "Manual cell/content and house-relation validation follows Antares IsCellEligible/IsTechnoEligible semantics; AI target selection and cursor presentation remain separate.",
    },
    {
        id: "ares.superweapon-charge-state",
        description: "Ares SW.InitialReady and SW.VirtualCharge timer semantics",
        implemented: false,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresSuperWeaponCharge.test.ts"],
        notes: "Initial grants and deterministic elapsed charging while a VirtualCharge superweapon is unavailable are wired; per-house shot-history re-grant semantics and save/load of unavailable intervals remain open.",
    },
    {
        id: "ares.superweapon-unit-delivery",
        description: "UnitDelivery creates data-defined TechnoTypes near the target cell",
        implemented: true,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresSuperWeapons.test.ts", "AresUnitDelivery.test.ts"],
        notes: "Verified against the Ares UnitDelivery documentation and Antares 3.0p1 state machine: deferred placement, owner selection, infantry/vehicle/aircraft/building delivery, irregular foundation bounds, BaseNormal override, and deterministic cleanup are covered; buildup/audio/power edge behavior remains separate.",
    },
    {
        id: "ares.superweapon-sonar-pulse",
        description: "SonarPulse temporarily decloaks eligible technos in a water-targeted area",
        implemented: true,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresSonarPulse.test.ts", "AresSuperWeapons.test.ts"],
        notes: "Verified against Ares 3.0p1/Antares: default radius and enemy-water targeting, full-map mode, rectangular/circular range selection, and max-duration cloak suppression are wired; explicit radar-event presentation remains dependent on the host radar event table.",
    },
    {
        id: "ares.superweapon-empulse",
        description: "EMPulse selects powered EMP cannons and delivers their EMP warhead",
        implemented: true,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresEMPulse.test.ts", "AresSuperWeapons.test.ts"],
        notes: "Antares launch-site defaults, EMPulse.Cannons override, linked range behavior, SW.MaxCount, TargetSelf immediate detonation, and PulseDelay-backed normal firing are wired; pulse-ball animation and AI targeting remain separate.",
    },
    {
        id: "ares.superweapon-drop-pod",
        description: "DropPod selects and places data-defined non-building TechnoTypes",
        implemented: false,
        parserImplemented: true,
        runtimeImplemented: true,
        tests: ["AresDropPod.test.ts", "AresSuperWeapons.test.ts"],
        notes: "Antares 3.0p1 global/per-superweapon types, inclusive count range, deterministic type selection, building abort, valid landing placement, ownership, fractional veterancy, and cleanup are wired; DropPod locomotion/trailer presentation, AI targeting, and persistent in-flight state remain open.",
    },
    {
        id: "ares.staged-weapons",
        description: "Data-defined weapon stages, spin-up, and burst behavior",
        implemented: false,
        parserImplemented: false,
        runtimeImplemented: false,
        tests: [],
    },
    {
        id: "ares.projectile-extensions",
        description: "Extended projectile trajectories, splits, and airburst behavior",
        implemented: false,
        parserImplemented: false,
        runtimeImplemented: false,
        tests: [],
    },
    {
        id: "ares.custom-animation-palettes",
        description: "Custom animation and projectile palette selection",
        implemented: false,
        parserImplemented: false,
        runtimeImplemented: false,
        tests: [],
    },
    {
        id: "ares.passenger-extensions",
        description: "Extended passenger, consumption, and open-topped behavior",
        implemented: false,
        parserImplemented: false,
        runtimeImplemented: false,
        tests: [],
    },
    {
        id: "ares.status-effects",
        description: "Generic attach/status effects used by extension content",
        implemented: false,
        parserImplemented: false,
        runtimeImplemented: false,
        tests: [],
    },
    {
        id: "ares.unknown-key",
        description: "An extension-like key with no registered semantics",
        implemented: false,
        parserImplemented: false,
        runtimeImplemented: false,
        tests: [],
    },
];

export class AresFeatureRegistry {
    private readonly features = new Map<string, ExtensionFeature>();

    constructor(features: readonly ExtensionFeature[] = DEFAULT_ARES_FEATURES) {
        for (const feature of features) {
            this.register(feature);
        }
    }

    register(feature: ExtensionFeature): void {
        this.features.set(feature.id, {
            ...feature,
            tests: [...feature.tests],
        });
    }

    get(id: string): ExtensionFeature | undefined {
        const feature = this.features.get(id);
        return feature ? { ...feature, tests: [...feature.tests] } : undefined;
    }

    list(): ExtensionFeature[] {
        return [...this.features.values()].map((feature) => ({
            ...feature,
            tests: [...feature.tests],
        }));
    }

    has(id: string): boolean {
        return this.features.has(id);
    }
}

export function createDefaultAresFeatureRegistry(): AresFeatureRegistry {
    return new AresFeatureRegistry();
}
