import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { MapFile } from "@/data/MapFile";
import { CellTagsReader } from "@/data/map/tag/CellTagsReader";
import { TriggerActionType } from "@/data/map/trigger/TriggerActionType";
import { TriggerEventType } from "@/data/map/trigger/TriggerEventType";
import { TriggerReader } from "@/data/map/trigger/TriggerReader";

function section(name: string, entries: Record<string, string> = {}): IniSection {
    const result = new IniSection(name);
    for (const [key, value] of Object.entries(entries)) {
        result.set(key, value);
    }
    return result;
}

class VariableMapFile extends MapFile {
    constructor(private readonly variableSection: IniSection) {
        super();
    }

    override getOrCreateSection(): IniSection {
        return this.variableSection;
    }
}

describe("map trigger readers", () => {
    test("preserves CellTag identifiers as strings", () => {
        const tags = new CellTagsReader().read(section("CellTags", {
            "1003000": "01000300",
        }), 4);
        expect(tags).toEqual([{ tagId: "01000300", coords: { x: 0, y: 1003 } }]);
    });

    test("reads spreadsheet and numeric P7 values without negative conversion artifacts", () => {
        const triggers = section("Triggers", {
            T: "Allied,,Test,0,1,1,1,0",
        });
        const events = section("Events", {
            T: "2,60,2,3,FOO,61,2,0,BAR",
        });
        const actions = section("Actions", {
            T: "3,41,0,0,0,0,0,0,A,115,9,E1,0,0,0,0,30,132,11,SW,0,0,0,0,300",
        });
        const result = new TriggerReader().read(triggers, events, actions, [{
            id: "tag",
            triggerId: "T",
            repeatType: 0,
            name: "Test",
        }]);
        const parsedActions = result.triggers[0].actions;
        expect(parsedActions.map((action: any) => action.params[6])).toEqual([0, 30, 300]);
        expect(parsedActions.map((action: any) => action.type)).toEqual([
            TriggerActionType.PlayAnimAt,
            TriggerActionType.FlashCameo,
            TriggerActionType.SuperweaponSetRechargeTime,
        ]);
        expect(result.triggers[0].events.map((event: any) => event.params)).toEqual([
            [2, "3", "FOO"],
            [2, "0", "BAR"],
        ]);
    });

    test("retains AutocreateBegins as a registered compatibility action", () => {
        const result = new TriggerReader().read(
            section("Triggers", { T: "Allied,,Test,0,1,1,1,0" }),
            section("Events"),
            section("Actions", { T: "1,13,0,Allied,0,0,0,0,0" }),
            [{ id: "tag", triggerId: "T", repeatType: 0, name: "Test" }],
        );
        expect(result.unknownActionTypes.size).toBe(0);
        expect(result.triggers[0].actions[0].type).toBe(TriggerActionType.AutocreateBegins);
    });

    test("decodes A, Z, and AA as zero-based spreadsheet columns", () => {
        const actions = section("Actions", {
            T: "3,41,0,0,0,0,0,0,A,41,0,0,0,0,0,0,Z,41,0,0,0,0,0,0,AA",
        });
        const result = new TriggerReader().read(
            section("Triggers", { T: "Allied,,Test,0,1,1,1,0" }),
            section("Events"),
            actions,
            [{ id: "tag", triggerId: "T", repeatType: 0, name: "Test" }],
        );
        expect(result.triggers[0].actions.map((action: any) => action.params[6])).toEqual([0, 25, 26]);
    });

    test("uses the VariableNames second field only as scope", () => {
        const mapFile = new VariableMapFile(section("VariableNames", {
            0: "CampaignFlag,1",
            1: "MissionFlag,0",
        }));
        mapFile.readVariableNames();
        expect(mapFile.variables.get(0)).toMatchObject({
            name: "CampaignFlag",
            value: false,
            isGlobal: true,
        });
        expect(mapFile.variables.get(1)).toMatchObject({
            name: "MissionFlag",
            value: false,
            isGlobal: false,
        });
    });

    test("decodes Set Object Tech Level parameters from map syntax", () => {
        const actions = section("Actions", {
            T: "3,106,9,E1,0,0,0,0,AA,106,9,VEH,0,0,0,0,-1,106,9,APOC,0,0,0,0,5",
        });
        const result = new TriggerReader().read(
            section("Triggers", { T: "Allied,,Test,0,1,1,1,0" }),
            section("Events"),
            actions,
            [{ id: "tag", triggerId: "T", repeatType: 0, name: "Test" }],
        );
        expect(result.triggers[0].actions.map((entry: any) => entry.params)).toEqual([
            [9, "E1", "0", "0", "0", "0", 26],
            [9, "VEH", "0", "0", "0", "0", -1],
            [9, "APOC", "0", "0", "0", "0", 5],
        ]);
    });

    test("rejects invalid Set Object Tech Level P7 values", () => {
        const reader = new TriggerReader();
        for (const value of ["-2", "1.5", "A1", "?"]) {
            const actions = section("Actions", {
                T: `1,106,9,E1,0,0,0,0,${value}`,
            });
            expect(() => reader.read(
                section("Triggers", { T: "Allied,,Test,0,1,1,1,0" }),
                section("Events"),
                actions,
                [{ id: "tag", triggerId: "T", repeatType: 0, name: "Test" }],
            )).toThrow(/P7 tech level/);
        }
    });

    test("registers the requested YR event and action IDs", () => {
        expect([
            TriggerEventType.DiscoveredByPlayer,
            TriggerEventType.HouseDiscovered,
            TriggerEventType.ObjectLost,
            TriggerEventType.ObjectSelected,
            TriggerEventType.EnteredOrOverflownBy,
            TriggerEventType.TechTypeExists,
            TriggerEventType.TechTypeDoesNotExist,
        ]).toEqual([4, 5, 29, 33, 59, 60, 61]);
        expect([
            TriggerActionType.Win,
            TriggerActionType.Lose,
            TriggerActionType.ProductionBegins,
            TriggerActionType.CreateTeam,
            TriggerActionType.DestroyTeam,
            TriggerActionType.AllToHunt,
            TriggerActionType.Reinforcement,
            TriggerActionType.DropZoneFlare,
            TriggerActionType.AutocreateBegins,
            TriggerActionType.PlayMusicTheme,
            TriggerActionType.MakeAlly,
            TriggerActionType.MakeEnemy,
            TriggerActionType.PlayAnimAt,
            TriggerActionType.LockInput,
            TriggerActionType.UnlockInput,
            TriggerActionType.CenterCameraAtWaypoint,
            TriggerActionType.AITriggersBegin,
            TriggerActionType.AITriggersStop,
            TriggerActionType.ReinforcementAtWaypoint,
            TriggerActionType.SetObjectTechLevel,
            TriggerActionType.SetSidebarTab,
            TriggerActionType.FlashCameo,
            TriggerActionType.DestroyAll,
            TriggerActionType.CreateBuildingAt,
            TriggerActionType.SuperweaponSetRechargeTime,
            TriggerActionType.SuperweaponReset,
            TriggerActionType.SetBaseCenterCell,
        ]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 13, 20, 37, 38, 41, 46, 47, 48, 74, 75, 80, 106, 114, 115, 119, 125, 132, 134, 137]);
    });
});
