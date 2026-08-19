from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = ROOT / path
    text = file.read_text()
    actual = text.count(old)
    if actual < count:
        raise RuntimeError(f"{path}: expected at least {count} occurrence(s), found {actual}: {old[:140]!r}")
    file.write_text(text.replace(old, new, count))


# ---------------------------------------------------------------------------
# Keep beta type-clean before adding more Ares runtime surface.
# ---------------------------------------------------------------------------
replace(
    "redalert2/src/game/gameobject/Vehicle.ts",
    "vehicle.submergibleTrait = new SubmergibleTrait(vehicle);",
    "vehicle.submergibleTrait = new SubmergibleTrait();",
)

# ---------------------------------------------------------------------------
# Full Ares parachute precedence: Techno -> Country -> Side -> global.
# ---------------------------------------------------------------------------
sides = "redalert2/src/extensions/ares/AresSides.ts"
replace(
    sides,
    "    defaultDisguise?: string;\n    /** Antares side-level Hunter Seeker TechnoType fallback. */",
    "    defaultDisguise?: string;\n    /** Ares side-level parachute fallback. */\n    parachuteAnim?: string;\n    /** Antares side-level Hunter Seeker TechnoType fallback. */",
)
replace(
    sides,
    "    loadingTheme?: string;\n    /** Preserve unmodeled country fields without losing extension data. */",
    "    loadingTheme?: string;\n    /** Ares country-level parachute fallback, overriding the side default. */\n    parachuteAnim?: string;\n    /** Preserve unmodeled country fields without losing extension data. */",
)
replace(
    sides,
    "                defaultDisguise: sectionValue(section, \"DefaultDisguise\"),\n                hunterSeeker: sectionValue(section, \"HunterSeeker\"),",
    "                defaultDisguise: sectionValue(section, \"DefaultDisguise\"),\n                parachuteAnim: sectionValue(section, \"Parachute.Anim\"),\n                hunterSeeker: sectionValue(section, \"HunterSeeker\"),",
)
replace(
    sides,
    "                loadingTheme: sectionValue(section, \"LoadingTheme\"),\n                properties: sectionProperties(section),",
    "                loadingTheme: sectionValue(section, \"LoadingTheme\"),\n                parachuteAnim: sectionValue(section, \"Parachute.Anim\"),\n                properties: sectionProperties(section),",
)

country_rules = "redalert2/src/game/rules/CountryRules.ts"
replace(
    country_rules,
    "    public loadingTheme?: string;\n    public listIndex = 100;",
    "    public loadingTheme?: string;\n    /** Country-level Ares parachute default, falling back to the side. */\n    public parachuteAnim?: string;\n    public listIndex = 100;",
)
replace(
    country_rules,
    "        this.loadingTheme = ini.getString(\"LoadingTheme\") || undefined;\n        this.multiplay = ini.getBool(\"Multiplay\");",
    "        this.loadingTheme = ini.getString(\"LoadingTheme\") || undefined;\n        this.parachuteAnim = ini.getString(\"Parachute.Anim\") || sideDescriptor.parachuteAnim || undefined;\n        this.multiplay = ini.getBool(\"Multiplay\");",
)

country = "redalert2/src/game/Country.ts"
replace(
    country,
    "    loadingTheme?: string;\n    multiplay: boolean;",
    "    loadingTheme?: string;\n    parachuteAnim?: string;\n    multiplay: boolean;",
)
replace(
    country,
    "    get loadingTheme(): string | undefined {\n        return this.rules.loadingTheme;\n    }",
    "    get loadingTheme(): string | undefined {\n        return this.rules.loadingTheme;\n    }\n    get parachuteAnim(): string | undefined {\n        return this.rules.parachuteAnim;\n    }",
)

techno_ext = "redalert2/src/extensions/ares/AresTechnoExtensions.ts"
replace(
    techno_ext,
    "export function resolveAresParachuteAnim(\n    rules: Pick<AresTechnoExtensions, 'parachuteAnim'> | undefined,\n    fallback: string,\n): string {\n    return rules?.parachuteAnim?.trim() || fallback;\n}",
    "export function resolveAresParachuteAnim(\n    rules: Pick<AresTechnoExtensions, 'parachuteAnim'> | undefined,\n    fallback: string,\n    countryAnim?: string,\n    sideAnim?: string,\n): string {\n    return rules?.parachuteAnim?.trim() ||\n        countryAnim?.trim() ||\n        sideAnim?.trim() ||\n        fallback;\n}",
)

infantry_render = "redalert2/src/engine/renderable/entity/Infantry.ts"
replace(
    infantry_render,
    "                const parachuteArt = resolveAresParachuteAnim(\n                    this.gameObject.rules.ares,\n                    this.rules.audioVisual.parachute,\n                );",
    "                const parachuteArt = resolveAresParachuteAnim(\n                    this.gameObject.rules.ares,\n                    this.rules.audioVisual.parachute,\n                    owner.country?.parachuteAnim,\n                    owner.country?.sideDefinition?.parachuteAnim,\n                );",
)

