import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import {
    applyAresDropPodVeterancy,
    DropPodEffect,
    resolveAresDropPodPresentation,
    resolveAresDropPodConfiguration,
} from "@/game/superweapon/DropPodEffect";
import { GeneralRules } from "@/game/rules/GeneralRules";
import { SpeedType } from "@/game/type/SpeedType";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";

interface Definition {
    type: ObjectType;
    infantry?: boolean;
    aircraft?: boolean;
}

function makePlayer(id: string): any {
    return {
        country: { id, name: id, sideId: id },
        owned: [],
        addOwnedObject(object: any) {
            this.owned.push(object);
            object.owner = this;
        },
        removeOwnedObject(object: any) {
            this.owned = this.owned.filter((owned: any) => owned !== object);
            if (object.owner === this) object.owner = undefined;
        },
    };
}

function makeTile(rx: number, ry: number): any {
    return { rx, ry, dx: rx, dy: ry, z: 0, onBridgeLandType: undefined };
}

function makeGame(
    definitions: Record<string, Definition>,
    randomValues: number[],
    passable: (tile: any) => boolean = () => true,
): any {
    const owner = makePlayer("Alpha");
    const spawned: any[] = [];
    const calls: number[][] = [];
    const rules: any = {
        general: {
            flightLevel: 7,
            dropPodTypes: [],
            dropPodMinimum: 0,
            dropPodMaximum: 0,
            veteran: { veteranCap: VeteranLevel.Elite },
        },
        hasObject(name: string, type: ObjectType) {
            return definitions[name]?.type === type;
        },
        getObject(name: string) {
            return definitions[name];
        },
    };
    const map: any = {
        tiles: { getByMapCoords: (rx: number, ry: number) => makeTile(rx, ry) },
        mapBounds: { isWithinBounds: () => true },
        tileOccupation: {
            calculateTilesForGameObject(tile: any) {
                return [tile];
            },
        },
        terrain: {
            getPassableSpeed: (tile: any) => passable(tile) ? 1 : 0,
            findObstacles: () => [],
        },
        getGroundObjectsOnTile(tile: any) {
            return spawned.filter((object) => object.tile?.rx === tile.rx && object.tile?.ry === tile.ry);
        },
    };
    return {
        rules,
        map,
        spawned,
        owner,
        calls,
        generateRandomInt(min: number, max: number) {
            calls.push([min, max]);
            return randomValues.length ? randomValues.shift()! : min;
        },
        createObject(type: ObjectType, name: string) {
            const definition = definitions[name];
            const veteranTrait: any = {
                veteranLevel: VeteranLevel.None,
                relativeXp: 0,
                setRelativeXP(value: number) {
                    this.relativeXp += value;
                    this.veteranLevel = Math.min(VeteranLevel.Elite, Math.floor(this.relativeXp));
                },
            };
            return {
                name,
                type,
                rules: {
                    speedType: SpeedType.Track,
                    flightLevel: 9,
                },
                position: { tileElevation: 0, desiredSubCell: 0, subCell: 0 },
                veteranTrait,
                isSpawned: false,
                isBuilding: () => type === ObjectType.Building,
                isInfantry: () => definition.infantry === true,
                isVehicle: () => type === ObjectType.Vehicle,
                isAircraft: () => definition.aircraft === true,
                isUnit: () => type !== ObjectType.Building,
                getFoundation: () => ({ width: 1, height: 1 }),
                dispose() {
                    this.disposed = true;
                },
            };
        },
        changeObjectOwner(object: any, player: any) {
            player.addOwnedObject(object);
        },
        spawnObject(object: any, tile: any) {
            object.tile = tile;
            object.isSpawned = true;
            spawned.push(object);
        },
    };
}

