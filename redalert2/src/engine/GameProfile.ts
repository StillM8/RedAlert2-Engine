import { EngineType } from "./EngineType";
import { gamePathKey, gamePathLeaf, tryNormalizeGamePath } from "./GamePath";

export type GameProfileId = "ra2" | "yr" | "mental-omega";

export type ExtensionRuntimeId = "ares";

export type ProfileFileAvailability = (filename: string) => boolean;

export interface GameProfileDescriptor {
    id: GameProfileId;
    engine: EngineType;
    displayName: string;
    requiredFiles: string[];
    extensionRuntime?: ExtensionRuntimeId;
    resourceProfile?: string;
    presentationProfile?: string;
    /** Profile-specific replacements for the engine's canonical INI names. */
    fileNameOverrides?: Readonly<Record<string, string>>;
    /** Optional profile files selected only when present in the mounted VFS. */
    optionalFileNameOverrides?: Readonly<Record<string, string>>;
    /** Additional CSF names loaded as profile-local string overrides. */
    stringFileCandidates?: readonly string[];
    /**
     * Resolve one of the engine's canonical filenames for this content
     * profile.  The availability callback is optional so scanners can inspect
     * the profile's preferred aliases without mounting a VFS first; runtime
     * callers should provide it to allow optional aliases to fall back to the
     * engine filename when the profile file is absent.
     */
    resolveCanonicalFile: (baseFileName: string, isAvailable?: ProfileFileAvailability) => string;
}

function normalizeProfileFileName(filename: string): string {
    return filename.trim().toLocaleLowerCase("en-US");
}

function engineVariantFileName(profile: Pick<GameProfileDescriptor, "engine">, baseFileName: string): string {
    if (profile.engine === EngineType.RedAlert2) {
        return baseFileName;
    }
    if (profile.engine === EngineType.YurisRevenge) {
        return baseFileName.replace(/\.([^.]+)$/, `md.$1`);
    }
    throw new Error(`Unsupported engine type ${EngineType[profile.engine]}`);
}

function createProfile(
    descriptor: Omit<GameProfileDescriptor, "resolveCanonicalFile">,
): GameProfileDescriptor {
    const profile = descriptor as GameProfileDescriptor;
    profile.resolveCanonicalFile = (baseFileName, isAvailable) => {
        const normalizedBaseFileName = normalizeProfileFileName(baseFileName);
        const requiredOverride = profile.fileNameOverrides?.[normalizedBaseFileName];
        if (requiredOverride) {
            return requiredOverride;
        }

        const optionalOverride = profile.optionalFileNameOverrides?.[normalizedBaseFileName];
        if (optionalOverride && (!isAvailable || isAvailable(optionalOverride))) {
            return optionalOverride;
        }

        return engineVariantFileName(profile, baseFileName);
    };
    return profile;
}

export const GAME_PROFILES: Record<GameProfileId, GameProfileDescriptor> = {
    ra2: createProfile({
        id: "ra2",
        engine: EngineType.RedAlert2,
        displayName: "Red Alert 2",
        requiredFiles: ["language.mix", "multi.mix", "ra2.mix"],
    }),
    yr: createProfile({
        id: "yr",
        engine: EngineType.YurisRevenge,
        displayName: "Yuri's Revenge",
        requiredFiles: ["language.mix", "multi.mix", "ra2.mix", "langmd.mix", "multimd.mix", "ra2md.mix"],
    }),
    "mental-omega": createProfile({
        id: "mental-omega",
        // Mental Omega is a Yuri's Revenge content profile.  Keeping the
        // simulation engine separate from the profile prevents MO-specific
        // branches from leaking into vanilla RA2/YR engine selection.
        engine: EngineType.YurisRevenge,
        displayName: "Mental Omega",
        requiredFiles: ["language.mix", "multi.mix", "ra2.mix", "langmd.mix", "multimd.mix", "ra2md.mix"],
        extensionRuntime: "ares",
        resourceProfile: "mental-omega",
        presentationProfile: "mental-omega",
        fileNameOverrides: {
            "rules.ini": "rulesmo.ini",
            "art.ini": "artmo.ini",
            "ai.ini": "aimo.ini",
        },
        optionalFileNameOverrides: {
            // MO 3.3.6 uses the standard YR `md` UI filename. It is packed
            // in expandmo##.mix, so this remains an optional profile alias
            // rather than a required loose file.
            "ui.ini": "uimd.ini",
            // The official MO client selects this profile sound index. The
            // file is packed in expandmo99.mix in the local 3.3.6 install.
            "sound.ini": "soundmo.ini",
            "missions.pkt": "missionsmo.pkt",
        },
        // MO 3.3 language resources keep the YR base table in ra2md.csf and
        // add profile-local tables in the expandmo archives.  These names are
        // looked up through VFS hash lookup, so MIX enumeration is not needed.
        stringFileCandidates: [
            "ra2mo.csf",
            "stringtable09.csf",
            "stringtable10.csf",
            "stringtable11.csf",
        ],
    }),
};

