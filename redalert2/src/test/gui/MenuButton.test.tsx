import { describe, expect, test } from "bun:test";
import { MenuButton } from "../../gui/component/MenuButton";

describe("MenuButton layout", () => {
    test("confines long localized labels to each scaled button art box", () => {
        const boxes = [
            { x: 12, y: 24, width: 48, height: 14 },
            { x: 24, y: 48, width: 96, height: 28 },
        ];

        for (const box of boxes) {
            const button = new MenuButton({
                buttonConfig: { label: "Mission abbrechen / Zurück zur Mission" },
                box,
            });

            expect(button.getStyle()).toMatchObject({
                width: box.width,
                height: box.height,
                maxWidth: box.width,
                maxHeight: box.height,
                boxSizing: "border-box",
                padding: "0 4px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textAlign: "center",
                lineHeight: `${box.height}px`,
            });
        }
    });
});
