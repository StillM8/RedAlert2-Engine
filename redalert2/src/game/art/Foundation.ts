export interface FoundationCell {
    x: number;
    y: number;
}

export interface Foundation {
    width: number;
    height: number;
    /** Explicit occupied cells for Ares Foundation=Custom definitions. */
    cells?: readonly FoundationCell[];
    /** Optional outline cells used by factory/placement logic. */
    outline?: readonly FoundationCell[];
}

interface FoundationReader {
    getString(key: string, defaultValue?: string): string | undefined;
    getNumber(key: string, defaultValue?: number): number;
    getNumberArray(key: string, separator?: RegExp, defaultValue?: number[]): number[];
    has(key: string): boolean;
}

function validDimension(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function readIndexedCells(
    reader: FoundationReader,
    prefix: string,
    maxEntries: number,
    allowOutsideBounds: boolean,
    width: number,
    height: number,
): FoundationCell[] {
    const result: FoundationCell[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < maxEntries; index++) {
        const key = `${prefix}.${index}`;
        if (!reader.has(key)) {
            continue;
        }
        const values = reader.getNumberArray(key, /,\s*/);
        if (values.length < 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) {
            continue;
        }
        const x = Math.trunc(values[0]);
        const y = Math.trunc(values[1]);
        const inBounds = allowOutsideBounds
            ? x >= -1 && x <= width && y >= -1 && y <= height
            : x >= 0 && x < width && y >= 0 && y < height;
        if (!inBounds) {
            continue;
        }
        const id = `${x},${y}`;
        if (!seen.has(id)) {
            seen.add(id);
            result.push({ x, y });
        }
    }
    return result;
}

export function rectangleFoundationCells(foundation: Foundation): FoundationCell[] {
    const cells: FoundationCell[] = [];
    for (let x = 0; x < foundation.width; x++) {
        for (let y = 0; y < foundation.height; y++) {
            cells.push({ x, y });
        }
    }
    return cells;
}

export function getFoundationCells(foundation: Foundation): readonly FoundationCell[] {
    return foundation.cells?.length ? foundation.cells : rectangleFoundationCells(foundation);
}

export function getFoundationOutline(foundation: Foundation): readonly FoundationCell[] {
    return foundation.outline ?? [];
}

/**
 * Parses both retail rectangular foundations and Ares custom foundations.
 * Custom foundation entries are intentionally data-driven; no object names
 * or Mental Omega-specific assumptions belong here.
 */
export function parseFoundation(reader: FoundationReader): Foundation {
    const foundation = reader.getString("Foundation", "1x1").trim();
    if (foundation.toLowerCase() !== "custom") {
        const [widthStr, heightStr] = foundation.split("x");
        return {
            width: validDimension(parseInt(widthStr, 10)),
            height: validDimension(parseInt(heightStr, 10)),
        };
    }

    const width = validDimension(reader.getNumber("Foundation.X", 1));
    const height = validDimension(reader.getNumber("Foundation.Y", 1));
    const cells = readIndexedCells(reader, "Foundation", Math.min(width * height, 4096), false, width, height);

    // A malformed custom foundation should remain safely placeable instead of
    // becoming an invisible/zero-cell object. Ares definitions normally list
    // at least one Foundation.N entry.
    const occupiedCells = cells.length ? cells : undefined;
    const outlineLength = reader.has("FoundationOutline.Length")
        ? Math.max(0, Math.floor(reader.getNumber("FoundationOutline.Length", 0)))
        : Math.min(Math.max(width * height * 4, 64), 4096);
    const outline = readIndexedCells(reader, "FoundationOutline", outlineLength, true, width, height);

    return {
        width,
        height,
        cells: occupiedCells,
        outline: outline.length ? outline : undefined,
    };
}
