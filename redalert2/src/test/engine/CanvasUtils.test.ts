import { describe, expect, test } from "bun:test";
import { CanvasUtils } from "@/engine/gfx/CanvasUtils";

describe("CanvasUtils image encoding", () => {
    test("uses the Android dataURL path instead of the slow toBlob callback", async () => {
        const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: { userAgent: "Mozilla/5.0 (Linux; Android 14)" },
        });
        let toBlobCalls = 0;
        const canvas = {
            toDataURL: (mimeType: string) => `data:${mimeType};base64,AA==`,
            toBlob: () => {
                toBlobCalls++;
            },
        } as unknown as HTMLCanvasElement;

        try {
            const blob = await CanvasUtils.canvasToBlob(canvas);
            expect(blob.type).toBe("image/png");
            expect(blob.size).toBe(1);
            expect(toBlobCalls).toBe(0);
        }
        finally {
            if (originalNavigator) {
                Object.defineProperty(globalThis, "navigator", originalNavigator);
            }
            else {
                delete (globalThis as any).navigator;
            }
        }
    });
});
