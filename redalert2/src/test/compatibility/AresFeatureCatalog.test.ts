import { describe, expect, test } from "bun:test";
import {
    ARES_DOCUMENTATION_DOCUMENTS,
    ARES_DOCUMENTATION_ROOTS,
    ARES_FEATURE_CATALOG,
    getAresImplementationCapability,
    getAresCatalogSummary,
} from "@/extensions/ares/AresFeatureCatalog";
import { resolveAresCapabilityOrder } from "@/extensions/ares/AresCapabilityDependencies";
import { createDefaultAresFeatureRegistry } from "@/extensions/ares/AresFeatureRegistry";

describe("Ares documentation catalog", () => {
    test("contains the complete official leaf-document inventory", () => {
        const paths = ARES_DOCUMENTATION_DOCUMENTS.map((document) => document.path);
        expect(paths.length).toBe(133);
        expect(new Set(paths).size).toBe(paths.length);
        expect(paths.every((path) => path.endsWith(".rst"))).toBe(true);
        expect(paths).toContain("new/damageparticlesystems.rst");
        expect(ARES_DOCUMENTATION_ROOTS).toContain("new/index.rst");
        expect(ARES_DOCUMENTATION_ROOTS).toContain("restored/index.rst");
    });

    test("records independent parser/runtime/verification status", () => {
        const armor = ARES_FEATURE_CATALOG.find((feature) => feature.id === "ares.additional-armor-types");
        const emp = ARES_FEATURE_CATALOG.find((feature) => feature.id === "ares.emp");
        expect(armor?.parserStatus).toBe("complete");
        expect(armor?.runtimeStatus).toBe("complete");
        expect(armor?.verificationStatus).toBe("synthetic");
        expect(emp?.parserStatus).toBe("complete");
        expect(emp?.runtimeStatus).toBe("partial");
    });

    test("maps the implemented presentation and infantry capability leaves", () => {
        const ids = [
            "ares.alternate-theater-art",
            "ares.custom-cameo-palettes",
            "ares.customizable-insignia",
            "ares.customizable-parachute-animations",
            "ares.hardcoded-unit-properties",
            "ares.ifv-modes",
            "ares.powered-by",
        ];
        const registry = createDefaultAresFeatureRegistry();
        for (const id of ids) {
            expect(ARES_FEATURE_CATALOG.some((feature) => feature.id === id)).toBe(true);
            expect(registry.has(id)).toBe(true);
        }
    });

    test("reports a stable category summary", () => {
        const summary = getAresCatalogSummary();
        expect(summary.documents).toBe(133);
        expect(summary.capabilities).toBe(133);
        expect(summary.categories.new).toBeGreaterThan(0);
        expect(summary.categories.restored).toBeGreaterThan(0);
        expect(summary.categories.bugfix).toBeGreaterThan(0);
        expect(summary.categories.ui).toBeGreaterThan(0);
    });

    test("tracks per-projectile ballistic scatter as a verified projectile capability", () => {
        const ballistic = ARES_FEATURE_CATALOG.find((feature) =>
            feature.sourceDocuments.includes("new/projectiles/ballisticscatter.rst"));

        expect(ballistic?.id).toBe("ares.projectile-extensions");
        expect(ballistic?.documentedKeys).toContain("[Projectile]BallisticScatter.Min");
        expect(ballistic?.documentedKeys).toContain("[Projectile]BallisticScatter.Max");
        expect(ballistic?.parserStatus).toBe("complete");
        expect(ballistic?.runtimeStatus).toBe("complete");
        expect(ballistic?.tests).toContain("AresProjectileExtensions.test.ts");
    });

    test("tracks damage-particle implementation metadata separately from the leaf inventory", () => {
        const damageParticles = getAresImplementationCapability("ares.damage-particle-systems");
        expect(damageParticles?.sourceDocuments).toContain("new/damageparticlesystems.rst");
        expect(damageParticles?.documentedKeys).toContain("DamageParticleSystems");
        expect(damageParticles?.runtimeStatus).toBe("partial");
        expect(damageParticles?.tests).toContain("AresDamageParticlesTechnoIntegration.test.ts");
    });
});

describe("Ares capability dependency graph", () => {
    test("resolves dependency-first order deterministically", () => {
        const ids = [
            "ares.superweapon-sonar-pulse",
            "ares.superweapons",
            "ares.target-filters",
            "ares.dynamic-sides-countries",
            "ares.effective-ini",
        ];
        const order = resolveAresCapabilityOrder(ids);
        expect(order.indexOf("ares.effective-ini")).toBeLessThan(order.indexOf("ares.dynamic-sides-countries"));
        expect(order.indexOf("ares.dynamic-sides-countries")).toBeLessThan(order.indexOf("ares.target-filters"));
        expect(order.indexOf("ares.target-filters")).toBeLessThan(order.indexOf("ares.superweapons"));
        expect(order.indexOf("ares.superweapons")).toBeLessThan(order.indexOf("ares.superweapon-sonar-pulse"));
        expect(resolveAresCapabilityOrder(ids)).toEqual(order);
    });
});
