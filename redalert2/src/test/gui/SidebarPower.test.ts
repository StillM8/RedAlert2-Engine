import { describe, expect, test } from "bun:test";
import { createSidebarPowerPip } from "@/gui/screen/game/component/hud/SidebarPower";

describe("sidebar power frame placement", () => {
    test("reconstructs a custom frame at its authored x offset", () => {
        const frame = createSidebarPowerPip({
            width: 3,
            height: 1,
            x: 2,
            y: 0,
            imageData: new Uint8Array([7, 0, 9]),
        }, 5, 1);

        expect([...frame.data]).toEqual([0, 0, 7, 0, 9]);
    });

    test("keeps retail zero-offset power pips unchanged", () => {
        const frame = createSidebarPowerPip({
            width: 2,
            height: 2,
            imageData: new Uint8Array([3, 0, 0, 4]),
        }, 2, 2);

        expect([...frame.data]).toEqual([3, 0, 0, 4]);
    });
});
