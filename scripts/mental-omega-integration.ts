/**
 * Verifies one real, user-owned Mental Omega rules path against the generic
 * Ares runtime model. No proprietary content is copied or written.
 *
 * Usage:
 *   bun scripts/mental-omega-integration.ts /path/to/RA2-MO-install
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { IniFile } from "../redalert2/src/data/IniFile";
import { IniSourceLoader } from "../redalert2/src/engine/IniSourceLoader";
import { Rules } from "../redalert2/src/game/rules/Rules";
import { parseAresAnimationDamage } from "../redalert2/src/extensions/ares/AresAnimationDamage";
import { parseAresAttachEffectDefinition } from "../redalert2/src/extensions/ares/AresAttachEffect";
import { createMentalOmegaVfs } from "./mental-omega-content";

const installRoot = resolve(process.argv[2] ?? process.env.MO_INSTALL_DIR ?? "");

if (!installRoot || !existsSync(installRoot)) {
    console.error("Usage: bun scripts/mental-omega-integration.ts /path/to/RA2-MO-install");
    process.exit(2);
}

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

const { vfs, archives } = createMentalOmegaVfs(installRoot);
const loader = new IniSourceLoader(vfs);
const effectiveRules = loader.loadEffectiveIni("rulesmo.ini")?.ini ??
    (vfs.fileExists("rulesmo.ini") ? new IniFile(vfs.openFile("rulesmo.ini")) : undefined);

if (!effectiveRules) {
    console.error("FAIL: rulesmo.ini was not found in the mounted Mental Omega MIX layers");
    process.exit(1);
}

const rules = new Rules(effectiveRules, { debug: () => undefined });
const effectiveArt = loader.loadEffectiveIni("artmo.ini")?.ini;
const attachedProjectiles = effectiveRules.getOrderedSections()
    .filter((section) => section.has("AttachedSystem"))
    .map((section) => ({
        name: section.name,
        attachedSystem: section.getString("AttachedSystem").trim(),
    }));
const failures: string[] = [];
const verified = attachedProjectiles.map(({ name, attachedSystem }) => {
    const projectile = rules.getProjectile(name);
    const system = rules.aresParticleSystemRules.get(normalize(attachedSystem));
    if (!system) {
        failures.push(`${name}: ParticleSystem ${attachedSystem} was not resolved`);
    }
    else if (normalize(system.behavesLike ?? "") !== "smoke") {
        failures.push(`${name}: AttachedSystem ${attachedSystem} is not BehavesLike=Smoke`);
    }
    else if (!system.particle?.image) {
        failures.push(`${name}: AttachedSystem ${attachedSystem} has no Particle.Image`);
    }
    if (projectile.attachedSystem !== attachedSystem) {
        failures.push(`${name}: ProjectileRules lost AttachedSystem=${attachedSystem}`);
    }
    return {
        projectile: name,
        attachedSystem,
        image: system?.particle?.image,
    };
});

const attachedAnimations = [...effectiveRules.getOrderedSections()]
    .map((section) => parseAresAttachEffectDefinition(section).animation)
    .filter((name): name is string => !!name);
const animationDamage = [...new Set(attachedAnimations)].map((name) => {
    const definition = parseAresAnimationDamage(name, effectiveArt?.getSection(name));
    if (!definition) {
        failures.push(`${name}: AttachEffect animation art section was not resolved`);
    }
    return {
        animation: name,
        damage: definition?.damage ?? 0,
        damageDelay: definition?.damageDelay ?? 0,
        warhead: definition?.warhead,
        weapon: definition?.weapon,
    };
});
const standaloneAnimationDamage = (effectiveArt?.getOrderedSections() ?? [])
    .map((section) => parseAresAnimationDamage(section.name, section))
    .filter((definition): definition is NonNullable<typeof definition> => !!definition && definition.damage > 0)
    .map((definition) => ({
        animation: definition.name,
        damage: definition.damage,
        damageDelay: definition.damageDelay,
        warhead: definition.warhead,
        weapon: definition.weapon,
        end: definition.end,
        loopCount: definition.loopCount,
    }));

const result = {
    status: failures.length === 0 && attachedProjectiles.length > 0 ? "PASS" : "FAIL",
    archives: archives.length,
    projectilesWithAttachedSystem: attachedProjectiles.length,
    verified,
    attachedAnimationsWithDamage: animationDamage.filter((entry) => entry.damage > 0),
    standaloneAnimationsWithDamage: standaloneAnimationDamage,
    failures,
    scope: "rules/art parser plus shared AttachedSystem and standalone/attached Animation damage resolution; not a rendered match or multiplayer certification",
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "PASS" ? 0 : 1;
