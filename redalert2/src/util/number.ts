export function int32ToFloat32(value: number): number {
    const buffer = new DataView(new ArrayBuffer(4));
    buffer.setInt32(0, value);
    return buffer.getFloat32(0);
}

/**
 * Normalizes a simulation Float64 before it is written to a canonical hash.
 * JavaScript treats -0 and 0 as equal for the arithmetic used by the engine,
 * so they intentionally share one representation. Non-finite values are not
 * valid canonical state and fail at the boundary instead of becoming a
 * platform-dependent NaN/Infinity payload.
 */
export function canonicalFloat64(value: number, field = "value"): number {
    if (!Number.isFinite(value)) {
        throw new RangeError(`Non-finite canonical Float64 in ${field}`);
    }
    return Object.is(value, -0) ? 0 : value;
}

/** Writes the canonical little-endian IEEE-754 representation of a number. */
export function setCanonicalFloat64(view: DataView, offset: number, value: number, field?: string): void {
    view.setFloat64(offset, canonicalFloat64(value, field), true);
}

/** Mixes the canonical Float64 bytes into the engine's signed 32-bit hash. */
export function mixCanonicalFloat64(hash: number, value: number, view: DataView, field?: string): number {
    setCanonicalFloat64(view, 0, value, field);
    for (let index = 0; index < 8; index++) {
        hash = (hash * 31 + view.getUint8(index)) | 0;
    }
    return hash;
}
