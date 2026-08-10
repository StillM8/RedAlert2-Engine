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
        implemented: false,
        parserImplemented: true,
        runtimeImplemented: false,
        tests: [],
    },
    {
        id: "ares.custom-countries",
        description: "Data-defined countries and side presentation",
        implemented: false,
        parserImplemented: true,
        runtimeImplemented: false,
        tests: ["AresSides.test.ts", "CountryIcon.test.ts"],
        notes: "Country IDs, side IDs, lobby ordering, multiplayer filtering, provenance, and explicit flag resources are data-driven; legacy adapters remain for older simulation paths.",
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
        notes: "Basic initial-factory-country checks are wired for production; Ares plan inheritance (HasAllPlans/Permanent) remains to be implemented.",
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
        id: "ares.custom-superweapons",
        description: "Data-defined superweapon handlers and target filters",
        implemented: false,
        parserImplemented: false,
        runtimeImplemented: false,
        tests: [],
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
