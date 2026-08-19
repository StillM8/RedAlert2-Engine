from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = ROOT / path
    text = file.read_text()
    actual = text.count(old)
    if actual < count:
        raise RuntimeError(f"{path}: expected at least {count} occurrence(s), found {actual}: {old[:160]!r}")
    file.write_text(text.replace(old, new, count))


# ---------------------------------------------------------------------------
# BuildingType rules.
# ---------------------------------------------------------------------------
techno = "redalert2/src/game/rules/TechnoRules.ts"
replace(
    techno,
    "    /** Ares Firestorm.Wall; separate from ordinary wall terrain/connection rules. */\n    declare firestormWall: boolean;\n    declare gate: boolean;",
    "    /** Ares Firestorm.Wall; separate from ordinary wall terrain/connection rules. */\n    declare firestormWall: boolean;\n    /** Ares BuildingType lightning-storm attraction flag. */\n    declare lightningRod: boolean;\n    /** Damage multiplier applied only to the rod itself for weather-storm hits. */\n    declare lightningRodModifier: number;\n    declare gate: boolean;",
)
replace(
    techno,
    "        this.wall = this.ini.getBool(\"Wall\");\n        this.firestormWall = this.ini.getBool(\"Firestorm.Wall\");\n        this.gate = this.ini.getBool(\"Gate\");",
    "        this.wall = this.ini.getBool(\"Wall\");\n        this.firestormWall = this.ini.getBool(\"Firestorm.Wall\");\n        this.lightningRod = this.type === ObjectType.Building && this.ini.getBool(\"LightningRod\");\n        this.lightningRodModifier = this.ini.getFixed(\"LightningRod.Modifier\", 1);\n        this.gate = this.ini.getBool(\"Gate\");",
)

# ---------------------------------------------------------------------------
# Per-LightningStorm Ares override.
# ---------------------------------------------------------------------------
sw = "redalert2/src/extensions/ares/AresSuperWeapons.ts"
replace(
    sw,
    '    "light.",\n    "droppodweapon",',
    '    "light.",\n    "lightning.",\n    "droppodweapon",',
)
replace(
    sw,
    "    swDeferment?: number;\n    swActivationSound?: string;",
    "    swDeferment?: number;\n    /** Type=LightningStorm: bypass LightningRod attraction and damage scaling. */\n    lightningIgnoreLightningRod?: boolean;\n    swActivationSound?: string;",
)
replace(
    sw,
    '        swDeferment: getNumber(section, "SW.Deferment"),\n        swActivationSound: getString(section, "SW.ActivationSound"),',
    '        swDeferment: getNumber(section, "SW.Deferment"),\n        lightningIgnoreLightningRod: getBool(section, "Lightning.IgnoreLightningRod"),\n        swActivationSound: getString(section, "SW.ActivationSound"),',
)

# ---------------------------------------------------------------------------
# Storm cloud attraction + per-hit ignore propagation.
# ---------------------------------------------------------------------------
storm = "redalert2/src/game/superweapon/LightningStormEffect.ts"
replace(
    storm,
    'import { isLightningStormTileInRange } from "@/game/superweapon/LightningStormRange";',
    'import { isLightningStormTileInRange } from "@/game/superweapon/LightningStormRange";\nimport { resolveAresLightningRodCloudTile } from "@/extensions/ares/AresLightningRods";',
)
replace(
    storm,
    "        private readonly superWeaponDeferment?: number,\n        superWeaponRange?: readonly number[],\n    ) {",
    "        private readonly superWeaponDeferment?: number,\n        superWeaponRange?: readonly number[],\n        private readonly ignoreLightningRod: boolean = false,\n    ) {",
)
replace(
    storm,
    "                    if (randomTile) {\n                        this.spawnCloudAt(randomTile, game);\n                    }",
    "                    if (randomTile) {\n                        const attractedTile = resolveAresLightningRodCloudTile(\n                            randomTile,\n                            game.updatableObjects,\n                            this.ignoreLightningRod,\n                        );\n                        this.spawnCloudAt(attractedTile, game);\n                    }",
)
replace(
    storm,
    "warhead.detonate(game as any, lightningStorm.damage, tile, elevation, Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, tile.z + elevation), zone, bridge ? CollisionType.OnBridge : CollisionType.None, game.createTarget(bridge, tile), { player: this.owner, weapon: undefined } as any, false, undefined, undefined, true);",
    "warhead.detonate(game as any, lightningStorm.damage, tile, elevation, Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, tile.z + elevation), zone, bridge ? CollisionType.OnBridge : CollisionType.None, game.createTarget(bridge, tile), { player: this.owner, weapon: undefined, aresIgnoreLightningRod: this.ignoreLightningRod } as any, false, undefined, undefined, true);",
)

sw_trait = "redalert2/src/game/trait/SuperWeaponsTrait.ts"
replace(
    sw_trait,
    "                    t.push(new LightningStormEffect(o, i, s, e.ares?.swDeferment, e.ares?.swRange));",
    "                    t.push(new LightningStormEffect(\n                        o, i, s, e.ares?.swDeferment, e.ares?.swRange,\n                        e.ares?.lightningIgnoreLightningRod === true,\n                    ));",
)

