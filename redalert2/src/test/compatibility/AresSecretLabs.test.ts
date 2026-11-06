import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import {
    getAresSecretLabRulesHash,
    isAresSecretLabHouseEligible,
    parseAresSecretLabBoon,
    parseAresSecretLabRules,
    sortAresSecretLabBoons,
    validateAresSecretLabRules,
} from "@/extensions/ares/AresSecretLabs";
import { AresSecretLabService } from "@/extensions/ares/AresSecretLabRuntime";

/**
 * Ares `SecretLab`: a capturable building that pays the capturing house a
 * randomly chosen bonus. The payout rolls from the shared PRNG, so it is
 * canonical state rather than cosmetic.
 */

describe("Ares SecretLab rules", () => {
    test("parses boons, the capture toggle, and house restrictions", () => {
        const ini = new IniFile(`
[General]
SecretLab.PossibleBoons=Money:25000,Infantry:E1,Vehicle:MTank,Aircraft:Hawk,Building:RAI,Reveal
SecretLab.GenerateOnCapture=no
Secret.RequiredHouses=Allies,Third
Secret.ForbiddenHouses=Nod
`);
        const rules = parseAresSecretLabRules(ini.getSection("General")!);

        expect(rules.generateOnCapture).toBe(false);
        expect(rules.requiredHouses).toEqual(["allies", "third"]);
        expect(rules.forbiddenHouses).toEqual(["nod"]);
        expect(rules.boons.map(boon => boon.kind)).toEqual([
            "money", "infantry", "vehicle", "aircraft", "building", "reveal",
        ]);
        expect(rules.boons[0].number).toBe(25000);
    });

    test("GenerateOnCapture defaults to yes", () => {
        const ini = new IniFile("[General]\nSecretLab.PossibleBoons=Money\n");
        expect(parseAresSecretLabRules(ini.getSection("General")!).generateOnCapture).toBe(true);
    });

    test("a bare number is a money amount", () => {
        const boon = parseAresSecretLabBoon("15000");
        expect(boon.kind).toBe("money");
        expect(boon.number).toBe(15000);
    });

    test("kind matching is case-insensitive and unknown kinds stay diagnosable", () => {
        expect(parseAresSecretLabBoon("INFANTRY:GHOST").kind).toBe("infantry");
        const unknown = parseAresSecretLabBoon("PsyUpgrade:Foo");
        expect(unknown.kind).toBe("unknown");
        expect(unknown.rawKind).toBe("PsyUpgrade");
        expect(unknown.argument).toBe("Foo");
    });

    test("Unit resolves against any object kind", () => {
        expect(parseAresSecretLabBoon("Unit:GI").kind).toBe("unit");
    });

    test("house eligibility: forbidden wins, empty required allows all", () => {
        const open = parseAresSecretLabRules(new IniFile("[General]").getSection("General")!);
        expect(isAresSecretLabHouseEligible(open, ["Nod"])).toBe(true);

        const restricted = parseAresSecretLabRules(
            new IniFile("[General]\nSecret.RequiredHouses=Allies\nSecret.ForbiddenHouses=Allies\n")
                .getSection("General")!,
        );
        expect(isAresSecretLabHouseEligible(restricted, ["Allied House"])).toBe(false);
        expect(isAresSecretLabHouseEligible(restricted, ["Soviet House"])).toBe(false);
    });

    test("canonical ordering is stable and feeds a stable hash", () => {
        const a = parseAresSecretLabBoon("Vehicle:Apocalypse");
        const b = parseAresSecretLabBoon("Infantry:Gi");
        const forward = sortAresSecretLabBoons([a, b]);
        const reverse = sortAresSecretLabBoons([b, a]);
        expect(forward.map(boon => boon.id)).toEqual(reverse.map(boon => boon.id));
        expect(getAresSecretLabRulesHash({
            boons: [a, b], generateOnCapture: true, requiredHouses: [], forbiddenHouses: [],
        })).toBe(getAresSecretLabRulesHash({
            boons: [b, a], generateOnCapture: true, requiredHouses: [], forbiddenHouses: [],
        }));
    });

    test("rejects a malformed rules state", () => {
        expect(() => validateAresSecretLabRules(null)).toThrow();
        expect(() => validateAresSecretLabRules({ boons: "no", generateOnCapture: true, requiredHouses: [], forbiddenHouses: [] })).toThrow();
        expect(() => validateAresSecretLabRules({
            boons: [{ id: "", rawKind: "Money", argument: "1" }],
            generateOnCapture: true,
            requiredHouses: [],
            forbiddenHouses: [],
        })).toThrow();
    });
});

