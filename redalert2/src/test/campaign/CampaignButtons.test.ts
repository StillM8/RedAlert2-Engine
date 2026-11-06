import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseAresCampaignButtons } from "@/campaign/CampaignButtonModel";

describe("Ares campaign button metadata", () => {
    test("uses the documented defaults and triangle-up arrangement", () => {
        const model = parseAresCampaignButtons(undefined);
        expect(model.visibleButtons.map((button) => button.index)).toEqual([1, 2, 3]);
        expect(model.layout.kind).toBe("triangle-up");
        expect(model.buttons.map((button) => [button.x, button.y])).toEqual([
            [0, 136],
            [260, 136],
            [130, 0],
            [0, 0],
        ]);
        expect(model.buttons[0].image).toBe("fsalg.shp");
        expect(model.buttons[0].palette).toBe("fsalg.pal");
    });

    test("switches to triangle-down when campaign three is hidden", () => {
        const model = parseAresCampaignButtons(new IniFile("[UISettings]\nCampaign3=no\nCampaign4=THIRD\n"));
        expect(model.visibleButtons.map((button) => button.index)).toEqual([1, 2, 4]);
        expect(model.layout.kind).toBe("triangle-down");
        expect(model.buttons.find((button) => button.index === 4)).toMatchObject({ x: 130, y: 0 });
    });

    test("preserves explicit empty sublines and tooltips", () => {
        const model = parseAresCampaignButtons(new IniFile("[UISettings]\nCampaign1.Subline=\nCampaign1.Tooltip=\n"));
        expect(model.buttons[0].subline).toBe("");
        expect(model.buttons[0].tooltip).toBe("");
    });

    test("orders four campaigns left to right and top to bottom", () => {
        const model = parseAresCampaignButtons(new IniFile("[UISettings]\nCampaign1=ONE\nCampaign2=TWO\nCampaign3=THREE\nCampaign4=FOUR\n"));
        expect(model.layout.kind).toBe("grid");
        expect(model.buttons.map((button) => [button.x, button.y])).toEqual([
            [0, 0],
            [260, 0],
            [0, 136],
            [260, 136],
        ]);
    });
});
