import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { TextureUtils } from "@/engine/gfx/TextureUtils";

(globalThis as any).THREE = THREE;
(globalThis as any).window = globalThis;

describe("palette resource cache lifecycle", () => {
    test("disposes palette textures between repeated game loads", async () => {
        TextureUtils.clearCache();
        let disposed = 0;
        TextureUtils.cache.set(0x1234, {
            dispose: () => disposed++,
        } as any);

        try {
            const { GameLoader } = await import("@/gui/screen/game/GameLoader");
            GameLoader.prototype.clearStaticCaches.call({} as GameLoader);

            expect(disposed).toBe(1);
            expect(TextureUtils.cache.size).toBe(0);
        }
        finally {
            TextureUtils.clearCache();
        }
    });
});
