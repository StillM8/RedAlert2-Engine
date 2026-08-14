import { describe, expect, test } from "bun:test";
import { runSimulationStressBenchmarks, simulateCatchUp } from "@/performance/SimulationStressHarness";

describe("simulation stress harness", () => {
    test("retains simulation debt instead of dropping turns when a tick exceeds its budget", () => {
        const result = simulateCatchUp([30, 30, 30, 30], 22.2222, {
            frameIntervalMs: 16.6667,
            skipBudgetMs: 8,
            maxCatchUpMs: 100,
        });

        expect(result.totalTicks).toBe(4);
        expect(result.maxDebtMs).toBeGreaterThan(0);
        expect(result.maxBurstMs).toBeGreaterThan(0);
    });

    test("reports every requested unit-count/scenario combination", () => {
        const report = runSimulationStressBenchmarks({
            counts: [25, 50],
            scenarios: ["idle", "mental-omega"],
            warmupTicks: 2,
            sampleTicks: 4,
            seed: 1337,
        });

        expect(report.cases.map((item) => `${item.scenario}:${item.unitCount}`)).toEqual([
            "idle:25",
            "idle:50",
            "mental-omega:25",
            "mental-omega:50",
        ]);
        expect(report.cases.every((item) => item.simulation.samples === 4)).toBe(true);
        expect(report.cases.every((item) => item.catchUp.totalTicks > 0)).toBe(true);
    });
});
