import { CsfFile } from './CsfFile';
import { sprintf } from 'sprintf-js';

/**
 * String data is layered for the same reason game resources are layered:
 * stock RA2 labels must be available as a fallback, while an expansion or
 * mod is allowed to override them deliberately.  Keeping this information
 * here also prevents profile-specific CSFs from being reduced to a silent
 * "fill missing keys" merge.
 */
export type StringLayerId =
    | 'application-fallback'
    | 'retail-base'
    | 'retail-expansion'
    | 'profile'
    | 'application-override'
    | 'user'
    | 'runtime';

export interface StringSourceMetadata {
    file?: string;
    archive?: string;
}

export interface StringValueExplanation {
    value: string;
    layer: StringLayerId;
    file?: string;
    archive?: string;
}

export interface StringExplanation {
    requested: string;
    normalized: string;
    found: boolean;
    winner?: StringValueExplanation;
    shadowed: StringValueExplanation[];
}

const STRING_LAYER_PRIORITY: Record<StringLayerId, number> = {
    'application-fallback': 0,
    'retail-base': 100,
    'retail-expansion': 200,
    profile: 300,
    'application-override': 400,
    user: 500,
    runtime: 600,
};

interface StringCandidate extends StringValueExplanation {
    sequence: number;
}

function normalizeKey(key: string): string {
    return key.toLocaleLowerCase('en-US');
}

export class Strings {
    /** Effective values retained for the hot get()/has() path. */
    private readonly data = new Map<string, string>();
    /** All candidates retained for provenance and override diagnostics. */
    private readonly candidates = new Map<string, StringCandidate[]>();
    private nextSequence = 0;

    constructor(source?: CsfFile | { [key: string]: string }) {
        if (source) {
            if (source instanceof CsfFile) {
                this.fromCsf(source, 'retail-base');
            }
            else if (typeof source === 'object') {
                this.fromJson(source, 'application-fallback');
            }
        }
    }

    public fromCsf(
        csfFile: CsfFile,
        layer: StringLayerId = 'retail-base',
        source?: StringSourceMetadata,
    ): void {
        this.fromJson(csfFile.data, layer, source);
    }

    public fromJson(
        jsonData: { [key: string]: string },
        layer: StringLayerId = 'application-fallback',
        source?: StringSourceMetadata,
    ): void {
        for (const key of Object.keys(jsonData)) {
            const value = jsonData[key];
            this.setLayerValue(key, String(value ?? ''), layer, source);
        }
    }

    /**
     * Backwards-compatible direct setter. Runtime callers historically used
     * this as an explicit final override, so retain that behavior while new
     * resource loaders should use setLayerValue()/fromCsf() with a named layer.
     */
    public setValue(
        key: string,
        value: string,
        layer: StringLayerId = 'runtime',
        source?: StringSourceMetadata,
    ): void {
        this.setLayerValue(key, value, layer, source);
    }

    public setLayerValue(
        key: string,
        value: string,
        layer: StringLayerId,
        source?: StringSourceMetadata,
    ): void {
        const normalized = normalizeKey(key);
        const candidate: StringCandidate = {
            value: this.sanitizeValue(value),
            layer,
            ...source,
            sequence: this.nextSequence++,
        };
        const values = this.candidates.get(normalized) ?? [];
        values.push(candidate);
        values.sort((a, b) =>
            STRING_LAYER_PRIORITY[a.layer] - STRING_LAYER_PRIORITY[b.layer]
            || a.sequence - b.sequence);
        this.candidates.set(normalized, values);
        this.data.set(normalized, values[values.length - 1].value);
    }

    private sanitizeValue(value: string): string {
        return value.replace(/%hs/g, '%s');
    }

    public has(key: string): boolean {
        return this.candidates.has(normalizeKey(key));
    }

    public get(key: string, ...args: any[]): string {
        const name = String(key);
        const normalized = normalizeKey(name);
        const values = this.candidates.get(normalized);
        const candidate = values && values[values.length - 1];
        if (candidate) {
            if (!args.length)
                return candidate.value;
            try {
                return sprintf(candidate.value, ...args);
            }
            catch (e) {
                // A CSF template whose placeholders don't match the args (e.g.
                // %d given a preformatted "12.3 MB" string) must not crash the
                // caller.
                console.warn(`[Strings] Format mismatch for "${name}" ("${candidate.value}")`, e);
                return `${candidate.value} ${args.join(' ')}`;
            }
        }
        if ((/^NOSTR:/i).test(name)) {
            return name.replace(/^NOSTR:/i, '');
        }
        console.warn(`[Strings] String with name "${name}" not found"`);
        return name;
    }

    public getKeys(): string[] {
        return [...this.data.keys()];
    }

    public explain(key: string): StringExplanation {
        const requested = String(key);
        const normalized = normalizeKey(requested);
        const values = this.candidates.get(normalized) ?? [];
        const winner = values[values.length - 1];
        const describe = (candidate: StringCandidate): StringValueExplanation => ({
            value: candidate.value,
            layer: candidate.layer,
            ...(candidate.file ? { file: candidate.file } : {}),
            ...(candidate.archive ? { archive: candidate.archive } : {}),
        });
        return {
            requested,
            normalized,
            found: !!winner,
            ...(winner ? { winner: describe(winner) } : {}),
            shadowed: values.slice(0, -1).reverse().map(describe),
        };
    }
}