describe("Ares DropPod", () => {
    test("resolves the per-superweapon impact weapon and global trailer fallback", () => {
        expect(resolveAresDropPodPresentation({
            dropPodWeapon: "NotAWeapon",
            dropPodTrailer: undefined,
        }, {
            dropPodWeapon: "DropPodImpact",
            dropPodTrailer: "CUSTOM_SMOKE",
        })).toEqual({
            weaponName: "DropPodImpact",
            trailerAnimation: "CUSTOM_SMOKE",
        });

        expect(resolveAresDropPodPresentation({
            dropPodWeapon: undefined,
            dropPodTrailer: "none",
        }, {})).toEqual({
            weaponName: undefined,
            trailerAnimation: "SMOKEY",
        });
    });

    test("resolves local overrides, global fallbacks, inclusive bounds, and Antares default veterancy", () => {
        expect(resolveAresDropPodConfiguration({
            dropPodTypes: [],
            dropPodMinimum: undefined,
            dropPodMaximum: undefined,
            dropPodVeterancy: undefined,
        }, {
            dropPodTypes: [" E1 ", "E2"],
            dropPodMinimum: 2,
            dropPodMaximum: 4,
            veteran: { veteranCap: VeteranLevel.Elite },
        })).toEqual({
            types: ["E1", "E2"],
            minimum: 2,
            maximum: 4,
            veterancy: VeteranLevel.Elite,
        });

        expect(resolveAresDropPodConfiguration({
            dropPodTypes: ["E3"],
            dropPodMinimum: 5,
            dropPodMaximum: 3,
            dropPodVeterancy: 1.5,
        }, {
            dropPodTypes: ["E1"],
            dropPodMinimum: 1,
            dropPodMaximum: 1,
            veteran: { veteranCap: VeteranLevel.Elite },
        })).toMatchObject({
            types: ["E3"],
            minimum: 5,
            maximum: 5,
            veterancy: 1.5,
        });
    });

    test("reads global DropPod settings through GeneralRules", () => {
        const ini = new IniFile(`
[General]
DropPodTypes=E1,E2
DropPodMinimum=2
DropPodMaximum=4
DropPodTrailer=SMOKEY
ParadropPlane=PDPLANE
PrerequisitePower=POWER
PrerequisiteFactory=FACTORY
PrerequisiteBarracks=BARRACKS
PrerequisiteRadar=RADAR
PrerequisiteTech=TECH
PrerequisiteProc=PROC
`);
        const rules = new GeneralRules();
        rules.readIni(ini.getSection("General") as any);

        expect(rules.dropPodTypes).toEqual(["E1", "E2"]);
        expect(rules.dropPodMinimum).toBe(2);
        expect(rules.dropPodMaximum).toBe(4);
        expect(rules.dropPodTrailer).toBe("SMOKEY");
    });

    test("selects a deterministic inclusive count/type and preserves fractional veterancy", () => {
        const game = makeGame({ E1: { type: ObjectType.Infantry, infantry: true }, E2: { type: ObjectType.Infantry, infantry: true } }, [2, 1, 1]);
        const effect = new DropPodEffect("DropPod", game.owner, makeTile(5, 5), {
            typeId: "DropPod",
            extensionType: "DropPod",
            dropPodTypes: ["E1", "E2"],
            dropPodMinimum: 2,
            dropPodMaximum: 2,
            dropPodVeterancy: 1.5,
            extensionEntries: new Map(),
        });

        expect(effect.onTick(game)).toBe(true);
        expect(game.spawned.map((object: any) => object.name)).toEqual(["E2", "E2"]);
        expect(game.spawned.every((object: any) => object.owner === game.owner)).toBe(true);
        expect(game.spawned.every((object: any) => object.dropPodState.phase === "landed")).toBe(true);
        expect(game.spawned.map((object: any) => object.veteranTrait.relativeXp)).toEqual([1.5, 1.5]);
        expect(game.calls).toEqual([[2, 2], [0, 1], [0, 1]]);
    });

    test("skips a randomly selected non-infantry type", () => {
        const game = makeGame({
            BASE: { type: ObjectType.Building },
        }, [0]);
        const effect = new DropPodEffect("DropPod", game.owner, makeTile(3, 3), {
            typeId: "DropPod",
            extensionType: "DropPod",
            dropPodTypes: ["BASE"],
            dropPodMinimum: 1,
            dropPodMaximum: 1,
            dropPodVeterancy: 2,
            extensionEntries: new Map(),
        });

        effect.onTick(game);
        expect(game.spawned).toHaveLength(0);
    });

    test("cleans up a created unit when no landing cell is available", () => {
        const game = makeGame({ E1: { type: ObjectType.Infantry, infantry: true } }, [1, 0, 0, 0], () => false);
        const effect = new DropPodEffect("DropPod", game.owner, makeTile(3, 3), {
            typeId: "DropPod",
            extensionType: "DropPod",
            dropPodTypes: ["E1"],
            dropPodMinimum: 1,
            dropPodMaximum: 1,
            dropPodVeterancy: 2,
            extensionEntries: new Map(),
        });

        effect.onTick(game);
        expect(game.spawned).toHaveLength(0);
        expect(game.owner.owned).toHaveLength(0);
    });

    test("applies a requested veteran level only when it is higher", () => {
        const object: any = {
            veteranTrait: {
                veteranLevel: VeteranLevel.Veteran,
                setRelativeXP(value: number) {
                    this.value = value;
                },
            },
        };
        applyAresDropPodVeterancy(object, 1.5, VeteranLevel.Elite);
        expect(object.veteranTrait.value).toBe(0.5);
        applyAresDropPodVeterancy(object, 1, VeteranLevel.Elite);
        expect(object.veteranTrait.value).toBe(0.5);
    });

    test("reports DropPod keys as a distinct compatibility capability", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: `[General]\nDropPodTypes=E1\n[Pods]\nType=DropPod\nDropPod.Minimum=1\nDropPod.Maximum=2\n`,
        }]);
        const usage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-drop-pod");
        expect(usage?.occurrences).toBe(4);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });
});