function makeLabService(boonCount = 3, seed = 42, deliverable = true) {
    const spawned: any[] = [];
    let random = seed;
    const tiles: any[] = [];
    for (let rx = 0; rx < 6; rx++) {
        for (let ry = 0; ry < 6; ry++) {
            tiles.push({ rx, ry, z: 0, rampType: 0, landType: 0, objects: [] });
        }
    }
    const building = {
        id: 7,
        isBuilding: () => true,
        isDestroyed: false,
        isSpawned: true,
        rules: { secretLab: true, foundation: { width: 1, height: 1 } },
        centerTile: tiles.find(t => t.rx === 3 && t.ry === 3),
        tile: tiles.find(t => t.rx === 3 && t.ry === 3),
    };
    const owner: any = {
        houseName: "Allied House",
        playerListIndex: 1,
        credits: 0,
    };
    const game: any = {
        generateRandomInt: (min: number, max: number) => {
            random = (random * 1664525 + 1013904223) >>> 0;
            return min + Math.floor((random >>> 8) / 0x1000000 * (max - min + 1));
        },
        map: {
            tiles: { getByMapCoords: (rx: number, ry: number) => tiles.find(t => t.rx === rx && t.ry === ry) },
            tileOccupation: {
                getObjectsOnTile: () => [],
                getGroundObjectsOnTile: () => [],
                getBridgeOnTile: () => undefined,
                calculateTilesForGameObject: (tile: any) => (tile ? [tile] : []),
            },
            getGroundObjectsOnTile: () => [],
            mapBounds: {
                isWithinBounds: (tile: any) => !!tile,
                isWithinHardBounds: (tile: any) => !!tile,
                clampToMap: (tile: any) => tile,
            },
        },
        rules: {
            getObject: (name: string, type: number) =>
                (name.startsWith("GI") && type === ObjectType.Infantry)
                    ? { name, type }
                    : undefined,
        },
        createUnitForPlayer: (rules: any, forOwner: any) => ({
            id: 100 + spawned.length,
            name: rules.name,
            owner: forOwner,
            isSpawned: false,
            isInfantry: () => true,
            isBuilding: () => false,
            isAircraft: () => false,
            isVehicle: () => false,
            art: { foundation: { width: 1, height: 1 } },
        }),
        spawnObject: (object: any) => {
            object.isSpawned = true;
            spawned.push(object);
        },
        events: { dispatch: () => undefined },
        world: { getObjectById: (id: number) => (id === building.id ? building : undefined) },
    };
    if (!deliverable) {
        // An object that fits nowhere: the placement finder rejects every cell.
        game.map.tileOccupation.calculateTilesForGameObject = () => [];
    }
    const service = new AresSecretLabService(game);
    const rules = {
        boons: Array.from({ length: boonCount }, (_, index) => parseAresSecretLabBoon(`Infantry:GI${index}`)),
        generateOnCapture: true,
        requiredHouses: [],
        forbiddenHouses: [],
    };
    return { service, rules, building, owner, spawned, game };
}

