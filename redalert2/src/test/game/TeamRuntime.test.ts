import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import { TeamRuntime } from "@/game/trigger/TeamRuntime";
import { TeamActionExecutor } from "@/game/trigger/executor/TeamActionExecutor";

function section(values: Record<string, string>) {
    return {
        getString: (key: string) => values[key] ?? "",
        getNumber: (key: string, fallback: number) => values[key] === undefined ? fallback : Number(values[key]),
    };
}

function makeContext() {
    const owner = { name: "Owner" };
    const objects = [
        { id: 1, name: "E1", type: ObjectType.Infantry, owner, isDestroyed: false, isDisposed: false },
        { id: 2, name: "E2", type: ObjectType.Infantry, owner, isDestroyed: false, isDisposed: false },
        { id: 3, name: "E3", type: ObjectType.Infantry, owner, isDestroyed: false, isDisposed: false },
        { id: 4, name: "E4", type: ObjectType.Infantry, owner: { name: "Other" }, isDestroyed: false, isDisposed: false },
    ];
    const teamSection = section({ House: "Owner", Mission: "Alpha", Max: "1" });
    const context: any = {
        getAllPlayers: () => [owner],
        world: { getAllObjects: () => objects },
        map: {
            mapFile: {
                getSection: (name: string) => name === "alpha" ? teamSection :
                    name === "TeamTypes" ? { entries: new Map([["0", "alpha"]]) } : undefined,
            },
            getInitialMapObjects: () => ({
                technos: [
                    { name: "E1", type: ObjectType.Infantry, rx: 1, ry: 1, rawValues: ["E1", "Owner", "100", "1", "0", "0", "0", "0", "0", "0", "Alpha", "1"] },
                    { name: "E2", type: ObjectType.Infantry, rx: 2, ry: 1, rawValues: ["E2", "Owner", "100", "2", "0", "0", "0", "0", "0", "0", "Alpha", "1"] },
                    { name: "E3", type: ObjectType.Infantry, rx: 3, ry: 1, rawValues: ["E3", "Owner", "100", "3", "0", "0", "0", "0", "0", "0", "Alpha", "1"] },
                    { name: "E4", type: ObjectType.Infantry, rx: 4, ry: 1, rawValues: ["E4", "Other", "100", "4", "0", "0", "0", "0", "0", "0", "Alpha", "1"] },
                ],
            }),
        },
        objects,
    };
    for (const object of objects) object.position = { tile: { rx: object.id, ry: 1 } };
    context.map.getInitialMapObjects = () => ({
        technos: [
            { name: "E1", type: ObjectType.Infantry, rx: 1, ry: 1, rawValues: ["E1", "Owner", "100", "1", "0", "0", "0", "0", "0", "0", "Alpha", "1"] },
            { name: "E2", type: ObjectType.Infantry, rx: 2, ry: 1, rawValues: ["E2", "Owner", "100", "2", "0", "0", "0", "0", "0", "0", "Alpha", "1"] },
            { name: "E3", type: ObjectType.Infantry, rx: 3, ry: 1, rawValues: ["E3", "Owner", "100", "3", "0", "0", "0", "0", "0", "0", "Alpha", "1"] },
            { name: "E4", type: ObjectType.Infantry, rx: 4, ry: 1, rawValues: ["E4", "Other", "100", "4", "0", "0", "0", "0", "0", "0", "Alpha", "1"] },
        ],
    });
    return { context, owner, objects };
}

describe("team runtime", () => {
    test("recruits authored preplaced members once and destroys membership without destroying units", () => {
        const { context, owner, objects } = makeContext();
        const runtime = new TeamRuntime();
        const team = { id: "alpha", section: section({ Mission: "Alpha", Group: "1", Max: "2", Min: "1" }) };
        expect(runtime.recruit(context, team, owner)).toBe(2);
        expect(runtime.getMembers("alpha")).toEqual([1, 2]);
        expect(runtime.recruit(context, team, owner)).toBe(1);
        expect(runtime.getMembers("alpha")).toEqual([1, 2, 3]);
        expect(runtime.destroy("alpha")).toBe(3);
        expect(runtime.getMembers("alpha")).toEqual([]);
        expect(objects.every(object => !object.isDestroyed)).toBe(true);
    });

    test("round-trips and hashes membership state", () => {
        const { context, owner } = makeContext();
        const runtime = new TeamRuntime();
        const team = { id: "alpha", section: section({ Mission: "Alpha", Max: "1" }) };
        runtime.recruit(context, team, owner);
        const state = JSON.parse(JSON.stringify(runtime.captureState()));
        const target = new TeamRuntime();
        target.restoreState(state, { strict: true, resolveObjectById: id => ({ id }) });
        expect(target.getMembers("alpha")).toEqual([1]);
        expect(target.getHash()).toBe(runtime.getHash());
        expect(() => target.restoreState({ ...state, teams: [...state.teams, state.teams[0]] }, { strict: true }))
            .toThrow(/duplicate/i);
    });

    test("action executor uses the runtime and resolves the authored house", () => {
        const { context, owner, objects } = makeContext();
        const runtime = new TeamRuntime();
        context.teamRuntime = runtime;
        const executor = new TeamActionExecutor(
            { params: ["0", "0"] },
            { houseName: "Owner" },
            false,
        );
        executor.execute(context);
        expect(runtime.getMembers("alpha")).toEqual([1]);
        expect(objects[0].owner).toBe(owner);
    });
});
