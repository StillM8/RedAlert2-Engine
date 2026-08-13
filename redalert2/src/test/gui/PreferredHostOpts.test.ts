import { describe, expect, test } from "bun:test";
import { PreferredHostOpts } from "@/gui/screen/mainMenu/lobby/PreferredHostOpts";

describe("PreferredHostOpts", () => {
    test("keeps the INI game speed in the local slider domain", () => {
        expect(new PreferredHostOpts().applyMpDialogSettings({ gameSpeed: 6 }).gameSpeed).toBe(6);
        expect(new PreferredHostOpts().applyMpDialogSettings({ gameSpeed: 3 }).gameSpeed).toBe(3);
    });
});
