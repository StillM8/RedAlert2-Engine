/**
 * Resolves the filename syntax used by Ares CustomPalette.
 *
 * Ares replaces the first three tildes with the active theater extension
 * (for example `laser~~~.pal` becomes `lasertem.pal`).  An explicitly
 * suffixed filename is already complete and must not receive a second
 * theater suffix.  The helper also retains the retail Palette= fallback
 * candidates for callers that provide a basename rather than a filename.
 */
export function expandAresCustomPaletteName(filename: string, theaterExtension: string): string {
    const normalized = filename.trim().replace(/^\.+/, "");
    const extension = theaterExtension.replace(/^\.+/, "").slice(0, 3);
    return normalized.replace("~~~", extension);
}

export function getAresCustomPaletteCandidates(filename: string, theaterExtension: string): string[] {
    const raw = filename.trim();
    if (!raw) return [];

    const expanded = expandAresCustomPaletteName(raw, theaterExtension);
    if (expanded.toLocaleLowerCase("en-US") === "lib") {
        return ["lib"];
    }

    const candidates = expanded.toLocaleLowerCase("en-US").endsWith(".pal")
        ? [expanded]
        : [
            `${expanded}${theaterExtension.replace(/^\./, "")}.pal`,
            `${expanded}.pal`,
        ];
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
        const key = candidate.toLocaleLowerCase("en-US");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
