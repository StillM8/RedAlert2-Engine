export interface FoundationCell {
    x: number;
    y: number;
}

export interface Foundation {
    width: number;
    height: number;
    /** True only for an authored Ares Foundation=Custom definition. */
    custom?: boolean;
    /** Explicit occupied cells for Ares Foundation=Custom definitions. */
    cells?: readonly FoundationCell[];
    /** Optional outline cells used by factory/placement logic. */
    outline?: readonly FoundationCell[];
}

export interface FoundationBounds {
    x: number;
    y: number;
    width: number;
    height: number;
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
 * Ares Advanced Rubble requires source and replacement foundations to match,
 * and explicitly treats Custom versus built-in foundations as incompatible
 * even when their occupied rectangles happen to be identical.
 */
export function areAresFoundationsEquivalent(a: Foundation, b: Foundation): boolean {
    if (!!a.custom !== !!b.custom || a.width !== b.width || a.height !== b.height) {
        return false;
    }
    const cellKey = (cell: FoundationCell) => `${cell.x},${cell.y}`;
    const left = getFoundationCells(a).map(cellKey).sort();
    const right = getFoundationCells(b).map(cellKey).sort();
    return left.length === right.length && left.every((cell, index) => cell === right[index]);
}

/**
 * Returns a coarse local-space rectangle for a foundation. Logical callers
 * should use getFoundationCells(); this is for adjacency, culling and other
 * broad searches where a rectangle is intentional. Explicit Ares outlines
 * are included so cells outside the occupied bounding box are not discarded.
 */
export function getFoundationBounds(foundation: Foundation, includeOutline = false): FoundationBounds {
    const cells = includeOutline && foundation.outline?.length
        ? [...getFoundationCells(foundation), ...foundation.outline]
        : getFoundationCells(foundation);
    const minX = Math.min(0, ...cells.map((cell) => cell.x));
    const minY = Math.min(0, ...cells.map((cell) => cell.y));
    const maxX = Math.max(foundation.width - 1, ...cells.map((cell) => cell.x));
    const maxY = Math.max(foundation.height - 1, ...cells.map((cell) => cell.y));
    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}

/**
 * Returns the occupied cells that should block movement for a building. The
 * retail NumberImpassableRows/WeaponsFactory rules trim the blocking region;
 * custom foundations still retain their holes.
 */
export function getFoundationBlockingCells(foundation: Foundation, impassableColumns = foundation.width): readonly FoundationCell[] {
    if (impassableColumns <= 0) {
        return [];
    }
    return getFoundationCells(foundation).filter((cell) => cell.x < impassableColumns);
}

/** Selects an occupied cell nearest to a preferred local coordinate. */
export function getNearestFoundationCell(foundation: Foundation, preferred: FoundationCell): FoundationCell {
    const cells = getFoundationCells(foundation);
    return cells.reduce((best, cell) => {
        const distance = (cell.x - preferred.x) ** 2 + (cell.y - preferred.y) ** 2;
        const bestDistance = (best.x - preferred.x) ** 2 + (best.y - preferred.y) ** 2;
        return distance < bestDistance ? cell : best;
    });
}

/**
 * Chooses an explicit outline cell outside the occupied footprint when one is
 * available, otherwise returns the conventional cell immediately beyond the
 * foundation's right edge. This is useful for generic factory rally logic.
 */
export function getFoundationRallyCell(foundation: Foundation, preferredY = Math.floor(foundation.height / 2)): FoundationCell {
    const occupied = new Set(getFoundationCells(foundation).map((cell) => `${cell.x},${cell.y}`));
    const outsideOutline = getFoundationOutline(foundation).filter((cell) => !occupied.has(`${cell.x},${cell.y}`));
    if (outsideOutline.length) {
        return outsideOutline.reduce((best, cell) => {
            const distance = Math.abs(cell.x - foundation.width) + Math.abs(cell.y - preferredY);
            const bestDistance = Math.abs(best.x - foundation.width) + Math.abs(best.y - preferredY);
            return distance < bestDistance || (distance === bestDistance && cell.x > best.x) ? cell : best;
        });
    }
    return { x: foundation.width, y: preferredY };
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
        custom: true,
        cells: occupiedCells,
        outline: outline.length ? outline : undefined,
    };
}
