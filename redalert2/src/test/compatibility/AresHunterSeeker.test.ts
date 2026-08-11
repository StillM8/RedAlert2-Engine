import { describe, expect, test } from "bun:test";
import { IniFile, IniSection } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import {
    aresHunterSeekerBuildingMatches,
    resolveAresHunterSeekerConfiguration,
    selectAresHunterSeekerLaunchBuildings,
    selectAresHunterSeekerTarget,
} from "@/extensions/ares/AresHunterSeeker";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { TechnoRules } from "@/game/rules/TechnoRules";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { AresHunterSeekerTrait } from "@/game/gameobject/trait/AresHunterSeekerTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";

function makeTile(rx: number, ry: number): any {
    return { rx, ry, z: 0 };
}

describe("Ares Hunter Seeker", () => {
    test("resolves per-superweapon, side, global, and MaxCount configuration", () => {
        const ini = new IniFile(`
[SeekerSW]
Type=HunterSeeker
HunterSeeker.Type=HSPLANE
HunterSeeker.Buildings=HSBUILD,HSBUILD2
HunterSeeker.RandomOnly=yes
SW.MaxCount=-1
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("SeekerSW")!);
        const configuration = resolveAresHunterSeekerConfiguration(definition!, {
            hunterSeekerBuildings: ["GLOBAL"],
            hunterSeekerDetonateProximity: 4,
            hunterSeekerDescendProximity: 8,
            hunterSeekerAscentSpeed: 2,
            hunterSeekerDescentSpeed: 3,
            hunterSeekerEmergeSpeed: 4,
        }, { hunterSeeker: "SIDEPLANE" });

        expect(configuration).toEqual({
            typeName: "HSPLANE",
            buildingTypes: ["HSBUILD", "HSBUILD2"],
            randomOnly: true,
            maxCount: -1,
            detonateProximity: 4,
            descendProximity: 8,
            ascentSpeed: 2,
            descentSpeed: 3,
            emergeSpeed: 4,
        });

        const fallback = resolveAresHunterSeekerConfiguration({
            hunterSeekerBuildings: undefined,
            hunterSeekerType: undefined,
            hunterSeekerRandomOnly: undefined,
            swMaxCount: undefined,
        }, { hunterSeekerBuildings: ["GLOBAL"] }, { hunterSeeker: "SIDEPLANE" });
        expect(fallback.typeName).toBe("SIDEPLANE");
        expect(fallback.buildingTypes).toEqual(["GLOBAL"]);
        expect(fallback.maxCount).toBe(1);
    });

    test("selects only configured launch buildings in deterministic ID order", () => {
        const owner = {};
        const buildings = [
            { id: 8, name: "HSBUILD", owner, isSpawned: true, isDestroyed: false, isBuilding: () => true },
            { id: 2, name: "HSBUILD2", owner, isSpawned: true, isDestroyed: false, isBuilding: () => true },
            { id: 1, name: "OTHER", owner, isSpawned: true, isDestroyed: false, isBuilding: () => true },
            { id: 0, name: "HSBUILD", owner, isSpawned: false, isDestroyed: false, isBuilding: () => true },
        ];

        expect(aresHunterSeekerBuildingMatches(buildings[0], ["hsbuild"])).toBe(true);
        expect(selectAresHunterSeekerLaunchBuildings(buildings, ["HSBUILD", "HSBUILD2"], 1).map(building => building.id)).toEqual([2]);
        expect(selectAresHunterSeekerLaunchBuildings(buildings, ["HSBUILD", "HSBUILD2"], -1).map(building => building.id)).toEqual([2, 8]);
    });

    test("prefers non-passive enemies unless RandomOnly is enabled", () => {
        const owner = { id: "owner" };
        const enemy = (id: number, passive: boolean) => ({
            id,
            owner: { id: `enemy-${id}` },
            passive,
            isTechno: () => true,
            isSpawned: true,
            isDestroyed: false,
            isCrashing: false,
            rules: { legalTarget: true, passive },
        });
        const passive = enemy(1, true);
        const active = enemy(2, false);
        const game = {
            alliances: { areAllied: () => false },
            isValidTarget: () => true,
            generateRandomInt: () => 0,
        };
        expect(selectAresHunterSeekerTarget({ owner, objects: [passive, active], game })).toBe(active);
        expect(selectAresHunterSeekerTarget({ owner, objects: [passive, active], game, randomOnly: true })).toBe(passive);
    });

    test("parses per-aircraft Hunter Seeker controls", () => {
        const section = new IniSection("HunterSeekerAircraft");
        section.set("HunterSeeker.DetonateProximity", "5");
        section.set("HunterSeeker.DescendProximity", "9");
        section.set("HunterSeeker.AscentSpeed", "2");
        section.set("HunterSeeker.DescentSpeed", "3");
        section.set("HunterSeeker.EmergeSpeed", "4");
        section.set("HunterSeeker.Ignore", "yes");
        const rules = new TechnoRules(ObjectType.Aircraft, section, 0, {}, new ArmorRegistry());
        expect(rules.hunterSeekerDetonateProximity).toBe(5);
        expect(rules.hunterSeekerDescendProximity).toBe(9);
        expect(rules.hunterSeekerAscentSpeed).toBe(2);
        expect(rules.hunterSeekerDescentSpeed).toBe(3);
        expect(rules.hunterSeekerEmergeSpeed).toBe(4);
        expect(rules.hunterSeekerIgnore).toBe(true);
    });

    test("detonates a data-defined aircraft weapon at proximity and destroys the seeker", () => {
        const owner = { id: "owner" };
        const enemy = {
            id: 2,
            owner: { id: "enemy" },
            tile: makeTile(4, 4),
            position: { tileElevation: 0, worldPosition: { clone: () => ({}) } },
            zone: 0,
            isTechno: () => true,
            isBuilding: () => false,
            isSpawned: true,
            isDestroyed: false,
            isCrashing: false,
            rules: { legalTarget: true },
        };
        const detonationCalls: any[] = [];
        const seeker: any = {
            id: 1,
            owner,
            tile: makeTile(4, 4),
            isSpawned: true,
            isDestroyed: false,
            isCrashing: false,
            rules: { hunterSeekerIgnore: false },
            primaryWeapon: {
                rules: { damage: 300 },
                warhead: { detonate: (...args: any[]) => detonationCalls.push(args) },
            },
            unitOrderTrait: {
                getCurrentTask: () => undefined,
                cancelAllTasks: () => undefined,
                addTask: () => undefined,
            },
        };
        const game: any = {
            alliances: { areAllied: () => false },
            isValidTarget: () => true,
            generateRandomInt: () => 0,
            getWorld: () => ({ getAllObjects: () => [seeker, enemy] }),
            map: { getTileZone: () => 0 },
            createTarget: (object: any, tile: any) => ({ obj: object, tile }),
            destroyObject: (object: any) => { object.isDestroyed = true; },
        };
        const trait = new AresHunterSeekerTrait({
            randomOnly: false,
            affectsHouse: "Enemies",
            detonateProximity: 1,
            descendProximity: 0,
            ascentSpeed: 0,
            descentSpeed: 0,
            emergeSpeed: 0,
        });

        trait[NotifyTick.onTick](seeker, game);
        expect(detonationCalls).toHaveLength(1);
        expect(detonationCalls[0][1]).toBe(300);
        expect(seeker.isDestroyed).toBe(true);
    });

    test("scanner reports Hunter Seeker fields separately", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: `
[General]
HunterSeekerDetonateProximity=4
[SpecialWeapons]
HSBuilding=HSBUILD
[Epsilon]
HunterSeeker=HSPLANE
[SeekerSW]
Type=HunterSeeker
HunterSeeker.Type=HSPLANE
HunterSeeker.Buildings=HSBUILD
[HSPLANE]
HunterSeeker.Ignore=yes
`,
        }]);
        const usage = report.featureUsage.find(item => item.featureId === "ares.superweapon-hunter-seeker");
        expect(usage?.occurrences).toBeGreaterThanOrEqual(6);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);

        const sideOnlyReport = scanMentalOmegaIniSources([{
            name: "side-rules.ini",
            contents: "[FifthSide]\nHunterSeeker=HSPLANE\n",
        }]);
        expect(sideOnlyReport.featureUsage.some(item => item.featureId === "ares.superweapon-hunter-seeker")).toBe(true);
    });
});
