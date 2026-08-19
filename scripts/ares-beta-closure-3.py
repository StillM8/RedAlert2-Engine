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
# TechnoRules: per-Aircraft Ares missile normalization.
# ---------------------------------------------------------------------------
techno = "redalert2/src/game/rules/TechnoRules.ts"
replace(
    techno,
    'import type { AresChronoshiftRules } from "@/extensions/ares/AresChronoshift";',
    'import type { AresChronoshiftRules } from "@/extensions/ares/AresChronoshift";\nimport { hasAresCustomMissileFields, parseAresCustomMissileRules } from "@/extensions/ares/AresCustomMissiles";\nimport type { AresCustomMissileRules } from "@/extensions/ares/AresCustomMissiles";',
)
replace(
    techno,
    "    /** Optional Ares Chronoshift eligibility data authored on this TechnoType. */\n    declare aresChronoshift?: AresChronoshiftRules;",
    "    /** Optional Ares Chronoshift eligibility data authored on this TechnoType. */\n    declare aresChronoshift?: AresChronoshiftRules;\n    /** Ares per-Aircraft custom missile and missile-presentation settings. */\n    declare aresCustomMissile?: AresCustomMissileRules;",
)
replace(
    techno,
    "        const normalizedAresKeys = [...this.ini.entries.keys()].map((key: string) =>\n            key.trim().toLocaleLowerCase(\"en-US\"));",
    "        const normalizedAresKeys = [...this.ini.entries.keys()].map((key: string) =>\n            key.trim().toLocaleLowerCase(\"en-US\"));\n        this.aresCustomMissile = this.type === ObjectType.Aircraft && hasAresCustomMissileFields(this.ini)\n            ? parseAresCustomMissileRules(this.ini)\n            : undefined;",
)

# ---------------------------------------------------------------------------
# Missile locomotor: custom RocketStruct maneuverability and retail parity.
# ---------------------------------------------------------------------------
locomotor = "redalert2/src/game/gameobject/locomotor/MissileLocomotor.ts"
replace(
    locomotor,
    "interface MissileRules {\n    altitude: number;\n    acceleration: number;\n    lazyCurve: boolean;\n    bodyLength: number;\n}",
    "interface MissileRules {\n    altitude: number;\n    acceleration: number;\n    lazyCurve: boolean;\n    bodyLength: number;\n    /** RocketStruct turn rate is stored in radians per simulation tick. */\n    turnRate?: number;\n}",
)
replace(
    locomotor,
    "                    geometry.rotateVec3Towards(this.currentVelocity, new Vector3(this.currentVelocity.x, 0, this.currentVelocity.z), gameObject.rules.rot);",
    "                    geometry.rotateVec3Towards(this.currentVelocity, new Vector3(this.currentVelocity.x, 0, this.currentVelocity.z), this.getTurnRate(gameObject));",
)
replace(
    locomotor,
    "                    geometry.rotateVec3Towards(this.currentVelocity, new Vector3(targetDirection.x, this.currentVelocity.y, targetDirection.z), gameObject.rules.rot);",
    "                    geometry.rotateVec3Towards(this.currentVelocity, new Vector3(targetDirection.x, this.currentVelocity.y, targetDirection.z), this.getTurnRate(gameObject));",
)
replace(
    locomotor,
    "                    geometry.rotateVec3Towards(this.currentVelocity, targetDirection, gameObject.rules.rot);",
    "                    geometry.rotateVec3Towards(this.currentVelocity, targetDirection, this.getTurnRate(gameObject));",
)
replace(
    locomotor,
    "    selectNextWaypoint(gameObject: GameObject, waypoints: Waypoint[]): Waypoint {",
    "    private getTurnRate(gameObject: GameObject): number {\n        const authored = this.missileRules.turnRate;\n        return authored === undefined\n            ? gameObject.rules.rot\n            : authored * (180 / Math.PI);\n    }\n    selectNextWaypoint(gameObject: GameObject, waypoints: Waypoint[]): Waypoint {",
)

factory = "redalert2/src/game/gameobject/locomotor/LocomotorFactory.ts"
replace(
    factory,
    "            case LocomotorType.Missile:\n                return new MissileLocomotor(this.game, this.game.rules.general.getMissileRules(obj.name));",
    "            case LocomotorType.Missile:\n                return new MissileLocomotor(\n                    this.game,\n                    obj.rules.aresCustomMissile?.custom\n                        ? obj.rules.aresCustomMissile\n                        : this.game.rules.general.getMissileRules(obj.name),\n                );",
)

