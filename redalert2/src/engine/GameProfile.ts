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
     * Authoritative multiplayer map catalogs supplied by this content
     * profile. When present, map discovery can use these indexes without
     * mounting unrelated deferred gameplay archives first.
     */
    multiplayerMapListFiles?: readonly string[];
    /** Content roots that contain scenarios which must not enter multiplayer map discovery. */
    nonMultiplayerMapRoots?: readonly string[];
    campaignIniFiles?: readonly string[];
    campaignFileNameOverrides?: Readonly<Record<string, string>>;
    campaignArchiveNames?: readonly string[];
    campaignRoots?: readonly string[];
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
        if (/(?:^|\/)battleclient[^/]*\.ini$/i.test(baseFileName)) {
            return baseFileName;
        }
        const lastDot = baseFileName.lastIndexOf(".");
        const stem = lastDot < 0 ? "" : baseFileName.slice(0, lastDot);
        return stem.toLocaleLowerCase("en-US").endsWith("md")
            ? baseFileName
            : baseFileName.replace(/\.([^.]+)$/, `md.$1`);
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

        const campaignOverride = profile.campaignFileNameOverrides?.[normalizedBaseFileName];
        if (campaignOverride && (!isAvailable || isAvailable(campaignOverride))) {
            return campaignOverride;
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
        campaignIniFiles: ["battle.ini", "mission.ini", "mapsel01.ini"],
        campaignRoots: ["Campaign", "Campaigns", "Missions"],
    }),
    yr: createProfile({
        id: "yr",
        engine: EngineType.YurisRevenge,
        displayName: "Yuri's Revenge",
        requiredFiles: ["language.mix", "multi.mix", "ra2.mix", "langmd.mix", "multimd.mix", "ra2md.mix"],
        campaignIniFiles: ["battlemd.ini", "missionmd.ini", "mapselmd.ini"],
        campaignFileNameOverrides: {
            "battle.ini": "battlemd.ini",
            "mission.ini": "missionmd.ini",
            "mapsel01.ini": "mapselmd.ini",
        },
        campaignRoots: ["Campaign", "Campaigns", "Missions"],
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
            // MO ships its own EVA table in the same profile archives. Keep
            // the canonical `eva.ini` lookup profile-aware while retaining
            // Yuri's `evamd.ini` as the fallback for incomplete imports.
            "eva.ini": "evamo.ini",
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
        // The CnCNet client declaration points at this multiplayer catalog.
        // Keeping the path at the profile boundary lets the shared engine use
        // the same catalog machinery for any content package.
        multiplayerMapListFiles: ["INI/MentalOmegaMaps.ini"],
        nonMultiplayerMapRoots: ["MissionsMO", "Campaign", "Campaigns", "Missions"],
        campaignIniFiles: ["missionmo.ini", "mapselmo.ini"],
        campaignFileNameOverrides: {
            "battle.ini": "battlemo.ini",
            "battlemd.ini": "battlemo.ini",
            "mission.ini": "missionmo.ini",
            "missionmd.ini": "missionmo.ini",
            "mapsel01.ini": "mapselmo.ini",
            "mapselmd.ini": "mapselmo.ini",
        },
        campaignArchiveNames: ["campaign.mix", "missionsmo.mix", "missionmo.mix", "battlemo.mix", "expandmo42.mix"],
        campaignRoots: ["MissionsMO", "Campaign", "Campaigns", "Missions"],
    }),
};

export function getGameProfile(id: GameProfileId | undefined): GameProfileDescriptor {
    return GAME_PROFILES[id ?? "ra2"];
}

export function isGameProfileId(value: string | null | undefined): value is GameProfileId {
    return value === "ra2" || value === "yr" || value === "mental-omega";
}

const mentalOmegaCampaignLeafPattern = /^(?:missionmo|mapselmo|battlemo|battleclient[^/]*)\.ini$/i;
const campaignDirectoryPattern = /^(?:campaign|campaigns|missions?|missionsmd|missionsmo|mapsmo|mapsmo\d+)$/i;
const battleClientPathPattern = /(?:^|\/)ini\/battleclient[^/]*\.ini$/i;

function isCampaignDirectoryPath(path: string): boolean {
    const segments = path.toLocaleLowerCase("en-US").split("/");
    return segments.some((segment) => campaignDirectoryPattern.test(segment));
}

function isBattleClientIniPath(path: string): boolean {
    const lower = path.toLocaleLowerCase("en-US");
    return battleClientPathPattern.test(lower) || /(?:^|\/)battleclient[^/]*\.ini$/i.test(lower);
}

