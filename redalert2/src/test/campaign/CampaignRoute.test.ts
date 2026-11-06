import { describe, expect, test } from "bun:test";
import { CampaignSelectionRoute, createCampaignSelectionRoute } from "@/gui/screen/mainMenu/campaign/CampaignRoute";
import { MainMenuScreenType } from "@/gui/screen/ScreenType";

describe("campaign selection route", () => {
    test("uses the dedicated campaign list screen route", () => {
        const route = createCampaignSelectionRoute({ returnTo: undefined });
        expect(route).toBeInstanceOf(CampaignSelectionRoute);
        expect(route.screenType).toBe(MainMenuScreenType.CampaignSelection);
        expect(MainMenuScreenType.CampaignSelection).toBe(23);
    });
});