# ---------------------------------------------------------------------------
# Spawn manager: launch timing, elite payloads, weapon payloads, takeoff anim.
# ---------------------------------------------------------------------------
airspawn = "redalert2/src/game/gameobject/trait/AirSpawnTrait.ts"
replace(
    airspawn,
    'import { ZoneType } from "@/game/gameobject/unit/ZoneType";',
    'import { ZoneType } from "@/game/gameobject/unit/ZoneType";\nimport { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";\nimport { resolveAresCustomMissilePayload } from "@/extensions/ares/AresCustomMissiles";',
)
replace(
    airspawn,
    "    damage: number;\n    pauseFrames?: number;",
    "    damage: number;\n    weapon?: any;\n    missileRules: any;\n    pauseFrames?: number;\n    takeOffAnimPlayed?: boolean;",
)
replace(
    airspawn,
    "    private pushNewSpawn(aircraftType: any, world: any, parent: any): void {\n        const spawn = world.createUnitForPlayer(aircraftType, parent.owner);\n        spawn.limboData = { selected: false, controlGroup: undefined };\n        if (aircraftType.missileSpawn) {\n            spawn.pitch = 90 * world.rules.general.getMissileRules(aircraftType.name).pitchInitial;\n        }",
    "    private getMissileRules(aircraftType: any, world: any): any {\n        return aircraftType.aresCustomMissile?.custom\n            ? aircraftType.aresCustomMissile\n            : world.rules.general.getMissileRules(aircraftType.name);\n    }\n    private pushNewSpawn(aircraftType: any, world: any, parent: any): void {\n        const spawn = world.createUnitForPlayer(aircraftType, parent.owner);\n        spawn.limboData = { selected: false, controlGroup: undefined };\n        if (aircraftType.missileSpawn) {\n            spawn.pitch = 90 * this.getMissileRules(aircraftType, world).pitchInitial;\n        }",
)
replace(
    airspawn,
    "        for (const launch of this.missileLaunches.slice()) {\n            const missileRules = world.rules.general.getMissileRules(launch.missile.name);\n            launch.pauseFrames ??= missileRules.pauseFrames;",
    "        for (const launch of this.missileLaunches.slice()) {\n            const missileRules = launch.missileRules;\n            launch.pauseFrames ??= missileRules.pauseFrames;",
)
replace(
    airspawn,
    "            if (launch.pauseFrames <= 0) {\n                const finalPitch = 90 * missileRules.pitchFinal;\n                const pitchIncrement = (90 * (missileRules.pitchFinal - missileRules.pitchInitial)) / missileRules.tiltFrames;\n                const missile = launch.missile;\n                if (missile.pitch < finalPitch) {\n                    missile.pitch = Math.min(finalPitch, missile.pitch + pitchIncrement);\n                }\n                else {",
    "            if (launch.pauseFrames <= 0) {\n                const missile = launch.missile;\n                if (!launch.takeOffAnimPlayed) {\n                    launch.takeOffAnimPlayed = true;\n                    const takeOffAnim = missile.rules.aresCustomMissile?.takeOffAnim;\n                    if (takeOffAnim && missile.tile) {\n                        world.events.dispatch(new TriggerAnimEvent(\n                            takeOffAnim, missile.tile, undefined, missile.owner, missile,\n                        ));\n                    }\n                }\n                const finalPitch = 90 * missileRules.pitchFinal;\n                const tiltFrames = Math.max(0, missileRules.tiltFrames ?? 0);\n                const pitchIncrement = tiltFrames > 0\n                    ? (90 * (missileRules.pitchFinal - missileRules.pitchInitial)) / tiltFrames\n                    : Number.POSITIVE_INFINITY;\n                if (missile.pitch < finalPitch) {\n                    if ((missileRules.raiseRate ?? 0) > 0) {\n                        missile.position.worldPosition.y += missileRules.raiseRate;\n                    }\n                    missile.pitch = tiltFrames > 0\n                        ? Math.min(finalPitch, missile.pitch + pitchIncrement)\n                        : finalPitch;\n                }\n                else {",
)
replace(
    airspawn,
    "                            launch.warhead.detonate(world, launch.damage, launch.targetTile, launch.targetBridge?.tileElevation ?? 0, detonationPos, targetZone, launch.targetBridge ? CollisionType.OnBridge : CollisionType.None, launch.target, { player: missile.owner, obj: missile, weapon: undefined, aresAttribution: { spawner: gameObject } } as any, false, undefined, undefined);",
    "                            launch.warhead.detonate(world, launch.damage, launch.targetTile, launch.targetBridge?.tileElevation ?? 0, detonationPos, targetZone, launch.targetBridge ? CollisionType.OnBridge : CollisionType.None, launch.target, { player: missile.owner, obj: missile, weapon: launch.weapon, aresAttribution: { spawner: gameObject } } as any, false, undefined, undefined);",
)
# Replace the full missile payload selection block while preserving retail fallback.
old_payload = '''                let warheadType: string;\n                let damage: number;\n                const isElite = launcher.veteranTrait?.isElite();\n                const rules = world.rules;\n                if (launcher.rules.spawns === rules.general.v3Rocket.type) {\n                    warheadType = isElite ? rules.combatDamage.v3EliteWarhead : rules.combatDamage.v3Warhead;\n                    damage = isElite ? rules.general.v3Rocket.eliteDamage : rules.general.v3Rocket.damage;\n                }\n                else if (launcher.rules.spawns === rules.general.dMisl.type) {\n                    warheadType = isElite ? rules.combatDamage.dMislEliteWarhead : rules.combatDamage.dMislWarhead;\n                    damage = isElite ? rules.general.dMisl.eliteDamage : rules.general.dMisl.damage;\n                }\n                else {\n                    throw new Error(`Unhandled missile type "${launcher.rules.spawns}"`);\n                }\n                const warhead = new Warhead(world.rules.getWarhead(warheadType));'''
new_payload = '''                let warheadType: string | undefined;\n                let damage: number;\n                let payloadWeapon: any;\n                const isElite = launcher.veteranTrait?.isElite() === true;\n                const rules = world.rules;\n                const customMissile = spawn.rules.aresCustomMissile?.custom\n                    ? spawn.rules.aresCustomMissile\n                    : undefined;\n                if (customMissile) {\n                    const payload = resolveAresCustomMissilePayload(customMissile, isElite);\n                    damage = payload.damage;\n                    warheadType = payload.warhead;\n                    if (payload.weapon) {\n                        payloadWeapon = rules.getWeapon(payload.weapon);\n                        damage = payloadWeapon.damage;\n                        warheadType = payloadWeapon.warhead;\n                    }\n                    if (!warheadType) {\n                        throw new Error(`Custom missile "${spawn.name}" requires Missile.Warhead or Missile.Weapon`);\n                    }\n                }\n                else if (launcher.rules.spawns === rules.general.v3Rocket.type) {\n                    warheadType = isElite ? rules.combatDamage.v3EliteWarhead : rules.combatDamage.v3Warhead;\n                    damage = isElite ? rules.general.v3Rocket.eliteDamage : rules.general.v3Rocket.damage;\n                }\n                else if (launcher.rules.spawns === rules.general.dMisl.type) {\n                    warheadType = isElite ? rules.combatDamage.dMislEliteWarhead : rules.combatDamage.dMislWarhead;\n                    damage = isElite ? rules.general.dMisl.eliteDamage : rules.general.dMisl.damage;\n                }\n                else {\n                    throw new Error(`Unhandled missile type "${launcher.rules.spawns}"`);\n                }\n                const missileRules = this.getMissileRules(spawn.rules, world);\n                const warhead = new Warhead(world.rules.getWarhead(warheadType));'''
replace(airspawn, old_payload, new_payload)
replace(
    airspawn,
    "                    warhead: warhead,\n                    damage: damage,\n                    pauseFrames: undefined",
    "                    warhead: warhead,\n                    damage: damage,\n                    weapon: payloadWeapon,\n                    missileRules,\n                    pauseFrames: undefined",
)

