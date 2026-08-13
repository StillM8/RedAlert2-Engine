/**
 * Ares weapon visual extensions shared by the rules and render layers.
 *
 * Ares stores RGB values as `(R,G,B)` strings in a weapon section.  Keep the
 * parser independent of the renderer so authored values can be tested and
 * consumed consistently on every platform.
 */

export type AresRgb = readonly [number, number, number];

export interface AresWeaponVisualRules {
    beamColor?: AresRgb;
    beamDuration: number;
    beamAmplitude: number;
    beamIsHouseColor: boolean;
    boltColors: readonly [AresRgb | undefined, AresRgb | undefined, AresRgb | undefined];
    waveIsLaser: boolean;
    waveIsBigLaser: boolean;
    waveColor?: AresRgb;
    waveIsHouseColor: boolean;
    waveReverseAgainstVehicles: boolean;
    waveReverseAgainstAircraft: boolean;
    waveReverseAgainstBuildings: boolean;
    waveReverseAgainstInfantry: boolean;
    waveReverseAgainstOthers: boolean;
}

interface IniSectionLike {
    has(key: string): boolean;
    getBool(key: string, defaultValue?: boolean): boolean;
    getNumber(key: string, defaultValue?: number): number;
    getString(key: string, defaultValue?: string): string;
}

interface IniFileLike {
    getSection(name: string): { entries: Map<string, string | string[]> } | undefined;
}

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

/** Parses an Ares `(R,G,B)` value while tolerating whitespace and parentheses. */
export function parseAresRgb(value: string | undefined): AresRgb | undefined {
    if (!value) return undefined;
    const components = [...value.matchAll(/[-+]?\d+(?:\.\d+)?/g)]
        .slice(0, 3)
        .map((match) => Number(match[0]));
    if (components.length !== 3 || components.some((component) => !Number.isFinite(component))) {
        return undefined;
    }
    return [
        clampByte(components[0]),
        clampByte(components[1]),
        clampByte(components[2]),
    ];
}

function optionalRgb(section: IniSectionLike, key: string): AresRgb | undefined {
    return section.has(key) ? parseAresRgb(section.getString(key)) : undefined;
}

/**
 * Parses the Ares weapon visual fields and their documented defaults.
 * Missing Bolt colors intentionally stay undefined: the renderer supplies
 * the palette-dependent vanilla fallback independently for each color slot.
 */
export function parseAresWeaponVisualRules(
    section: IniSectionLike,
    isMagBeam = section.getBool("IsMagBeam"),
): AresWeaponVisualRules {
    return {
        beamColor: optionalRgb(section, "Beam.Color"),
        beamDuration: section.has("Beam.Duration")
            ? section.getNumber("Beam.Duration", 15)
            : 15,
        beamAmplitude: section.has("Beam.Amplitude")
            ? section.getNumber("Beam.Amplitude", 40)
            : 40,
        beamIsHouseColor: section.getBool("Beam.IsHouseColor"),
        boltColors: [
            optionalRgb(section, "Bolt.Color1"),
            optionalRgb(section, "Bolt.Color2"),
            optionalRgb(section, "Bolt.Color3"),
        ],
        waveIsLaser: section.getBool("Wave.IsLaser"),
        waveIsBigLaser: section.getBool("Wave.IsBigLaser"),
        waveColor: optionalRgb(section, "Wave.Color"),
        waveIsHouseColor: section.getBool("Wave.IsHouseColor"),
        waveReverseAgainstVehicles: section.has("Wave.ReverseAgainstVehicles")
            ? section.getBool("Wave.ReverseAgainstVehicles")
            : isMagBeam,
        waveReverseAgainstAircraft: section.getBool("Wave.ReverseAgainstAircraft"),
        waveReverseAgainstBuildings: section.getBool("Wave.ReverseAgainstBuildings"),
        waveReverseAgainstInfantry: section.getBool("Wave.ReverseAgainstInfantry"),
        waveReverseAgainstOthers: section.getBool("Wave.ReverseAgainstOthers"),
    };
}

/** Reads Ares' standalone [WeaponTypes] declarations in authored order. */
export function parseAresWeaponTypeNames(ini: IniFileLike): string[] {
    const section = ini.getSection("WeaponTypes");
    if (!section) return [];
    const names: string[] = [];
    for (const value of section.entries.values()) {
        const values = Array.isArray(value) ? value : [value];
        for (const name of values) {
            const normalized = name.trim();
            if (normalized) names.push(normalized);
        }
    }
    return names;
}
