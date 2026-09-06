import MersenneTwister from "mersenne-twister";
import { Crc32 } from "@/data/Crc32";
import { binaryStringToUint8Array } from "@/util/string";
import { fnv32a } from "@/util/math";

export const PRNG_STATE_VERSION = 1 as const;

export interface PrngState {
    readonly version: typeof PRNG_STATE_VERSION;
    readonly index: number;
    readonly state: readonly number[];
    readonly lastRandom?: number;
}

const MT_STATE_LENGTH = 624;
const MT_INDEX_MAX = MT_STATE_LENGTH;

export class Prng {
    private prng: MersenneTwister;
    private lastRandom?: number;
    static factory(seed: number | string, sequence: number): Prng {
        const numericSeed = Number.isNaN(Number(seed))
            ? Crc32.calculateCrc(binaryStringToUint8Array(seed as string))
            : Number(seed + "" + sequence);
        return new Prng(numericSeed);
    }
    constructor(seed: number) {
        this.prng = new MersenneTwister(seed);
        assertMersenneTwisterLayout(this.prng);
    }
    generateRandomInt(min: number, max: number): number {
        const random = this.prng.random();
        this.lastRandom = random;
        return Math.floor(random * (max - min + 1)) + min;
    }
    generateRandom(): number {
        const random = this.prng.random();
        this.lastRandom = random;
        return random;
    }
    getLastRandom(): number {
        return this.lastRandom;
    }

    /** Exact future-producing state of the wrapped MT19937 generator. */
    captureState(): PrngState {
        const generator = assertMersenneTwisterLayout(this.prng);
        return {
            version: PRNG_STATE_VERSION,
            index: generator.mti,
            state: generator.mt.map((word: number) => word >>> 0),
            ...(this.lastRandom === undefined ? {} : { lastRandom: this.lastRandom }),
        };
    }

    /** Hashes the full generator state, not merely the last emitted value. */
    getHash(): number {
        const state = this.captureState();
        const bytes = new Uint8Array((state.state.length + 2) * 4);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, 0x50524e47, true); // "PRNG"
        view.setUint32(4, state.index, true);
        state.state.forEach((word, index) => view.setUint32((index + 2) * 4, word, true));
        return fnv32a(bytes);
    }

    /**
     * Transactionally replaces the generator's complete internal state.
     * The package's mutable `mt`/`mti` representation is isolated here as a
     * versioned adapter so callers never depend on it directly.
     */
    restoreState(state: unknown): void {
        if (typeof state !== "object" || state === null) {
            throw new Error("Invalid PRNG state: expected an object");
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== PRNG_STATE_VERSION) {
            throw new Error(`Unsupported PRNG state version: ${String(candidate.version)}`);
        }
        if (!Number.isSafeInteger(candidate.index) ||
            (candidate.index as number) < 0 || (candidate.index as number) > MT_INDEX_MAX) {
            throw new Error("Invalid PRNG state: index");
        }
        if (!Array.isArray(candidate.state) || candidate.state.length !== MT_STATE_LENGTH) {
            throw new Error("Invalid PRNG state: state must contain 624 words");
        }
        const words = candidate.state.map((word, index) => {
            if (!Number.isSafeInteger(word) || (word as number) < 0 || (word as number) > 0xffffffff) {
                throw new Error(`Invalid PRNG state: word ${index}`);
            }
            return word as number;
        });
        if (candidate.lastRandom !== undefined &&
            (typeof candidate.lastRandom !== "number" || !Number.isFinite(candidate.lastRandom))) {
            throw new Error("Invalid PRNG state: lastRandom");
        }

        // Build the replacement generator completely before committing it.
        const replacement = assertMersenneTwisterLayout(new MersenneTwister(0));
        replacement.mt = words;
        replacement.mti = candidate.index as number;
        this.prng = replacement;
        this.lastRandom = candidate.lastRandom as number | undefined;
    }
}

interface MersenneTwisterStateLayout {
    mt: number[];
    mti: number;
}

/** Fail clearly if a dependency upgrade changes the wrapped generator shape. */
function assertMersenneTwisterLayout(value: unknown): MersenneTwisterStateLayout {
    const generator = value as Partial<MersenneTwisterStateLayout> | null;
    if (!generator || !Array.isArray(generator.mt) ||
        generator.mt.length !== MT_STATE_LENGTH ||
        !Number.isSafeInteger(generator.mti)) {
        throw new Error(
            "Unsupported mersenne-twister internal layout; expected mt[624] and integer mti",
        );
    }
    return generator as MersenneTwisterStateLayout;
}