# TechnoRules currently only instantiates normalized Ares data for a narrow
# subset of keys. A Parachute.Anim-only or manual-control-only type otherwise
# silently loses its extension data at runtime.
techno_rules = "redalert2/src/game/rules/TechnoRules.ts"
replace(
    techno_rules,
    "            return normalized === \"poweredby\" ||\n                normalized === \"voiceifvrepair\" ||\n                /^weaponturretindex\\d+$/.test(normalized) ||\n                /^weaponuiname\\d+$/.test(normalized);",
    "            return normalized === \"poweredby\" ||\n                normalized === \"voiceifvrepair\" ||\n                normalized === \"parachute.anim\" ||\n                normalized === \"nomanualfire\" ||\n                normalized === \"noselfguardarea\" ||\n                /^weaponturretindex\\d+$/.test(normalized) ||\n                /^weaponuiname\\d+$/.test(normalized);",
)

# ---------------------------------------------------------------------------
# Ares rotating projectile animations driven by simulation age, not RAF time.
# ---------------------------------------------------------------------------
projectile_ext = "redalert2/src/extensions/ares/AresProjectileExtensions.ts"
replace(
    projectile_ext,
    "export interface AresRangedTravelDecision {",
    "export interface AresProjectileAnimationFrameInput {\n    direction: number;\n    rotates: boolean;\n    animLength: number;\n    animRate: number;\n    ageTicks: number;\n    frameCount: number;\n}\n\n/**\n * Resolve the SHP frame for Ares animated Rotates=yes projectiles. Each of\n * the 32 facings owns AnimLength consecutive frames. Simulation age is used\n * so render-frame rate cannot change the selected frame.\n */\nexport function resolveAresProjectileAnimationFrame(input: AresProjectileAnimationFrameInput): number {\n    const frameCount = Math.max(1, Math.floor(input.frameCount));\n    if (!input.rotates) return 0;\n    const animLength = Math.max(1, Math.floor(input.animLength));\n    const animRate = Math.max(1, Math.floor(input.animRate));\n    const facing = Math.round((((input.direction - 45 + 360) % 360) / 360) * 32) % 32;\n    const animationFrame = Math.floor(Math.max(0, input.ageTicks) / animRate) % animLength;\n    return Math.min(frameCount - 1, facing * animLength + animationFrame);\n}\n\nexport interface AresRangedTravelDecision {",
)

game_projectile = "redalert2/src/game/gameobject/Projectile.ts"
replace(
    game_projectile,
    "    /** Game tick the projectile spawned; used for wave expansion rendering. */\n    public spawnTick?: number;",
    "    /** Game tick the projectile spawned; used for wave expansion rendering. */\n    public spawnTick?: number;\n    /** Simulation-age clock for deterministic Ares projectile presentation. */\n    public ageTicks = 0;",
)
replace(
    game_projectile,
    "        super.update(game);\n        if (this.state === ProjectileState.Impact) {",
    "        super.update(game);\n        this.ageTicks++;\n        if (this.state === ProjectileState.Impact) {",
)

render_projectile = "redalert2/src/engine/renderable/entity/Projectile.ts"
replace(
    render_projectile,
    'import { PaletteType } from "@/engine/type/PaletteType";',
    'import { PaletteType } from "@/engine/type/PaletteType";\nimport { resolveAresProjectileAnimationFrame } from "@/extensions/ares/AresProjectileExtensions";',
)
replace(
    render_projectile,
    "        if (!this.vxlRotWrapper &&\n            this.lastDirection !== undefined &&\n            this.lastDirection === direction) {\n        }\n        else {\n            if (this.shpRenderable && this.shpRenderable.frameCount > 2) {",
    "        const animatedRotatingShape = !!this.shpRenderable &&\n            this.objectArt.rotates &&\n            (this.gameObject.rules.animLength ?? 1) > 1;\n        if (!this.vxlRotWrapper &&\n            !animatedRotatingShape &&\n            this.lastDirection !== undefined &&\n            this.lastDirection === direction) {\n        }\n        else {\n            if (this.shpRenderable && this.shpRenderable.frameCount > 2) {",
)
replace(
    render_projectile,
    "    updateShapeFrame(direction: number): void {\n        let frame = 0;\n        if (this.objectArt.rotates) {\n            frame = Math.round((((direction - 45 + 360) % 360) / 360) * 32) % 32;\n        }\n        this.shpRenderable!.setFrame(frame);\n    }",
    "    updateShapeFrame(direction: number): void {\n        const frame = resolveAresProjectileAnimationFrame({\n            direction,\n            rotates: !!this.objectArt.rotates,\n            animLength: this.gameObject.rules.animLength ?? 1,\n            animRate: this.gameObject.rules.animRate ?? 1,\n            ageTicks: this.gameObject.ageTicks ?? 0,\n            frameCount: this.shpRenderable!.frameCount,\n        });\n        this.shpRenderable!.setFrame(frame);\n    }",
)

