import { fnv32aStrings } from "@/util/math";

/**
 * Stable sorted-key scalar walk for canonical state hashing. Objects follow
 * docs/DeterministicIdentity.md: live game objects hash as their stable id and
 * players as their PlayerList slot. Host references (worlds, rules, traits)
 * are excluded so the object graph can never leak into a fingerprint, and a
 * visited set plus depth cap make cyclic references safe.
 */
export const STATE_HASH_HOST_KEYS: ReadonlySet<string> = new Set([
    "gameObject", "gameState", "tileOccupation", "world", "game", "unit",
    "rules", "art", "owner", "traits",
]);

export function scalarStateHash(label: string, value: unknown): number {
    const parts: (string | number)[] = [label];
    const visited = new WeakSet<object>();
    const walk = (node: unknown, depth: number): void => {
        if (node === undefined || node === null) return;
        if (typeof node === "number" || typeof node === "boolean" || typeof node === "string") {
            parts.push(typeof node === "boolean" ? (node ? 1 : 0) : node);
            return;
        }
        if (typeof node !== "object") return;
        if (depth <= 0) return;
        const object = node as any;
        if (visited.has(object)) return;
        visited.add(object);
        if (typeof object.playerListIndex === "number") {
            parts.push(`pl:${object.playerListIndex}`);
            return;
        }
        if (typeof object.id === "number") {
            parts.push(`id:${object.id}`);
            return;
        }
        if (Array.isArray(object)) {
            parts.push(`len:${object.length}`);
            for (const item of object) walk(item, depth - 1);
            return;
        }
        for (const key of Object.keys(object).sort()) {
            if (STATE_HASH_HOST_KEYS.has(key)) continue;
            parts.push(`k:${key}`);
            walk(object[key], depth - 1);
        }
    };
    walk(value, 6);
    return fnv32aStrings(parts);
}
