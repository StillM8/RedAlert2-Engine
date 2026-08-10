import { describe, expect, test } from "bun:test";
import {
    ARES_DOCUMENTATION_DOCUMENTS,
    ARES_DOCUMENTATION_ROOTS,
    ARES_FEATURE_CATALOG,
    getAresCatalogSummary,
} from "@/extensions/ares/AresFeatureCatalog";
import { resolveAresCapabilityOrder } from "@/extensions/ares/AresCapabilityDependencies";

describe("Ares documentation catalog", () => {
    test("contains the complete official leaf-document inventory", () => {
        const paths = ARES_DOCUMENTATION_DOCUMENTS.map((document) => document.path);
        expect(paths.length).toBe(127);
        expect(new Set(paths).size).toBe(paths.length);
        expect(paths.every((path) => path.endsWith(".rst"))).toBe(true);
        expect(ARES_DOCUMENTATION_ROOTS).toContain("new/index.rst");
        expect(ARES_DOCUMENTATION_ROOTS).toContain("restored/index.rst");
    });

    test("records independent parser/runtime/verification status", () => {
        const armor = ARES_FEATURE_CATALOG.find((feature) => feature.id === "ares.additional-armor-types");
        const emp = ARES_FEATURE_CATALOG.find((feature) => feature.id === "ares.emp");
        expect(armor?.parserStatus).toBe("complete");
        expect(armor?.runtimeStatus).toBe("complete");
        expect(armor?.verificationStatus).toBe("synthetic");
        expect(emp?.parserStatus).toBe("partial");
        expect(emp?.runtimeStatus).toBe("missing");
    });

    test("reports a stable category summary", () => {
        const summary = getAresCatalogSummary();
        expect(summary.documents).toBe(127);
        expect(summary.capabilities).toBe(127);
        expect(summary.categories.new).toBeGreaterThan(0);
        expect(summary.categories.restored).toBeGreaterThan(0);
        expect(summary.categories.bugfix).toBeGreaterThan(0);
        expect(summary.categories.ui).toBeGreaterThan(0);
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