describe("Ares SecretLab runtime", () => {
    test("grants a rolled boon and records it as canonical state", () => {
        const { service, rules, building, owner, spawned } = makeLabService(3, 7);
        const grant = service.grant(rules, building, owner)!;

        expect(grant).toBeDefined();
        expect(grant.buildingId).toBe(7);
        expect(grant.ownerIndex).toBe(1);
        expect(grant.delivered).toBe(true);
        expect(rules.boons.map(boon => boon.id)).toContain(grant.boonId);
        expect(spawned).toHaveLength(1);
        expect(spawned[0].isSpawned).toBe(true);
        expect(service.getHash()).not.toBe(0);
    });

    test("an undeliverable payout is still a canonical roll and is flagged", () => {
        const { service, rules, building, owner, spawned } = makeLabService(2, 7, false);
        const grant = service.grant(rules, building, owner)!;

        // The PRNG was consumed, so the sequence stays in lockstep with a peer
        // that did find a cell; the payout being dropped stays visible.
        expect(grant.delivered).toBe(false);
        expect(spawned).toHaveLength(0);
        expect(service.captureState().grants).toHaveLength(1);
    });

    test("the same seed produces the same payout sequence", () => {
        const a = makeLabService(4, 99);
        const b = makeLabService(4, 99);
        const first = [a.service.grant(a.rules, a.building, a.owner)!, a.service.grant(a.rules, a.building, a.owner)!];
        const second = [b.service.grant(b.rules, b.building, b.owner)!, b.service.grant(b.rules, b.building, b.owner)!];
        expect(first.map(g => g.boonId)).toEqual(second.map(g => g.boonId));
        expect(a.service.getHash()).toBe(b.service.getHash());
    });

    test("a money boon credits the capturer", () => {
        const { service, building, owner } = makeLabService();
        service.grant({
            boons: [parseAresSecretLabBoon("Money:5000")],
            generateOnCapture: true,
            requiredHouses: [],
            forbiddenHouses: [],
        }, building, owner);
        expect(owner.credits).toBe(5000);
    });

    test("an ineligible house never rolls", () => {
        const { service, building, owner, spawned } = makeLabService();
        const rules = {
            boons: [parseAresSecretLabBoon("Money:1")],
            generateOnCapture: true,
            requiredHouses: ["soviet"],
            forbiddenHouses: [],
        };
        expect(service.isEligible(rules, building, owner)).toBe(false);
        const before = service.getHash();
        // Eligibility is enforced by grant() itself, so a call site cannot
        // bypass the house restriction.
        expect(service.grant(rules, building, owner)).toBeUndefined();
        expect(service.getHash()).toBe(before);
        expect(spawned).toHaveLength(0);
        expect(owner.credits).toBe(0);
    });

    test("a destroyed or non-secret-lab building is not eligible", () => {
        const { service, building, owner } = makeLabService();
        const rules = {
            boons: [parseAresSecretLabBoon("Money:1")],
            generateOnCapture: true,
            requiredHouses: [],
            forbiddenHouses: [],
        };
        expect(service.isEligible(rules, { ...building, isDestroyed: true }, owner)).toBe(false);
        expect(service.isEligible(rules, { ...building, isBuilding: () => false }, owner)).toBe(false);
    });

    test("state round-trips and rejects an unresolved building in strict mode", () => {
        const { service, rules, building, owner, game } = makeLabService();
        service.grant(rules, building, owner);
        const state = JSON.parse(JSON.stringify(service.captureState()));

        const target = new AresSecretLabService(game);
        target.restoreState(state, { strict: true });
        expect(target.getHash()).toBe(service.getHash());
        expect(target.captureState().nextBoonSerial).toBe(2);

        game.world = { getObjectById: () => undefined };
        const orphan = { ...state, nextBoonSerial: 3 };
        expect(() => target.restoreState(orphan, { strict: true })).toThrow(/unresolved/);
        // Permissive restore accepts it without a live building reference.
        target.restoreState(orphan);
        expect(target.captureState().nextBoonSerial).toBe(3);
    });

    test("rejects duplicate serials and malformed state", () => {
        const service = new AresSecretLabService({} as any);
        expect(() => service.validateState(null)).toThrow();
        expect(() => service.validateState({ version: 1, nextBoonSerial: 0, grants: [] })).toThrow();
        expect(() => service.validateState({
            version: 1,
            nextBoonSerial: 2,
            grants: [
                { serial: 1, buildingId: 1, ownerIndex: 0, boonId: "money:1" },
                { serial: 1, buildingId: 2, ownerIndex: 0, boonId: "money:1" },
            ],
        })).toThrow(/grant/);
    });
});
