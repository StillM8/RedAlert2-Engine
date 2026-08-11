/**
 * Raw cameo fields supplied by a rules/art loader. The legacy values are
 * retained as fallbacks; PCX fields are validated without changing their
 * authored case or adding an extension.
 */
export interface AresPcxCameoFields {
    readonly cameoPcx?: unknown;
    readonly altCameoPcx?: unknown;
    readonly sidebarPcx?: unknown;
    readonly cameo?: unknown;
    readonly altCameo?: unknown;
    readonly sidebarImage?: unknown;
}

/** Normalized, case-preserving cameo asset names. */
export interface AresPcxCameoDefinition {
    readonly cameoPcx?: string;
    readonly altCameoPcx?: string;
    readonly sidebarPcx?: string;
    readonly cameo?: string;
    readonly altCameo?: string;
    readonly sidebarImage?: string;
}

export type AresPcxCameoResolutionSource = "pcx" | "legacy" | "none";
export type AresPcxCameoResolutionField =
    | "CameoPCX"
    | "AltCameoPCX"
    | "Cameo"
    | "AltCameo"
    | "SidebarPCX"
    | "SidebarImage";

export interface AresPcxCameoResolution {
    readonly source: AresPcxCameoResolutionSource;
    readonly field?: AresPcxCameoResolutionField;
    /** The original authored case is retained for the eventual asset lookup. */
    readonly assetName?: string;
}

/**
 * Asset names collected for the existing HUD path. SHPs remain the
 * renderable aggregate; PCXs are retained separately because the current
 * sidebar renderer consumes indexed SHP frames, not RGBA PCX surfaces.
 */
export interface AresPcxCameoAssetManifest {
    readonly shpFilenames: readonly string[];
    readonly pcxFilenames: readonly string[];
}

/** Ares' documented cameo surface size. No resize or dimension synthesis is performed. */
export const ARES_PCX_CAMEO_WIDTH = 60;
export const ARES_PCX_CAMEO_HEIGHT = 48;

export function isAresPcxCameoSize(width: unknown, height: unknown): boolean {
    return width === ARES_PCX_CAMEO_WIDTH && height === ARES_PCX_CAMEO_HEIGHT;
}

const NONE: AresPcxCameoResolution = { source: "none" };

function trimString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function normalizePcxName(value: unknown): string | undefined {
    const name = trimString(value);
    return name !== undefined && /\.pcx$/i.test(name) ? name : undefined;
}

/**
 * Normalizes the documented PCX fields while preserving case. Ares requires
 * the `.pcx` extension in the authored value, so malformed PCX names are
 * omitted and can safely fall back to their legacy asset.
 */
export function normalizeAresPcxCameos(
    fields: AresPcxCameoFields,
): AresPcxCameoDefinition {
    return {
        cameoPcx: normalizePcxName(fields.cameoPcx),
        altCameoPcx: normalizePcxName(fields.altCameoPcx),
        sidebarPcx: normalizePcxName(fields.sidebarPcx),
        cameo: trimString(fields.cameo),
        altCameo: trimString(fields.altCameo),
        sidebarImage: trimString(fields.sidebarImage),
    };
}

function resolve(
    candidates: readonly (readonly [AresPcxCameoResolutionField, AresPcxCameoResolutionSource, string | undefined])[],
): AresPcxCameoResolution {
    const candidate = candidates.find(([, , assetName]) => assetName !== undefined);
    if (candidate === undefined) return NONE;
    return { source: candidate[1], field: candidate[0], assetName: candidate[2] };
}

/**
 * Resolves a techno cameo using Antares' PCX precedence. Promoted techos use
 * AltCameoPCX first, then CameoPCX, then the legacy alternate/base cameo.
 * Ordinary techos use CameoPCX before the legacy base cameo.
 */
export function resolveAresTechnoCameo(
    definition: AresPcxCameoDefinition,
    promoted: boolean,
): AresPcxCameoResolution {
    if (promoted) {
        return resolve([
            ["AltCameoPCX", "pcx", definition.altCameoPcx],
            ["CameoPCX", "pcx", definition.cameoPcx],
            ["AltCameo", "legacy", definition.altCameo],
            ["Cameo", "legacy", definition.cameo],
        ]);
    }

    return resolve([
        ["CameoPCX", "pcx", definition.cameoPcx],
        ["Cameo", "legacy", definition.cameo],
    ]);
}

/** Resolves a superweapon sidebar cameo, preferring SidebarPCX. */
export function resolveAresSidebarCameo(
    definition: AresPcxCameoDefinition,
): AresPcxCameoResolution {
    return resolve([
        ["SidebarPCX", "pcx", definition.sidebarPcx],
        ["SidebarImage", "legacy", definition.sidebarImage],
    ]);
}

/**
 * Builds a non-mutating asset manifest while preserving authored PCX case.
 * Availability is supplied by the caller so the adapter does not depend on
 * a particular VFS or image implementation. A failed availability probe is
 * treated as absent and leaves the legacy SHP fallback intact.
 */
export function createAresPcxCameoAssetManifest(
    shpFilenames: readonly string[],
    definitions: readonly AresPcxCameoDefinition[],
    pcxAvailable: (filename: string) => boolean = () => true,
): AresPcxCameoAssetManifest {
    const pcxFilenames: string[] = [];
    const seenPcxNames = new Set<string>();

    for (const definition of definitions) {
        for (const filename of [
            definition.cameoPcx,
            definition.altCameoPcx,
            definition.sidebarPcx,
        ]) {
            if (filename === undefined) continue;

            const key = filename.toLocaleLowerCase("en-US");
            if (seenPcxNames.has(key)) continue;

            let available = false;
            try {
                available = pcxAvailable(filename);
            } catch {
                available = false;
            }
            if (!available) continue;

            seenPcxNames.add(key);
            pcxFilenames.push(filename);
        }
    }

    return {
        shpFilenames: [...shpFilenames],
        pcxFilenames,
    };
}
