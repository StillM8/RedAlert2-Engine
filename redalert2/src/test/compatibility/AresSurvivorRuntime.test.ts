import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { CrewedTrait } from "@/game/gameobject/trait/CrewedTrait";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { NotifyCrash } from "@/game/gameobject/trait/interface/NotifyCrash";
import { ScatterTask } from "@/game/gameobject/task/ScatterTask";
import { ParadropTask } from "@/game/gameobject/task/ParadropTask";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { SideType } from "@/game/SideType";

function survivorRules(entries: Record<string, string>): any {
    const ini = new IniSection("TRANSPORT");
    for (const [key, value] of Object.entries(entries)) ini.set(key, value);
    return { ini, crewed: false };
}

function makeHarness(airborne = false): any {
    const target: any = {
        name: airborne ? "AIRTRANS" : "GROUNDTRANS",
        veteranLevel: VeteranLevel.Veteran,
        veteranTrait: { xp: 77 },
        rules: survivorRules({
            "Survivor.PilotCount": "1",
            "Survivor.VeteranPilotChance": "100",
            "Survivor.Side0": "PILOT",
        }),
        owner: {
            country: { side: SideType.GDI, sideDefinition: { order: 0, crew: "E1" } },
        },
        tile: { rx: 10, ry: 20, onBridgeLandType: false },
        position: { tileElevation: airborne ? 6 : 0 },
        zone: airborne ? ZoneType.Air : ZoneType.Ground,
        onBridge: false,
        isDestroyed: true,
        isVehicle: () => !airborne,
        isAircraft: () => airborne,
    };
    const tasks: any[] = [];
    const pilot: any = {
        name: "PILOT",
        rules: { name: "PILOT" },
        position: { subCell: -1, tileElevation: 0 },
        zone: ZoneType.Ground,
        onBridge: false,
        healthTrait: { health: 100 },
        veteranTrait: {
            copiedLevel: undefined,
            xp: 0,
            setRankFromTransport(level: VeteranLevel) {
                this.copiedLevel = level;
                this.xp = 0;
            },
        },
        unitOrderTrait: { addTask: (task: any) => tasks.push(task) },
        isInfantry: () => true,
    };
    const spawned: any[] = [];
    const context: any = {
        rules: {
            general: {
                crew: {
                    crewEscape: 0.5,
                    alliedCrew: "E1",
                    alliedSurvivorDivisor: 100,
                    sovietCrew: "E2",
                    sovietSurvivorDivisor: 100,
                },
            },
            getObject: (name: string, type: ObjectType) => {
                expect(name).toBe("PILOT");
                expect(type).toBe(ObjectType.Infantry);
                return { type: ObjectType.Infantry, name, speedType: 1 };
            },
        },
        map: {
            isWithinBounds: () => true,
            tileOccupation: { getBridgeOnTile: () => undefined },
            terrain: { getPassableSpeed: () => 1 },
            getGroundObjectsOnTile: () => [target],
            getTileZone: () => ZoneType.Ground,
        },
        generateRandomInt: () => 0,
        createUnitForPlayer: () => pilot,
        spawnObject: (unit: any, tile: any) => spawned.push({ unit, tile }),
        events: { dispatch: () => undefined },
        addObjectTrait: () => undefined,
        areFriendly: () => false,
    };
    return { target, pilot, tasks, spawned, context };
}

describe("Ares survivor runtime", () => {
    test("ground destruction spawns a 50%-health pilot with inherited veterancy", () => {
        const { target, pilot, tasks, spawned, context } = makeHarness(false);
        const trait = new CrewedTrait(true);
        trait[NotifyDestroy.onDestroy](target, context, { obj: { id: 99 } }, false);

        expect(spawned).toHaveLength(1);
        expect(spawned[0].tile).toBe(target.tile);
        expect(pilot.healthTrait.health).toBe(50);
        expect(pilot.veteranTrait.copiedLevel).toBe(VeteranLevel.Veteran);
        expect(pilot.veteranTrait.xp).toBe(77);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toBeInstanceOf(ScatterTask);
    });

    test("aircraft crash resolves pilots once and assigns ParadropTask", () => {
        const { target, pilot, tasks, spawned, context } = makeHarness(true);
        const trait = new CrewedTrait(true);
        trait[NotifyCrash.onCrash](target, context, { obj: { id: 99 } });
        trait[NotifyDestroy.onDestroy](target, context, { obj: { id: 99 } }, false);

        expect(spawned).toHaveLength(1);
        expect(pilot.healthTrait.health).toBe(50);
        expect(pilot.position.tileElevation).toBe(6);
        expect(pilot.zone).toBe(ZoneType.Air);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toBeInstanceOf(ParadropTask);
    });

    test("PilotChance=0 does not instantiate a virtual pilot casualty", () => {
        const { target, spawned, context } = makeHarness(false);
        target.rules = survivorRules({
            "Survivor.PilotCount": "2",
            "Survivor.VeteranPilotChance": "0",
        });
        const trait = new CrewedTrait(true);
        trait[NotifyDestroy.onDestroy](target, context, { obj: { id: 99 } }, false);
        expect(spawned).toHaveLength(0);
    });
});
