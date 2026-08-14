import { runSimulationStressBenchmarks, type SimulationStressScenario } from "../redalert2/src/performance/SimulationStressHarness";

function numericList(value: string | undefined): number[] | undefined {
    if (!value) return undefined;
    const values = value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0);
    return values.length ? values : undefined;
}

function stringList(value: string | undefined): SimulationStressScenario[] | undefined {
    if (!value) return undefined;
    const allowed = new Set<SimulationStressScenario>(["idle", "moving", "fighting", "ai", "mental-omega"]);
    const values = value.split(",").map((item) => item.trim()).filter((item): item is SimulationStressScenario => allowed.has(item as SimulationStressScenario));
    return values.length ? values : undefined;
}

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args.set(match[1], match[2]);
}

const report = runSimulationStressBenchmarks({
    counts: numericList(args.get("counts")),
    scenarios: stringList(args.get("scenarios")),
    warmupTicks: args.has("warmup") ? Number(args.get("warmup")) : undefined,
    sampleTicks: args.has("samples") ? Number(args.get("samples")) : undefined,
    seed: args.has("seed") ? Number(args.get("seed")) : undefined,
});
console.log(JSON.stringify(report, null, 2));
