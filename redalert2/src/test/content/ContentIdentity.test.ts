import { describe, expect, test } from "bun:test";
import { allocateContentId, normalizeContentId } from "@/content/ContentIdentity";

describe("installed content identity", () => {
    test("normalizes display names into stable ids", () => {
        expect(normalizeContentId("Mental Omega 3.3.6 (Full)"))
            .toBe("mental-omega-3-3-6-full");
        expect(normalizeContentId("!!!", "fallback-mod")).toBe("fallback-mod");
    });

    test("reuses an exact id for updates and suffixes collisions", () => {
        expect(allocateContentId("Mental Omega", ["other-mod"])).toBe("mental-omega");
        expect(allocateContentId("Mental Omega", ["mental-omega"])).toBe("mental-omega");
        expect(allocateContentId("Mental Omega", ["mental-omega", "mental-omega-2"], { reuseExisting: false }))
            .toBe("mental-omega-3");
    });
});
