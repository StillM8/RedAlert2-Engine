import { beforeEach, describe, expect, test } from "bun:test";
import { PerformanceOptions } from "@/performance/PerformanceOptions";
import {
    attachPerformanceOptions,
    recordGameScheduleFrame,
    resetPerformanceTelemetry,
    snapshotPerformanceTelemetry,
} from "@/performance/PerformanceRuntime";

beforeEach(() => {
    attachPerformanceOptions(new PerformanceOptions({ telemetry: true }));
    resetPerformanceTelemetry();
});

describe("game schedule telemetry", () => {
    test("keeps recent RAF cadence, tick count, and interpolation percentiles", () => {
        recordGameScheduleFrame({ rafDeltaMs: 16, simulationTicks: 0, interpolation: 0.5 });
        recordGameScheduleFrame({ rafDeltaMs: 34, simulationTicks: 2.7, interpolation: 2 });

        const schedule = snapshotPerformanceTelemetry().gameSchedule;

        expect(schedule.sampleCount).toBe(2);
        expect(schedule.latest).toEqual({ rafDeltaMs: 34, simulationTicks: 2, interpolation: 1 });
        expect(schedule.p95RafDeltaMs).toBe(34);
        expect(schedule.p99SimulationTicks).toBe(2);
        expect(schedule.p95Interpolation).toBe(1);
    });
});
