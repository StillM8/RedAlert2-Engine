import { describe, expect, test } from "bun:test";
import { ShadowRenderable } from "@/engine/renderable/ShadowRenderable";

function createShadowRenderable(numImages: number, images: unknown[]): ShadowRenderable {
    return new ShadowRenderable({ numImages, images }, {} as any, { x: 0, y: 0 });
}

describe("ShadowRenderable frame safety", () => {
    test("uses an integer shadow frame for odd-sized art", () => {
        const renderable = createShadowRenderable(3, [{ imageData: new Uint8Array([1]) }, { imageData: new Uint8Array([1]) }, { imageData: new Uint8Array([1]) }]);

        expect(renderable.computeShadowFrameNo(0)).toBe(1);
        expect(renderable.computeShadowFrameNo(1.5)).toBe(1);
    });

    test("treats missing aggregate frames as shadowless instead of throwing", () => {
        const renderable = createShadowRenderable(4, [{ imageData: new Uint8Array([1]) }, undefined, { imageData: new Uint8Array([1]) }]);

        expect(renderable.frameHasShadowData(1)).toBe(false);
        expect(renderable.frameHasShadowData(2)).toBe(true);
    });
});
