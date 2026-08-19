from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = ROOT / path
    text = file.read_text()
    actual = text.count(old)
    if actual < count:
        raise RuntimeError(f"{path}: expected at least {count} occurrence(s), found {actual}: {old[:100]!r}")
    text = text.replace(old, new, count)
    file.write_text(text)


# ---------------------------------------------------------------------------
# Ranged=yes / ProjectileRange runtime
# ---------------------------------------------------------------------------
projectile = "redalert2/src/game/gameobject/Projectile.ts"
replace(
    projectile,
    "    sortAresSplitCandidates,\n    shouldRetargetAresSplit,\n} from '@/extensions/ares/AresProjectileExtensions';",
    "    sortAresSplitCandidates,\n    shouldRetargetAresSplit,\n    resolveAresRangedTravel,\n} from '@/extensions/ares/AresProjectileExtensions';",
)
replace(
    projectile,
    "    private homingTravelDistance: number;\n    private homingTravelTicks: number;",
    "    private homingTravelDistance: number;\n    /** Total physical travel distance used by Ares Ranged=yes fuel limits. */\n    private travelDistance: number;\n    private homingTravelTicks: number;",
)
replace(
    projectile,
    "        this.homingTravelDistance = 0;\n        this.homingTravelTicks = 0;",
    "        this.homingTravelDistance = 0;\n        this.travelDistance = 0;\n        this.homingTravelTicks = 0;",
)
replace(
    projectile,
    "            const distanceToTarget = toTarget.length();\n            const moveDistance = Math.min(distanceToTarget, currentSpeed);\n            this.homingTravelDistance += moveDistance;\n            this.homingTravelTicks++;\n            let shouldDetonate = false;",
    "            const distanceToTarget = toTarget.length();\n            const rangedTravel = this.resolveRangedTravel(Math.min(distanceToTarget, currentSpeed));\n            const moveDistance = rangedTravel.distance;\n            this.homingTravelDistance += moveDistance;\n            this.homingTravelTicks++;\n            let shouldDetonate = rangedTravel.exhausted;",
)
replace(
    projectile,
    "            else {\n                this.position.moveByLeptons3(toTarget);\n                shouldDetonate = true;\n            }\n            if (shouldDetonate) {",
    "            else {\n                // A Ranged projectile can consume its final fraction of fuel\n                // before reaching the target. Do not snap that final sub-lepton\n                // step to the target; detonate at the exact exhausted position.\n                const finalStep = rangedTravel.exhausted && moveDistance < distanceToTarget\n                    ? this.homingMoveDir.clone().setLength(moveDistance)\n                    : toTarget;\n                if (moveDistance > 0) {\n                    this.position.moveByLeptons3(finalStep);\n                }\n                shouldDetonate = true;\n            }\n            if (shouldDetonate) {",
)
replace(
    projectile,
    "            const moveDistance = Math.min(toAimPoint.length(), currentSpeed);\n            toAimPoint.setLength(moveDistance);",
    "            const rangedTravel = this.resolveRangedTravel(Math.min(toAimPoint.length(), currentSpeed));\n            const moveDistance = rangedTravel.distance;\n            toAimPoint.setLength(moveDistance);",
)
replace(
    projectile,
    "            let shouldDetonate = false;\n            const newPos = toAimPoint.clone().add(this.position.worldPosition);",
    "            let shouldDetonate = rangedTravel.exhausted;\n            const newPos = toAimPoint.clone().add(this.position.worldPosition);",
)
replace(
    projectile,
    "                else if (this.overshootTiles) {",
    "                else if (!rangedTravel.exhausted && this.overshootTiles) {",
)
replace(
    projectile,
    "                else if (this.snapToTarget && !this.targetLockLost) {",
    "                else if (!rangedTravel.exhausted && this.snapToTarget && !this.targetLockLost) {",
)
replace(
    projectile,
    "    private updateSpeed(maxSpeed: number): number {",
    "    private resolveRangedTravel(requestedDistance: number) {\n        const decision = resolveAresRangedTravel(\n            requestedDistance,\n            this.travelDistance,\n            !!this.rules.ranged,\n            (this.fromWeapon?.rules?.projectileRange ?? 390) * Coords.LEPTONS_PER_TILE,\n        );\n        this.travelDistance = decision.travelDistance;\n        return decision;\n    }\n    private updateSpeed(maxSpeed: number): number {",
)

# ---------------------------------------------------------------------------
# Techno-specific Ares parachute override
# ---------------------------------------------------------------------------
techno_ext = "redalert2/src/extensions/ares/AresTechnoExtensions.ts"
replace(
    techno_ext,
    "export interface AresTechnoExtensions {\n    ifv: AresIfvModeRules;",
    "export interface AresTechnoExtensions {\n    /** Per-Techno Ares parachute animation override. */\n    parachuteAnim?: string;\n    ifv: AresIfvModeRules;",
)
replace(
    techno_ext,
    "export function parseAresTechnoExtensions(section: AresTechnoSectionLike): AresTechnoExtensions {\n    return {\n        ifv: parseAresIfvModeRules(section),",
    "export function resolveAresParachuteAnim(\n    rules: Pick<AresTechnoExtensions, 'parachuteAnim'> | undefined,\n    fallback: string,\n): string {\n    return rules?.parachuteAnim?.trim() || fallback;\n}\n\nexport function parseAresTechnoExtensions(section: AresTechnoSectionLike): AresTechnoExtensions {\n    const parachuteAnim = firstScalar(findEntry(section, 'Parachute.Anim'));\n    return {\n        ...(parachuteAnim === undefined ? {} : { parachuteAnim }),\n        ifv: parseAresIfvModeRules(section),",
)

