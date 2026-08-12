import { describe, expect, test } from "bun:test";
import { ContentRegistry, parseContentSelectionId } from "@/content/ContentRegistry";

describe("content registry selection", () => {
    test("accepts built-in and mod selection ids but rejects unsafe ids", () => {
        expect(parseContentSelectionId("builtin:ra2")).toBe("builtin:ra2");
        expect(parseContentSelectionId("mod:mental-omega_336")).toBe("mod:mental-omega_336");
        expect(parseContentSelectionId("mod:../other-mod")).toBeUndefined();
        expect(parseContentSelectionId("mental-omega")).toBeUndefined();
    });

    test("resolves legacy mod routes and persists explicit selection", async () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        };
        const registry = new ContentRegistry(storage);
        const selection = await registry.resolveSelection({
            location: { href: "https://example.test/index.html?mod=mental-omega" } as Location,
            fallbackProfile: "yr",
        });
        expect(selection.id).toBe("mod:mental-omega");
        expect(selection.modId).toBe("mental-omega");
        expect(selection.profileId).toBe("yr");

        registry.setStoredSelection("builtin:yr");
        await expect(registry.resolveSelection({
            location: { href: "https://example.test/index.html" } as Location,
            fallbackProfile: "ra2",
        })).resolves.toMatchObject({ id: "builtin:yr", profileId: "yr" });
    });
});
