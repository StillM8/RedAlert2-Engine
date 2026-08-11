import { describe, expect, test } from "bun:test";
import { OptionsScreen } from "@/gui/screen/options/OptionsScreen";

describe("OptionsScreen", () => {
    test("shows the in-game content area before mounting the options view", () => {
        let contentAreaVisible: boolean | undefined;
        const controller = {
            setSidebarButtons: () => undefined,
            showSidebarButtons: () => undefined,
            hideSidebarButtons: async () => undefined,
            setMainComponent: () => undefined,
            toggleContentAreaVisibility: (visible: boolean) => {
                contentAreaVisible = visible;
            },
        };
        const screen = new OptionsScreen(
            { get: (key: string) => key },
            { render: () => [{}] },
            { serialize: () => "" } as any,
            { setItem: () => undefined },
            {},
            true,
            false,
        );

        screen.setController(controller as any);
        screen.onEnter();

        expect(contentAreaVisible).toBe(true);
    });
});