export function getGameProfile(id: GameProfileId | undefined): GameProfileDescriptor {
    return GAME_PROFILES[id ?? "ra2"];
}

export function isGameProfileId(value: string | null | undefined): value is GameProfileId {
    return value === "ra2" || value === "yr" || value === "mental-omega";
}

export interface MentalOmegaValidation {
    valid: boolean;
    version?: string;
    baseGameValid: boolean;
    extensionFilesValid: boolean;
    modFilesValid: boolean;
    missing: string[];
    warnings: string[];
}

function normalizedPathKeys(paths: Iterable<string>): Set<string> {
    const result = new Set<string>();
    for (const path of paths) {
        const normalized = tryNormalizeGamePath(path);
        if (!normalized) {
            continue;
        }
        result.add(gamePathKey(normalized));
        result.add(gamePathKey(gamePathLeaf(normalized)));
    }
    return result;
}

/**
 * Validate the content profile separately from vanilla profile detection.
 *
 * This intentionally is not used by detectGameProfile(): a plain YR folder
 * must remain YR unless the user explicitly selects Mental Omega.  The
 * validator only answers whether the selected folder contains the base YR
 * resources and recognizable MO content.
 */
export function validateMentalOmegaInstallation(paths: Iterable<string>): MentalOmegaValidation {
    const keys = normalizedPathKeys(paths);
    const missing: string[] = [];
    const warnings: string[] = [];
    const baseGameValid = GAME_PROFILES.yr.requiredFiles.every((file) => keys.has(gamePathKey(file)));
    if (!baseGameValid) {
        for (const file of GAME_PROFILES.yr.requiredFiles) {
            if (!keys.has(gamePathKey(file))) {
                missing.push(`Yuri's Revenge base resource: ${file}`);
            }
        }
    }

    const hasRules = keys.has("rulesmo.ini");
    const hasArt = keys.has("artmo.ini");
    const extensionFilesValid = hasRules && hasArt;
    if (!hasRules) {
        missing.push("Mental Omega rules: rulesmo.ini");
    }
    if (!hasArt) {
        missing.push("Mental Omega art: artmo.ini");
    }

    const hasMoArchive = [...keys].some((key) => /^expandmo\d{2}\.mix$/i.test(key));
    const hasMoLooseContent = [...keys].some((key) =>
        key === "uimd.ini" || key === "uimo.ini" || /(?:^|\/)mapsmo\//i.test(key) || /(?:^|\/)missionsmo\//i.test(key));
    const modFilesValid = hasMoArchive || hasMoLooseContent;
    if (!modFilesValid) {
        missing.push("Mental Omega content archive or MapsMO/MissionsMO files");
    }
    if (!keys.has("aimo.ini")) {
        warnings.push("aimo.ini was not found; Mental Omega AI may be unavailable for this installation.");
    }

    return {
        valid: baseGameValid && extensionFilesValid && modFilesValid,
        baseGameValid,
        extensionFilesValid,
        modFilesValid,
        missing,
        warnings,
    };
}

/**
 * Detect the vanilla game profile represented by a set of imported paths.
 *
 * The detector intentionally only knows about the two retail profiles on
 * this branch.  Paths may contain an imported directory prefix, but unsafe
 * entries are ignored so one malformed archive entry cannot make an
 * otherwise valid installation appear broken.
 */
export function detectGameProfile(paths: Iterable<string>): GameProfileId {
    const filenames = new Set<string>();

    for (const path of paths) {
        const normalized = tryNormalizeGamePath(path);
        if (!normalized) {
            continue;
        }
        filenames.add(gamePathKey(gamePathLeaf(normalized)));
    }

    const hasAll = (requiredFiles: readonly string[]) =>
        requiredFiles.every((file) => filenames.has(gamePathKey(file)));

    if (hasAll(GAME_PROFILES.yr.requiredFiles)) {
        return "yr";
    }
    return "ra2";
}
