import React, { useState } from "react";
import { List, ListItem } from "@/gui/component/List";
import type {
    CampaignDefinition,
    CampaignDifficultyValue,
    CampaignStringResolver,
} from "@/campaign/CampaignTypes";

export interface CampaignSelectionProps {
    campaigns: CampaignDefinition[];
    selected?: CampaignDefinition;
    difficulty: CampaignDifficultyValue;
    buildOffAlly: boolean;
    strings: CampaignStringResolver;
    onSelect: (campaign: CampaignDefinition) => void;
    onHover: (campaign: CampaignDefinition) => void;
    onDifficultyChange: (difficulty: CampaignDifficultyValue) => void;
    onBuildOffAllyChange: (value: boolean) => void;
    onLaunch: () => void;
}

function difficultyValue(value: CampaignDifficultyValue): string {
    if (value === 0) {
        return "easy";
    }
    if (value === 1) {
        return "normal";
    }
    if (value === 2) {
        return "hard";
    }
    return String(value);
}

export const CampaignSelection: React.FC<CampaignSelectionProps> = ({
    campaigns,
    selected,
    difficulty,
    buildOffAlly,
    strings,
    onSelect,
    onHover,
    onDifficultyChange,
    onBuildOffAllyChange,
    onLaunch,
}) => {
    const [showDetails, setShowDetails] = useState(true);
    return (
        <div className="campaign-selection-form">
            <div className="campaign-selection-title">{strings.get("GUI:Campaign") || "Campaign"}</div>
            <List
                className="campaign-selection-list"
                title={strings.get("GUI:Campaign") || "Campaign"}
                tooltip={strings.get("STT:CampaignList")}>
                {campaigns.length ? campaigns.map((campaign) => (
                    <ListItem
                        key={campaign.id}
                        selected={selected?.id === campaign.id}
                         tooltip={campaign.presentation.tooltip || campaign.presentation.description}
                         onMouseEnter={() => onHover(campaign)}
                         onClick={() => onSelect(campaign)}

                        onDoubleClick={() => {
                            onSelect(campaign);
                            onLaunch();
                        }}>
                        {campaign.presentation.title || campaign.id}
                    </ListItem>
                )) : (
                    <ListItem disabled>{strings.get("GUI:NoCampaigns") || "No campaigns available"}</ListItem>
                )}
            </List>
            {selected && (
                <div className="campaign-selection-details">
                    <button type="button" onClick={() => setShowDetails((value) => !value)}>
                        {showDetails ? "-" : "+"}
                    </button>
                    {showDetails && (
                        <div>
                            <div>{selected.presentation.description}</div>
                            {selected.presentation.longDescription && (
                                <div>{selected.presentation.longDescription}</div>
                            )}
                            {selected.presentation.summary && (
                                <div>{selected.presentation.summary}</div>
                            )}
                        </div>
                    )}
                    <label>
                        {strings.get("GUI:Difficulty") || "Difficulty"}
                        <select
                            value={difficultyValue(difficulty)}
                            onChange={(event) => {
                                const value = event.target.value;
                                onDifficultyChange(value as CampaignDifficultyValue);
                            }}>
                            <option value="easy">{strings.get("GUI:Easy") || "Easy"}</option>
                            <option value="normal">{strings.get("GUI:Normal") || "Normal"}</option>
                            <option value="hard">{strings.get("GUI:Hard") || "Hard"}</option>
                        </select>
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={buildOffAlly}
                            onChange={(event) => onBuildOffAllyChange(event.target.checked)} />
                        {strings.get("GUI:BuildOffAlly") || "Allow ally building"}
                    </label>
                    <button type="button" onClick={onLaunch}>
                        {strings.get("GUI:StartGame") || "Start"}
                    </button>
                </div>
            )}
        </div>
    );
};