export function isMentalOmegaCampaignPath(path: string): boolean {
    const normalized = tryNormalizeGamePath(path);
    if (!normalized) {
        return false;
    }
    const lower = normalized.toLocaleLowerCase("en-US");
    const leaf = gamePathKey(gamePathLeaf(normalized));
    return /^expandmo\d{2}\.mix$/.test(leaf) ||
        /^(?:missions?mo|battlemo|campaignmo|movmo|mapsmo\d*|multimo)\d*\.mix$/.test(leaf) ||
        mentalOmegaCampaignLeafPattern.test(leaf) ||
        isBattleClientIniPath(lower) ||
        isCampaignDirectoryPath(lower);
}

export function hasMentalOmegaCampaignSignature(paths: Iterable<string>): boolean {
    for (const path of paths) {
        if (isMentalOmegaCampaignPath(path)) {
            return true;
        }
    }
    return false;
}

function hasYuriCampaignSignature(paths: readonly string[]): boolean {
    return paths.some((path) => {
        const lower = path.toLocaleLowerCase("en-US");
        const leaf = gamePathKey(gamePathLeaf(lower));
        return /^(?:battlemd|missionmd|mapselmd)\.ini$/.test(leaf) ||
            lower.endsWith(".yro");
    });
}

function hasRedAlertCampaignSignature(paths: readonly string[]): boolean {
    return paths.some((path) => {
        const leaf = gamePathKey(gamePathLeaf(path));
        return /^(?:battle|mission)\.ini$/.test(leaf) || /^mapsel01\.ini$/.test(leaf);
    });
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
    const normalizedPaths = [...paths]
        .map((path) => tryNormalizeGamePath(path))
        .filter((path): path is string => !!path);
    const keys = normalizedPathKeys(normalizedPaths);
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
        key === "uimd.ini" || key === "uimo.ini" || key === "rulesmo.ini" || key === "artmo.ini" ||
        /(?:^|\/)mapsmo\//i.test(key) || /(?:^|\/)missionsmo\//i.test(key)) ||
        hasMentalOmegaCampaignSignature(normalizedPaths);
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
    const normalizedPaths = [...paths]
        .map((path) => tryNormalizeGamePath(path))
        .filter((path): path is string => !!path);
    const filenames = new Set(normalizedPaths.map((path) => gamePathKey(gamePathLeaf(path))));
    const lowerPaths = normalizedPaths.map((path) => path.toLocaleLowerCase("en-US"));

    const hasAll = (requiredFiles: readonly string[]) =>
        requiredFiles.every((file) => filenames.has(gamePathKey(file)));

    if (hasAll(GAME_PROFILES.yr.requiredFiles) ||
        hasYuriCampaignSignature(lowerPaths) ||
        hasMentalOmegaCampaignSignature(normalizedPaths)) {
        return "yr";
    }
    return "ra2";
}

/**
 * Detect the runtime family represented by a base install or an imported mod
 * package. Unlike detectGameProfile(), this also understands the partial
 * Yuri/Ares signatures commonly shipped by mods that deliberately omit the
 * retail base archives. Mental Omega remains explicit at the runtime-profile
 * level because it is a YR mod, not a third simulation engine.
 */
export function detectContentProfile(paths: Iterable<string>): GameProfileId {
    const normalizedPaths = [...paths]
        .map((path) => tryNormalizeGamePath(path))
        .filter((path): path is string => !!path);
    const lowerPaths = normalizedPaths.map((path) => path.toLocaleLowerCase("en-US"));
    const hasMentalOmega = hasMentalOmegaCampaignSignature(normalizedPaths) ||
        lowerPaths.some((path, index) =>
            /(?:^|\/)rulesmo\.ini$/.test(path) || /(?:^|\/)artmo\.ini$/.test(path));
    if (hasMentalOmega) {
        return "mental-omega";
    }
    const hasYuriOverlay = hasYuriCampaignSignature(lowerPaths) || lowerPaths.some((path) =>
        /(?:^|\/)(?:rulesmd|artmd|aimd|uimd|evamd|soundmd)\.ini$/.test(path) ||
        /(?:^|\/)(?:langmd|multimd|ra2md|expandmd\d{2})\.mix$/.test(path));
    if (hasYuriOverlay) {
        return "yr";
    }
    if (hasRedAlertCampaignSignature(normalizedPaths)) {
        return "ra2";
    }
    return detectGameProfile(normalizedPaths);
}