# ---------------------------------------------------------------------------
# Focused regression tests.
# ---------------------------------------------------------------------------
(ROOT / "redalert2/src/test/compatibility/AresParachuteHierarchy.test.ts").write_text('''import { describe, expect, test } from "bun:test";\nimport { IniSection } from "@/data/IniSection";\nimport { AresCountryRegistry, AresSideRegistry } from "@/extensions/ares/AresSides";\nimport { parseAresTechnoExtensions, resolveAresParachuteAnim } from "@/extensions/ares/AresTechnoExtensions";\nimport { CountryRules } from "@/game/rules/CountryRules";\nimport { Country } from "@/game/Country";\n\ndescribe("Ares parachute precedence", () => {\n    test("resolves Techno then country then side then global", () => {\n        const techno = new IniSection("E1");\n        techno.set("Parachute.Anim", "TECHPARA");\n        const technoRules = parseAresTechnoExtensions(techno);\n        expect(resolveAresParachuteAnim(technoRules, "PARACH", "COUNTRYPARA", "SIDEPARA")).toBe("TECHPARA");\n        expect(resolveAresParachuteAnim(undefined, "PARACH", "COUNTRYPARA", "SIDEPARA")).toBe("COUNTRYPARA");\n        expect(resolveAresParachuteAnim(undefined, "PARACH", undefined, "SIDEPARA")).toBe("SIDEPARA");\n        expect(resolveAresParachuteAnim(undefined, "PARACH")).toBe("PARACH");\n    });\n\n    test("persists side/country parachute defaults into runtime Country", () => {\n        const sidesList = new IniSection("Sides");\n        sidesList.set("0", "Foehn");\n        const side = new IniSection("Foehn");\n        side.set("Parachute.Anim", "FOEHNPARA");\n        const countriesList = new IniSection("Countries");\n        countriesList.set("0", "Guild");\n        const country = new IniSection("Guild");\n        country.set("Side", "Foehn");\n        country.set("Multiplay", "yes");\n        country.set("Parachute.Anim", "GUILDPARA");\n        const sections = new Map([["Sides", sidesList], ["Foehn", side], ["Countries", countriesList], ["Guild", country]]);\n        const reader = { getSection: (name: string) => sections.get(name) };\n        const sides = AresSideRegistry.fromIni(reader);\n        const countries = AresCountryRegistry.fromIni(reader, sides);\n        expect(sides.resolve("Foehn")?.parachuteAnim).toBe("FOEHNPARA");\n        expect(countries.resolve("Guild")?.parachuteAnim).toBe("GUILDPARA");\n        const runtime = new Country(new CountryRules("Guild").readIni(country, sides));\n        expect(runtime.parachuteAnim).toBe("GUILDPARA");\n        expect(runtime.sideDefinition.parachuteAnim).toBe("FOEHNPARA");\n    });\n});\n''')

(ROOT / "redalert2/src/test/compatibility/AresProjectileAnimation.test.ts").write_text('''import { describe, expect, test } from "bun:test";\nimport { resolveAresProjectileAnimationFrame } from "@/extensions/ares/AresProjectileExtensions";\n\ndescribe("Ares projectile AnimLength/AnimRate", () => {\n    test("animates inside each rotating facing using simulation age", () => {\n        const common = { direction: 45, rotates: true, animLength: 4, animRate: 2, frameCount: 128 };\n        expect(resolveAresProjectileAnimationFrame({ ...common, ageTicks: 0 })).toBe(0);\n        expect(resolveAresProjectileAnimationFrame({ ...common, ageTicks: 1 })).toBe(0);\n        expect(resolveAresProjectileAnimationFrame({ ...common, ageTicks: 2 })).toBe(1);\n        expect(resolveAresProjectileAnimationFrame({ ...common, ageTicks: 6 })).toBe(3);\n        expect(resolveAresProjectileAnimationFrame({ ...common, ageTicks: 8 })).toBe(0);\n    });\n\n    test("keeps legacy one-frame facing layout when AnimLength is one", () => {\n        const direction = 90;\n        const expectedFacing = Math.round((((direction - 45 + 360) % 360) / 360) * 32) % 32;\n        expect(resolveAresProjectileAnimationFrame({ direction, rotates: true, animLength: 1, animRate: 1, ageTicks: 99, frameCount: 32 })).toBe(expectedFacing);\n        expect(resolveAresProjectileAnimationFrame({ direction, rotates: false, animLength: 4, animRate: 1, ageTicks: 99, frameCount: 8 })).toBe(0);\n    });\n});\n''')

(ROOT / "redalert2/src/test/compatibility/AresVeteranAbilityPsionics.test.ts").write_text('''import { describe, expect, test } from "bun:test";\nimport { IniSection } from "@/data/IniSection";\nimport { VeteranAbility } from "@/game/gameobject/unit/VeteranAbility";\n\ndescribe("Ares PSIONICSIMMUNE veteran ability", () => {\n    test("is a parseable VeteranAbilities token", () => {\n        const section = new IniSection("TESTUNIT");\n        section.set("VeteranAbilities", "PSIONICSIMMUNE");\n        expect(section.getEnumArray("VeteranAbilities", VeteranAbility)).toContain(VeteranAbility.PSIONICSIMMUNE);\n    });\n});\n''')

print("Applied second guarded Ares beta closure patch")
