/**
 * Shared Ares ParticleSystem/Particle definitions.
 *
 * Particle systems are rule objects, not animations.  Keeping their parsed
 * relationship here lets damage effects, weapon bolts, and later terrain or
 * superweapon effects consume the same authored data without teaching each
 * renderer about INI sections.
 */

export interface AresParticleTypeRules {
    id: string;
    image?: string;
    behavesLike?: string;
    maxEC?: number;
    maxDC?: number;
    damage?: number;
    warhead?: string;
    velocity?: number;
    deacc?: number;
    windEffect?: number;
    translucency?: number;
    translucent?: boolean;
    deleteOnStateLimit?: boolean;
    endStateAI?: number;
    stateAIAdvance?: number;
    xVelocity?: number;
    yVelocity?: number;
    minZVelocity?: number;
    zVelocityRange?: number;
    colorList?: number[][];
    colorSpeed?: number;
}

export interface AresParticleSystemRules {
    id: string;
    holdsWhat?: string;
    behavesLike?: string;
    particle?: AresParticleTypeRules;
    particleCap?: number;
    spawnFrames?: number;
    spawnRadius?: number;
    slowdown?: number;
    spawnCutoff?: number;
    spawnTranslucencyCutoff?: number;
    spawnSparkPercentage?: number;
    lightSize?: number;
    oneFrameLight?: boolean;
}

interface IniSection {
    entries: Map<string, unknown>;
    has(key: string): boolean;
    getString(key: string, defaultValue?: string): string | undefined;
    getBool(key: string, defaultValue?: boolean): boolean;
    getNumber(key: string, defaultValue?: number): number;
}

interface IniFile {
    /** Keep this boundary structural so Rules' lightweight INI interface can pass through. */
    getSection(name: string): any;
}

function normalizeId(id: string): string {
    return id.trim().toLocaleLowerCase("en-US");
}

function optionalString(section: IniSection, key: string): string | undefined {
    const value = section.getString(key)?.trim();
    return value && value.toLocaleLowerCase("en-US") !== "none" ? value : undefined;
}

function optionalNumber(section: IniSection, key: string): number | undefined {
    if (!section.has(key)) return undefined;
    return section.getNumber(key);
}

function parseColorList(value: string | undefined): number[][] | undefined {
    if (!value) return undefined;
    const colors = [...value.matchAll(/\(([^)]+)\)/g)]
        .map(match => match[1].split(",").map(component => Number(component.trim())))
        .filter(color => color.length >= 3 && color.every(component => Number.isFinite(component)))
        .map(color => color.slice(0, 3));
    return colors.length ? colors : undefined;
}

function readList(ini: IniFile, sectionName: string): string[] {
    const section = ini.getSection(sectionName);
    if (!section) return [];
    return [...section.entries.values()]
        .filter((value): value is string => typeof value === "string")
        .map(value => value.trim())
        .filter(Boolean);
}

export function parseAresParticleTypeRules(
    ini: IniFile,
): ReadonlyMap<string, AresParticleTypeRules> {
    const result = new Map<string, AresParticleTypeRules>();
    for (const id of readList(ini, "Particles")) {
        const section = ini.getSection(id);
        if (!section) continue;
        result.set(normalizeId(id), {
            id,
            image: optionalString(section, "Image"),
            behavesLike: optionalString(section, "BehavesLike"),
            maxEC: optionalNumber(section, "MaxEC"),
            maxDC: optionalNumber(section, "MaxDC"),
            damage: optionalNumber(section, "Damage"),
            warhead: optionalString(section, "Warhead"),
            velocity: optionalNumber(section, "Velocity"),
            deacc: optionalNumber(section, "Deacc"),
            windEffect: optionalNumber(section, "WindEffect"),
            translucency: optionalNumber(section, "Translucency"),
            translucent: section.has("Translucent")
                ? section.getBool("Translucent")
                : undefined,
            deleteOnStateLimit: section.has("DeleteOnStateLimit")
                ? section.getBool("DeleteOnStateLimit")
                : undefined,
            endStateAI: optionalNumber(section, "EndStateAI"),
            stateAIAdvance: optionalNumber(section, "StateAIAdvance"),
            xVelocity: optionalNumber(section, "XVelocity"),
            yVelocity: optionalNumber(section, "YVelocity"),
            minZVelocity: optionalNumber(section, "MinZVelocity"),
            zVelocityRange: optionalNumber(section, "ZVelocityRange"),
            colorList: parseColorList(section.getString("ColorList")),
            colorSpeed: optionalNumber(section, "ColorSpeed"),
        });
    }
    return result;
}

export function parseAresParticleSystemRules(
    ini: IniFile,
    particleTypes: ReadonlyMap<string, AresParticleTypeRules>,
): ReadonlyMap<string, AresParticleSystemRules> {
    const result = new Map<string, AresParticleSystemRules>();
    for (const id of readList(ini, "ParticleSystems")) {
        const section = ini.getSection(id);
        if (!section) continue;
        const holdsWhat = optionalString(section, "HoldsWhat");
        result.set(normalizeId(id), {
            id,
            holdsWhat,
            behavesLike: optionalString(section, "BehavesLike"),
            particle: holdsWhat
                ? particleTypes.get(normalizeId(holdsWhat))
                : undefined,
            particleCap: optionalNumber(section, "ParticleCap"),
            spawnFrames: optionalNumber(section, "SpawnFrames"),
            spawnRadius: optionalNumber(section, "SpawnRadius"),
            slowdown: optionalNumber(section, "Slowdown"),
            spawnCutoff: optionalNumber(section, "SpawnCutoff"),
            spawnTranslucencyCutoff: optionalNumber(section, "SpawnTranslucencyCutoff"),
            spawnSparkPercentage: optionalNumber(section, "SpawnSparkPercentage"),
            lightSize: optionalNumber(section, "LightSize"),
            oneFrameLight: section.has("OneFrameLight")
                ? section.getBool("OneFrameLight")
                : undefined,
        });
    }
    return result;
}

export function resolveAresParticleSystems(
    ids: readonly string[] | undefined,
    definitions: ReadonlyMap<string, AresParticleSystemRules> | undefined,
): AresParticleSystemRules[] {
    return (ids ?? [])
        .map(id => id.trim())
        .filter(Boolean)
        .map(id => definitions?.get(normalizeId(id)) ?? { id });
}