# ---------------------------------------------------------------------------
# Weather damage modifier: apply only to the rod target.
# ---------------------------------------------------------------------------
warhead = "redalert2/src/game/Warhead.ts"
replace(
    warhead,
    'import type { AresAttachEffectApplyResult } from "@/extensions/ares/AresAttachEffectRuntime";',
    'import type { AresAttachEffectApplyResult } from "@/extensions/ares/AresAttachEffectRuntime";\nimport { resolveAresLightningRodDamage } from "@/extensions/ares/AresLightningRods";',
)
replace(
    warhead,
    "    wall: boolean;\n}",
    "    wall: boolean;\n    lightningRod?: boolean;\n    lightningRodModifier?: number;\n}",
)
replace(
    warhead,
    "    computeDamage(baseDamage: number, target: GameObject, gameWorld: GameWorld, isWeatherStorm = false): number {",
    "    computeDamage(baseDamage: number, target: GameObject, gameWorld: GameWorld, isWeatherStorm = false, ignoreLightningRod = false): number {",
)
replace(
    warhead,
    "        if (target.isOverlay() && target.isBridge() && !this.rules.wall) {\n            damage = 0;\n        }\n        return damage > 0 ? Math.floor(damage) : Math.ceil(damage);",
    "        if (target.isOverlay() && target.isBridge() && !this.rules.wall) {\n            damage = 0;\n        }\n        damage = resolveAresLightningRodDamage(damage, target, isWeatherStorm, ignoreLightningRod);\n        return damage > 0 ? Math.floor(damage) : Math.ceil(damage);",
)
replace(
    warhead,
    "            let damage = this.computeDamage(baseDamage, obj, gameWorld, isWeatherStorm);",
    "            let damage = this.computeDamage(\n                baseDamage, obj, gameWorld, isWeatherStorm,\n                (weaponInfo as any)?.aresIgnoreLightningRod === true,\n            );",
)

# ---------------------------------------------------------------------------
# Focused parser/helper/integration tests.
# ---------------------------------------------------------------------------
(ROOT / "redalert2/src/test/compatibility/AresLightningRods.test.ts").write_text('''import { describe, expect, test } from "bun:test";\nimport { IniSection } from "@/data/IniSection";\nimport { ObjectType } from "@/engine/type/ObjectType";\nimport { ArmorRegistry } from "@/extensions/ares/AresArmor";\nimport { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";\nimport {\n    resolveAresLightningRodCloudTile,\n    resolveAresLightningRodDamage,\n} from "@/extensions/ares/AresLightningRods";\nimport { TechnoRules } from "@/game/rules/TechnoRules";\n\nfunction techno(id: number, rx: number, ry: number, rod = false): any {\n    return {\n        id, tile: { rx, ry, z: 0 }, isSpawned: true, isDestroyed: false, isDisposed: false, isCrashing: false,\n        rules: { lightningRod: rod, lightningRodModifier: rod ? 3 : 1 },\n        isTechno: () => true,\n        isBuilding: () => rod,\n    };\n}\n\ndescribe("Ares Lightning Rods", () => {\n    test("parses BuildingType rod settings with documented defaults", () => {\n        const section = new IniSection("GARODS");\n        section.set("LightningRod", "yes");\n        section.set("LightningRod.Modifier", "3");\n        const rules = new TechnoRules(ObjectType.Building, section, 0, {}, new ArmorRegistry());\n        expect(rules.lightningRod).toBe(true);\n        expect(rules.lightningRodModifier).toBe(3);\n\n        const defaultRules = new TechnoRules(ObjectType.Building, new IniSection("NORMAL"), 0, {}, new ArmorRegistry());\n        expect(defaultRules.lightningRod).toBe(false);\n        expect(defaultRules.lightningRodModifier).toBe(1);\n    });\n\n    test("redirects a random cloud only when the nearest live Techno is a rod", () => {\n        const random = { rx: 10, ry: 10, z: 0 };\n        const rod = techno(2, 12, 10, true);\n        const ordinary = techno(1, 20, 20, false);\n        expect(resolveAresLightningRodCloudTile(random, [ordinary, rod])).toEqual(rod.tile);\n\n        const nearerOrdinary = techno(3, 11, 10, false);\n        expect(resolveAresLightningRodCloudTile(random, [rod, nearerOrdinary])).toBe(random);\n        expect(resolveAresLightningRodCloudTile(random, [rod], true)).toBe(random);\n    });\n\n    test("uses deterministic target tie-breaking independent of input order", () => {\n        const random = { rx: 10, ry: 10, z: 0 };\n        const rod = techno(1, 9, 10, true);\n        const ordinary = techno(2, 11, 10, false);\n        expect(resolveAresLightningRodCloudTile(random, [ordinary, rod])).toEqual(rod.tile);\n        expect(resolveAresLightningRodCloudTile(random, [rod, ordinary])).toEqual(rod.tile);\n    });\n\n    test("scales weather damage only for the rod itself and honors IgnoreLightningRod", () => {\n        const rod = techno(1, 0, 0, true);\n        expect(resolveAresLightningRodDamage(100, rod, true)).toBe(300);\n        expect(resolveAresLightningRodDamage(100, rod, false)).toBe(100);\n        expect(resolveAresLightningRodDamage(100, rod, true, true)).toBe(100);\n        expect(resolveAresLightningRodDamage(100, techno(2, 0, 0, false), true)).toBe(100);\n    });\n\n    test("parses Lightning.IgnoreLightningRod as Ares superweapon data", () => {\n        const section = new IniSection("StormSpecial");\n        section.set("Type", "LightningStorm");\n        section.set("Lightning.IgnoreLightningRod", "yes");\n        const definition = parseAresSuperWeaponDefinition(section)!;\n        expect(definition.lightningIgnoreLightningRod).toBe(true);\n        expect(definition.extensionEntries.has("Lightning.IgnoreLightningRod")).toBe(true);\n    });\n});\n''')

print("Applied guarded Ares Lightning Rod runtime patch")
