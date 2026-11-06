import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createDefaultAresFeatureRegistry } from "@/extensions/ares/AresFeatureRegistry";

/**
 * The feature registry is the project's "is Ares workable" ledger. Every test
 * file it cites must exist (a cited-but-absent test silently certifies
 * behavior nobody exercises — e.g. the AresBuildingPassengerHost gap), and
 * implemented capabilities must be backed by at least one test.
 */

function collectTestFileNames(dir: string, out: Set<string> = new Set()): Set<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            collectTestFileNames(full, out);
        }
        else {
            out.add(entry.name);
        }
    }
    return out;
}

describe("Ares feature registry integrity", () => {
    const registry = createDefaultAresFeatureRegistry();
    const onDisk = collectTestFileNames("src/test");

    test("every cited test file exists on disk", () => {
        const missing: string[] = [];
        for (const feature of registry.list()) {
            for (const test of feature.tests) {
                if (!onDisk.has(test)) {
                    missing.push(`${feature.id} -> ${test}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    test("implemented capabilities are backed by at least one existing test", () => {
        const unbacked: string[] = [];
        for (const feature of registry.list()) {
            if (!feature.implemented) continue;
            const existing = feature.tests.filter((test) => onDisk.has(test));
            if (!existing.length) {
                unbacked.push(feature.id);
            }
        }
        expect(unbacked).toEqual([]);
    });
});
