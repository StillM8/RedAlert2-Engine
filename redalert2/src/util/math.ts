export function getRandomInt(min: number, max: number): number {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(value, min));
}
export function isBetween(value: number, min: number, max: number): boolean {
    return min <= value && value <= max;
}
export function lerp(start: number, end: number, t: number): number {
    return (1 - t) * start + t * end;
}
export function truncToDecimals(num: number, decimalPlaces: number): number {
    if (!num)
        return num;
    const factor = 10 ** decimalPlaces;
    return (num >= 0 ? Math.floor(num * factor) : Math.ceil(num * factor)) / factor;
}
export function roundToDecimals(num: number, decimalPlaces: number): number {
    if (!num)
        return num;
    const factor = 10 ** decimalPlaces;
    return Math.round(num * factor) / factor;
}
export function floorTo(value: number, significance: number): number {
    if (significance === 0)
        return value;
    return Math.floor(value / significance) * significance;
}
export function fnv32a(data: Uint8Array | number[]): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; ++i) {
        hash ^= data[i];
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
}

/**
 * Hashes a sequence of scalar values without allowing adjacent values to
 * become ambiguous (for example, ["ab", "c"] vs ["a", "bc"]). This is used
 * for stable content-defined IDs that participate in deterministic state.
 */
export function fnv32aStrings(values: readonly (string | number)[]): number {
    const bytes: number[] = [];
    for (const value of values) {
        const encoded = new TextEncoder().encode(String(value));
        const length = encoded.length;
        bytes.push(
            length & 0xff,
            (length >>> 8) & 0xff,
            (length >>> 16) & 0xff,
            (length >>> 24) & 0xff,
            ...encoded,
        );
    }
    return fnv32a(bytes);
}