infantry_render = "redalert2/src/engine/renderable/entity/Infantry.ts"
replace(
    infantry_render,
    'import { MathUtils } from "@/engine/gfx/MathUtils";',
    'import { MathUtils } from "@/engine/gfx/MathUtils";\nimport { resolveAresParachuteAnim } from "@/extensions/ares/AresTechnoExtensions";',
)
replace(
    infantry_render,
    "                const parachuteArt = this.rules.audioVisual.parachute;",
    "                const parachuteArt = resolveAresParachuteAnim(\n                    this.gameObject.rules.ares,\n                    this.rules.audioVisual.parachute,\n                );",
)

# ---------------------------------------------------------------------------
# Tests: extend existing projectile suite and add parachute normalization test.
# ---------------------------------------------------------------------------
projectile_test = "redalert2/src/test/compatibility/AresProjectileExtensions.test.ts"
replace(
    projectile_test,
    "    sortAresSplitCandidates,\n    shouldRetargetAresSplit,",
    "    sortAresSplitCandidates,\n    shouldRetargetAresSplit,\n    resolveAresRangedTravel,",
)
replace(
    projectile_test,
    'import { Projectile } from "@/game/gameobject/Projectile";',
    'import { Projectile } from "@/game/gameobject/Projectile";\nimport { WeaponRules } from "@/game/rules/WeaponRules";',
)
replace(
    projectile_test,
    '        section.set("Proximity", "no");\n        section.set("AttachedSystem", "SpeederShotSys");',
    '        section.set("Proximity", "no");\n        section.set("Ranged", "yes");\n        section.set("AnimLength", "4");\n        section.set("AnimRate", "3");\n        section.set("AttachedSystem", "SpeederShotSys");',
)
replace(
    projectile_test,
    '        expect(rules.proximity).toBe(false);\n        expect(rules.attachedSystem).toBe("SpeederShotSys");',
    '        expect(rules.proximity).toBe(false);\n        expect(rules.ranged).toBe(true);\n        expect(rules.animLength).toBe(4);\n        expect(rules.animRate).toBe(3);\n        expect(rules.attachedSystem).toBe("SpeederShotSys");',
)
replace(
    projectile_test,
    '        expect(rules.proximity).toBe(false);\n    });\n\n    test("Airburst cell pool',
    '        expect(rules.proximity).toBe(false);\n        expect(rules.ranged).toBe(false);\n        expect(rules.animLength).toBe(1);\n        expect(rules.animRate).toBe(1);\n    });\n\n    test("Ranged fuel travel is deterministic and ProjectileRange defaults to 390 cells", () => {\n        expect(resolveAresRangedTravel(80, 0, true, 100)).toEqual({\n            distance: 80,\n            travelDistance: 80,\n            exhausted: false,\n        });\n        expect(resolveAresRangedTravel(80, 80, true, 100)).toEqual({\n            distance: 20,\n            travelDistance: 100,\n            exhausted: true,\n        });\n        expect(resolveAresRangedTravel(80, 80, false, 100)).toEqual({\n            distance: 80,\n            travelDistance: 160,\n            exhausted: false,\n        });\n\n        const explicit = new IniSection("RangedWeapon");\n        explicit.set("ProjectileRange", "12.5");\n        expect(new WeaponRules(explicit).projectileRange).toBe(12.5);\n        expect(new WeaponRules(new IniSection("DefaultRangedWeapon")).projectileRange).toBe(390);\n    });\n\n    test("Airburst cell pool',
)

parachute_test = ROOT / "redalert2/src/test/compatibility/AresParachute.test.ts"
parachute_test.write_text('''import { describe, expect, test } from "bun:test";\nimport { IniSection } from "@/data/IniSection";\nimport { parseAresTechnoExtensions, resolveAresParachuteAnim } from "@/extensions/ares/AresTechnoExtensions";\n\ndescribe("Ares customizable parachutes", () => {\n    test("normalizes a per-Techno parachute and preserves the fallback", () => {\n        const section = new IniSection("PARATROOPER");\n        section.set("Parachute.Anim", "FOEPARACH");\n        const rules = parseAresTechnoExtensions(section);\n\n        expect(rules.parachuteAnim).toBe("FOEPARACH");\n        expect(resolveAresParachuteAnim(rules, "PARACH")).toBe("FOEPARACH");\n        expect(resolveAresParachuteAnim(undefined, "PARACH")).toBe("PARACH");\n    });\n});\n''')

print("Applied guarded Ares beta closure patch")
