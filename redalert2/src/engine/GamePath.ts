/**
 * Paths in the original RA2/YR ecosystem are Windows paths: separators are
 * interchangeable and lookups are case-insensitive. Keep that rule in one
 * place instead of spreading ad-hoc toLowerCase() calls through the VFS.
 */
export function normalizeGamePath(path: string): string {
    const replaced = path.replace(/\\/g, "/");
    if (replaced.startsWith("/") || /^[A-Za-z]:([/]|$)/.test(replaced)) {
        throw new Error(`Absolute game path is not allowed: "${path}"`);
    }
    const segments = replaced.split("/");
    const normalized: string[] = [];
    for (const segment of segments) {
        if (!segment || segment === ".") {
            continue;
        }
        if (segment === ".." || segment.includes("\0") || segment.includes(":")) {
            throw new Error(`Unsafe game path: "${path}"`);
        }
        normalized.push(segment);
    }
    if (!normalized.length) {
        throw new Error(`Empty game path: "${path}"`);
    }
    return normalized.join("/");
}

export function gamePathKey(path: string): string {
    return normalizeGamePath(path).toLocaleLowerCase("en-US");
}

export function tryNormalizeGamePath(path: string): string | undefined {
    try {
        return normalizeGamePath(path);
    }
    catch {
        return undefined;
    }
}

export function gamePathLeaf(path: string): string {
    return normalizeGamePath(path).split("/").pop()!;
}

export interface FileProviderCopySuffix {
    canonicalSegment: string;
    copyIndex: number;
}

/**
 * Android document providers and desktop file managers commonly preserve a
 * second same-name copy as `name (1).ext` (or `Directory (1)`). That suffix
 * is storage provenance, not part of the Windows game-resource identity.
 * Callers must still prove that a canonical sibling exists before collapsing
 * arbitrary authored names such as `Arena (1).map`.
 */
export function parseFileProviderCopySuffix(segment: string): FileProviderCopySuffix | undefined {
    const match = segment.match(/^(.*?)\s+\((\d+)\)(\.[^/]*)?$/);
    if (!match?.[1]) {
        return undefined;
    }
    const copyIndex = Number(match[2]);
    if (!Number.isSafeInteger(copyIndex) || copyIndex < 1) {
        return undefined;
    }
    return {
        canonicalSegment: `${match[1]}${match[3] ?? ""}`,
        copyIndex,
    };
}

/** Strip file-provider copy suffixes without changing case or separators. */
export function canonicalizeFileProviderCopyPath(path: string): string {
    return normalizeGamePath(path)
        .split("/")
        .map((segment) => parseFileProviderCopySuffix(segment)?.canonicalSegment ?? segment)
        .join("/");
}

/**
 * Compare provider-copy generations from root to leaf. A copied directory is
 * a coherent later tree and therefore outranks a leaf copied inside an older
 * tree. Positive means `a` is the later generation.
 */
export function compareFileProviderCopyGeneration(a: string, b: string): number {
    const aSegments = normalizeGamePath(a).split("/");
    const bSegments = normalizeGamePath(b).split("/");
    const length = Math.max(aSegments.length, bSegments.length);
    for (let index = 0; index < length; index++) {
        const aCopy = parseFileProviderCopySuffix(aSegments[index] ?? "")?.copyIndex ?? 0;
        const bCopy = parseFileProviderCopySuffix(bSegments[index] ?? "")?.copyIndex ?? 0;
        if (aCopy !== bCopy) {
            return aCopy - bCopy;
        }
    }
    return 0;
}