# ---------------------------------------------------------------------------
# Missile trailer presentation, including non-custom missiles with Ares keys.
# ---------------------------------------------------------------------------
trailer = "redalert2/src/engine/renderable/entity/plugin/TrailerSmokePlugin.ts"
replace(
    trailer,
    '                if (this.gameObject.rules.missileSpawn) {\n                    anim = this.art.getAnimation("V3TRAIL");',
    '                if (this.gameObject.rules.missileSpawn) {\n                    anim = this.art.getAnimation(this.gameObject.rules.aresCustomMissile?.trailerAnim ?? "V3TRAIL");',
)
replace(
    trailer,
    "                    const spawnDelay = this.gameObject.art.spawnDelay;",
    "                    const spawnDelay = this.gameObject.rules.missileSpawn\n                        ? (this.gameObject.rules.aresCustomMissile?.trailerSeparation ?? this.gameObject.art.spawnDelay)\n                        : this.gameObject.art.spawnDelay;",
)

# ---------------------------------------------------------------------------
# Tests: parsing, promoted payload, factory/launch integration.
# ---------------------------------------------------------------------------
(ROOT / "redalert2/src/test/compatibility/AresCustomMissiles.test.ts").write_text('''import { describe, expect, test } from "bun:test";\nimport { IniSection } from "@/data/IniSection";\nimport { parseAresCustomMissileRules, resolveAresCustomMissilePayload } from "@/extensions/ares/AresCustomMissiles";\nimport { AirSpawnTrait } from "@/game/gameobject/trait/AirSpawnTrait";\n\ndescribe("Ares custom missiles", () => {\n    test("uses documented zero RocketStruct defaults and presentation defaults", () => {\n        const section = new IniSection("CUSTOMMISSILE");\n        section.set("Missile.Custom", "yes");\n        const rules = parseAresCustomMissileRules(section);\n        expect(rules.custom).toBe(true);\n        expect(rules.pauseFrames).toBe(0);\n        expect(rules.tiltFrames).toBe(0);\n        expect(rules.pitchInitial).toBe(0);\n        expect(rules.pitchFinal).toBe(0);\n        expect(rules.turnRate).toBe(0);\n        expect(rules.raiseRate).toBe(0);\n        expect(rules.acceleration).toBe(0);\n        expect(rules.altitude).toBe(0);\n        expect(rules.damage).toBe(0);\n        expect(rules.eliteDamage).toBe(0);\n        expect(rules.bodyLength).toBe(0);\n        expect(rules.lazyCurve).toBe(false);\n        expect(rules.takeOffAnim).toBe("V3TAKOFF");\n        expect(rules.trailerAnim).toBe("V3TRAIL");\n        expect(rules.trailerSeparation).toBe(3);\n    });\n\n    test("selects promoted weapon/warhead payload with Ares fallbacks", () => {\n        const section = new IniSection("CUSTOMMISSILE");\n        section.set("Missile.Custom", "yes");\n        section.set("Missile.Damage", "100");\n        section.set("Missile.EliteDamage", "250");\n        section.set("Missile.Warhead", "WH1");\n        section.set("Missile.Weapon", "W1");\n        const rules = parseAresCustomMissileRules(section);\n        expect(resolveAresCustomMissilePayload(rules, false)).toEqual({ damage: 100, warhead: "WH1", weapon: "W1" });\n        expect(resolveAresCustomMissilePayload(rules, true)).toEqual({ damage: 250, warhead: "WH1", weapon: "W1" });\n    });\n\n    test("prepareLaunch accepts arbitrary custom missile and weapon payload", () => {\n        const trait = new AirSpawnTrait();\n        const custom = {\n            custom: true, pauseFrames: 4, tiltFrames: 8, pitchInitial: 0.2, pitchFinal: 0.5,\n            turnRate: 0.08, raiseRate: 1, acceleration: 0.4, altitude: 768, damage: 10,\n            eliteDamage: 20, bodyLength: 128, lazyCurve: false, weapon: "PAYLOAD",\n            takeOffAnim: "TAKEOFF", trailerAnim: "TRAIL", trailerSeparation: 2,\n        };\n        let configuredDamage = 0;\n        let configuredWarhead: any;\n        const spawn: any = {\n            name: "MYMISSILE", ammo: 1, rules: { missileSpawn: true, aresCustomMissile: custom },\n            missileSpawnTrait: {\n                setDamage(value: number) { configuredDamage = value; return this; },\n                setWarhead(value: any) { configuredWarhead = value; return this; },\n                setLauncher() { return this; },\n            },\n        };\n        trait.debugSetStorage(spawn, 1);\n        const launcher: any = { rules: { spawns: "MYMISSILE" }, veteranTrait: { isElite: () => false } };\n        const target: any = { tile: { rx: 1, ry: 2, z: 0 }, getBridge: () => undefined, getWorldCoords: () => ({ clone: () => ({}) }) };\n        const world: any = {\n            rules: {\n                getWeapon: (name: string) => { expect(name).toBe("PAYLOAD"); return { damage: 321, warhead: "PAYLOADWH" }; },\n                getWarhead: (name: string) => ({ name }),\n                general: { getMissileRules: () => { throw new Error("custom missile must not use retail General missile rules"); } },\n                combatDamage: {},\n            },\n        };\n        expect(trait.prepareLaunch(launcher, target, world)).toBe(spawn);\n        expect(configuredDamage).toBe(321);\n        expect(configuredWarhead.rules?.name ?? configuredWarhead.rules?.id ?? configuredWarhead.rules).toBeDefined();\n        expect(trait.isLaunchingMissiles()).toBe(true);\n    });\n});\n''')

print("Applied guarded Ares custom missile runtime patch")
