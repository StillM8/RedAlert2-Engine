import { MainMenuRoute } from "@/gui/screen/mainMenu/MainMenuRoute";
import { MainMenuScreenType } from "@/gui/screen/ScreenType";

export interface CampaignSelectionRouteParams {
    returnTo?: MainMenuRoute;
    catalog?: unknown;
}

export class CampaignSelectionRoute extends MainMenuRoute {
    constructor(params: CampaignSelectionRouteParams = {}) {
        super(MainMenuScreenType.CampaignSelection, params);
    }
}

export function createCampaignSelectionRoute(params: CampaignSelectionRouteParams = {}): CampaignSelectionRoute {
    return new CampaignSelectionRoute(params);
}
