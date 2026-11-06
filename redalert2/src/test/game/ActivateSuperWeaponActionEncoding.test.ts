import { describe, expect, test } from "bun:test";
import { ActivateSuperWeaponAction } from "@/game/action/ActivateSuperWeaponAction";

/**
 * Superweapon action identity encoding. Indexes 0-254 keep the exact legacy
 * single-byte layout (old records parse unchanged); indexes 255+ use the 0xFF
 * escape plus a uint16 so large mods stop wrapping onto the wrong weapon.
 */

function makeAction(index: number, tile: { x: number; y: number }, tile2?: { x: number; y: number }) {
    const action = new ActivateSuperWeaponAction({} as any);
    const anyAction = action as any;
    anyAction.superWeaponType = index;
    anyAction.tile = tile;
    anyAction.tile2 = tile2;
    return action;
}

describe("ActivateSuperWeaponAction index encoding", () => {
    test("legacy indexes keep the exact single-byte layout", () => {
        const action = makeAction(42, { x: 100, y: 200 });
        const bytes = action.serialize();

        // 1 index + 1 tile-count + 2x uint16 tile.
        expect(bytes.length).toBe(6);
        expect(bytes[0]).toBe(42);
        expect(bytes[1]).toBe(2);

        const restored = new ActivateSuperWeaponAction({} as any);
        restored.unserialize(bytes);
        expect((restored as any).superWeaponType).toBe(42);
        expect((restored as any).tile).toEqual({ x: 100, y: 200 });
    });

    test("wide indexes round-trip through the escape encoding", () => {
        for (const index of [255, 300, 4096]) {
            const action = makeAction(index, { x: 1, y: 2 });
            const bytes = action.serialize();
            expect(bytes[0]).toBe(0xff);

            const restored = new ActivateSuperWeaponAction({} as any);
            restored.unserialize(bytes);
            expect((restored as any).superWeaponType).toBe(index);
            expect(restored.serialize()).toEqual(bytes);
        }
    });

    test("wide indexes round-trip with the two-click tile2 payload", () => {
        const action = makeAction(300, { x: 5, y: 6 }, { x: 7, y: 8 });
        const bytes = action.serialize();

        const restored = new ActivateSuperWeaponAction({} as any);
        restored.unserialize(bytes);
        expect((restored as any).superWeaponType).toBe(300);
        expect((restored as any).tile2).toEqual({ x: 7, y: 8 });
        expect(restored.serialize()).toEqual(bytes);
    });

    test("wide indexes never wrap onto the wrong weapon", () => {
        // The old uint8 encoding silently fired index 300 % 256 = 44.
        const action = makeAction(300, { x: 0, y: 0 });
        const restored = new ActivateSuperWeaponAction({} as any);
        restored.unserialize(action.serialize());
        expect((restored as any).superWeaponType).not.toBe(44);
        expect((restored as any).superWeaponType).toBe(300);
    });
});
