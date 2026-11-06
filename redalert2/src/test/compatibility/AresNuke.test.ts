import { describe, expect, spyOn, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { NukeEffect, resolveNukeDamage, resolveNukeWarhead } from "@/game/superweapon/NukeEffect";
import { SuperWeaponRules } from "@/game/rules/SuperWeaponRules";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";
import { SuperWeaponType } from "@/game/type/SuperWeaponType";
import { Weapon } from "@/game/Weapon";

function makeTile(rx: number, ry: number): any {
    return { rx, ry, z: 0 };
}

function makeProjectile(weaponRules: any): any {
    return {
        fromWeapon: {
            rules: { ...weaponRules },
            warhead: { rules: { name: weaponRules.warhead } },
        },
        rules: { detonationAltitude: 0 },
        position: {
            tile: undefined,
            tileElevation: 0,
            moveToLeptons() {
                this.tile = makeTile(4, 5);
            },
            moveToTileCoords() {
            },
        },
    };
}

function makeGame(weapons: Record<string, any>, buildings: any[] = []): any {
    const spawned: any[] = [];
    const loose: string[] = [];
    const game: any = {
        rules: {
            getWeapon(name: string) {
                const rules = weapons[name];
                if (!rules) throw new Error(`missing weapon ${name}`);
                return rules;
            },
            getWarhead(name: string) {
                return { name };
            },
        },
        map: {
            isWithinHardBounds: () => true,
        },
        createTarget: (_object: any, tile: any) => ({ tile }),
        createLooseProjectile(name: string, _owner: any, _target: any) {
            loose.push(name);
            return makeProjectile(weapons[name]);
        },
        spawnObject(object: any, tile: any) {
            object.tile = tile;
            spawned.push(object);
        },
        spawned,
        loose,
    };
    const owner: any = {
        getOwnedObjectsByType: (type: ObjectType) => type === ObjectType.Building ? buildings : [],
    };
    return { game, owner };
}

function makeSilo(owner: any, superWeapon?: any, name = "NukeSpecial"): any {
    return {
        owner,
        rules: {
            nukeSilo: true,
            name: "Silo",
        },
        isSpawned: true,
        healthTrait: { health: 100 },
        superWeaponTraits: superWeapon ? [{
            name,
            getSuperWeapon: () => superWeapon,
        }] : [],
    };
}

describe("Ares MultiMissile Nuke payload and silo behavior", () => {
    test("parses typed payload and silo settings and applies source defaults", () => {
        const ini = new IniFile(`
[NukeSpecial]
Type=MultiMissile
Nuke.Payload=CustomPayload
Nuke.SiloLaunch=no
`);
        const section = ini.getSection("NukeSpecial")!;
        const definition = parseAresSuperWeaponDefinition(section);
        const rules = new SuperWeaponRules(0).readIni(section);

        expect(definition?.nukePayload).toBe("CustomPayload");
        expect(definition?.nukeSiloLaunch).toBe(false);
        expect(rules.nukePayload).toBe("CustomPayload");
        expect(rules.nukeSiloLaunch).toBe(false);
        expect(rules.ares?.nukePayload).toBe("CustomPayload");
        expect(rules.ares?.nukeSiloLaunch).toBe(false);

        const defaults = new SuperWeaponRules(1).readIni(new IniFile(`
[DefaultNuke]
Type=MultiMissile
WeaponType=NukeCarrier
`).getSection("DefaultNuke")!);
        expect(defaults.ares).toBeUndefined();
        expect(defaults.nukePayload).toBe("NukePayload");
        expect(defaults.nukeSiloLaunch).toBe(true);
    });

    test("fires a payload-only loose projectile without WeaponType", () => {
        const weapons = {
            Payload: { name: "Payload", damage: 12, warhead: "PayloadWH", projectile: "Down" },
        };
        const { game, owner } = makeGame(weapons);
        const effect = new NukeEffect(0, owner, makeTile(4, 5), undefined, {
            payload: "Payload",
            payloadConfigured: true,
        });

        effect.onStart(game);

        expect(game.loose).toEqual(["Payload"]);
        expect(game.spawned).toHaveLength(1);
    });

    test("routes a payload-only MultiMissile through the activation trait", () => {
        const weapons = {
            Payload: { name: "Payload", damage: 12, warhead: "PayloadWH", projectile: "Down" },
        };
        const { game, owner } = makeGame(weapons);
        game.traits = { filter: () => [] };
        game.events = { dispatch: () => undefined };
        const rules: any = {
            type: SuperWeaponType.MultiMissile,
            name: "PayloadNuke",
            nukePayload: "Payload",
            nukeSiloLaunch: false,
        };
        const trait = new SuperWeaponsTrait();

        (trait as any).activateEffect(rules, owner, game, makeTile(4, 5), undefined, false, undefined, undefined);
        const effect = (trait as any).effects[0] as NukeEffect;
        effect.onStart(game);

        expect(game.loose).toEqual(["Payload"]);
    });

    test("does not use an eligible silo when SiloLaunch is disabled", () => {
        const weapons = {
            Carrier: { name: "Carrier", damage: 0, warhead: "NukeMaker", projectile: "Up" },
            Payload: { name: "Payload", damage: 12, warhead: "PayloadWH", projectile: "Down" },
        };
        const superWeapon = { name: "NukeSpecial" };
        const { game, owner } = makeGame(weapons);
        const silo = makeSilo(owner, superWeapon);
        owner.getOwnedObjectsByType = () => [silo];
        const factory = spyOn(Weapon, "factory");
        const effect = new NukeEffect(0, owner, makeTile(4, 5), "Carrier", {
            payload: "Payload",
            payloadConfigured: true,
            siloLaunch: false,
            superWeapon,
        });

        effect.onStart(game);

        expect(factory).not.toHaveBeenCalled();
        expect(game.loose).toEqual(["Payload"]);
        factory.mockRestore();
    });

    test("routes through an eligible owned silo when enabled", () => {
        const weapons = {
            Carrier: { name: "Carrier", damage: 0, warhead: "NukeMaker", projectile: "Up" },
            NukePayload: { name: "NukePayload", damage: 12, warhead: "PayloadWH", projectile: "Down" },
        };
        const superWeapon = { name: "NukeSpecial" };
        const { game, owner } = makeGame(weapons);
        const silo = makeSilo(owner, superWeapon);
        owner.getOwnedObjectsByType = () => [silo];
        const fired: any[] = [];
        const factory = spyOn(Weapon, "factory").mockImplementation((name: any, _type: any, building: any, _rules: any) => ({
            fire: (target: any, world: any) => fired.push({ name, building, target, world }),
        }) as any);
        const effect = new NukeEffect(0, owner, makeTile(4, 5), "Carrier", {
            superWeapon,
            superWeaponName: superWeapon.name,
        });

        effect.onStart(game);

        expect(factory).toHaveBeenCalledTimes(1);
        expect(factory.mock.calls[0][0]).toBe("Carrier");
        expect(fired[0].building).toBe(silo);
        expect(game.loose).toEqual([]);
        factory.mockRestore();
    });

    test("gives SW damage and warhead precedence over payload values", () => {
        const weapons = {
            Payload: { name: "Payload", damage: 12, warhead: "PayloadWH", projectile: "Down" },
        };
        const { game, owner } = makeGame(weapons);
        const effect = new NukeEffect(0, owner, makeTile(4, 5), undefined, {
            payload: "Payload",
            payloadConfigured: true,
            damage: 99,
            warhead: "OverrideWH",
        });

        effect.onStart(game);

        const launched = game.spawned[0].fromWeapon;
        expect(launched.rules.damage).toBe(99);
        expect(launched.rules.warhead).toBe("OverrideWH");
        expect(launched.warhead.rules.name).toBe("OverrideWH");
    });

    test("falls back to payload damage and warhead for negative or empty overrides", () => {
        expect(resolveNukeDamage(-1, { damage: 41 })).toBe(41);
        expect(resolveNukeDamage(undefined, { damage: 41 })).toBe(41);
        expect(resolveNukeWarhead("<none>", { warhead: "PayloadWH" })).toBe("PayloadWH");
    });

    test("drops a missing payload without throwing", () => {
        const { game, owner } = makeGame({});
        const effect = new NukeEffect(0, owner, makeTile(4, 5));

        expect(() => effect.onStart(game)).not.toThrow();
        expect(game.loose).toEqual([]);
        expect(game.spawned).toEqual([]);
    });

    test("preserves legacy NukeSpecial WeaponType silo routing", () => {
        const ini = new IniFile(`
[NukeSpecial]
Type=MultiMissile
WeaponType=NukeCarrier
`);
        const rules = new SuperWeaponRules(0).readIni(ini.getSection("NukeSpecial")!);
        const weapons = {
            NukeCarrier: { name: "NukeCarrier", damage: 0, warhead: "NukeMaker", projectile: "Up" },
            NukePayload: { name: "NukePayload", damage: 12, warhead: "PayloadWH", projectile: "Down" },
        };
        const superWeapon = { name: rules.name, rules };
        const { game, owner } = makeGame(weapons);
        const silo = makeSilo(owner, superWeapon, rules.name);
        owner.getOwnedObjectsByType = () => [silo];
        const fired: any[] = [];
        const factory = spyOn(Weapon, "factory").mockImplementation((name: any, _type: any, building: any, _rules: any) => ({
            fire: (target: any, world: any) => fired.push({ name, building, target, world }),
        }) as any);
        const effect = new NukeEffect(0, owner, makeTile(4, 5), rules.weaponType, {
            payload: rules.nukePayload,
            siloLaunch: rules.nukeSiloLaunch,
            superWeapon,
            superWeaponName: rules.name,
        });

        effect.onStart(game);

        expect(factory.mock.calls[0][0]).toBe("NukeCarrier");
        expect(fired).toHaveLength(1);
        expect(game.loose).toEqual([]);
        factory.mockRestore();
    });
});
