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
