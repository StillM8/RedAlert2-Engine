import type { IniFile } from "@/data/IniFile";
import type { IniSection } from "@/data/IniSection";
import { resolveCampaignLabel } from "./CampaignCsfResolver";
import type { CampaignStringResolver } from "./CampaignTypes";

export type CampaignButtonLayoutKind = "row" | "triangle-up" | "triangle-down" | "grid";

export interface CampaignButtonLayout {
    kind: CampaignButtonLayoutKind;
    order: number[];
    width: number;
    height: number;
    gap: number;
}

export interface CampaignButtonMetadata {
    index: 1 | 2 | 3 | 4;
    battleId?: string;
    image?: string;
    palette?: string;
    subline: string;
    sublineLabel: string;
    tooltip: string;
    tooltipLabel: string;
    visible: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
}

export class CampaignButtonModel {
    constructor(
        public readonly buttons: CampaignButtonMetadata[],
        public readonly layout: CampaignButtonLayout,
    ) {
    }

    get visibleButtons(): CampaignButtonMetadata[] {
        return this.buttons.filter((button) => button.visible);
    }
}

interface CampaignButtonIni {
    ini: IniFile;
}

const defaults = [
    { battle: "ALL1", image: "fsalg.shp", palette: "fsalg.pal", subline: "STT:AlliedCampaignIcon" },
    { battle: "SOV1", image: "fsslg.shp", palette: "fsslg.pal", subline: "STT:SovietCampaignIcon" },
    { battle: "TUT1", image: "", palette: "fsbclg.pal", subline: "STT:CampaignAnimTutorial" },
    { battle: "", image: "", palette: "", subline: "" },
] as const;

function asIni(value: IniFile | CampaignButtonIni): IniFile {
    return value instanceof Object && "ini" in value ? value.ini : value as IniFile;
}

function valueOf(section: IniSection | undefined, key: string, fallback: string): string {
    const value = section?.get(key);
    if (Array.isArray(value)) {
        return value[0] ?? fallback;
    }
    return value ?? fallback;
}

function explicitValue(section: IniSection | undefined, key: string): string | undefined {
    const value = section?.get(key);
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
}

function layoutFor(visible: number[]): CampaignButtonLayout {
    if (visible.length === 4) {
        return {
            kind: "grid",
            order: visible,
            width: 1040,
            height: 272,
            gap: 0,
        };
    }
    if (visible.length === 3 && visible.includes(3)) {
        return {
            kind: "triangle-up",
            order: visible,
            width: 520,
            height: 272,
            gap: 0,
        };
    }
    if (visible.length === 3) {
        return {
            kind: "triangle-down",
            order: visible,
            width: 520,
            height: 272,
            gap: 0,
        };
    }
    return {
        kind: "row",
        order: visible,
        width: Math.max(260, visible.length * 260),
        height: 136,
        gap: 0,
    };
}

function positionFor(index: number, layout: CampaignButtonLayout, order: number[]): { x: number; y: number } {
    const position = order.indexOf(index);
    if (layout.kind === "triangle-up") {
        if (index === 3) {
            return { x: 130, y: 0 };
        }
        return {
            x: index === 1 ? 0 : 260,
            y: 136,
        };
    }
    if (layout.kind === "triangle-down") {
        if (index === 4) {
            return { x: 130, y: 0 };
        }
        return {
            x: index === 1 ? 0 : 260,
            y: 136,
        };
    }
    if (layout.kind === "grid") {
        return {
            x: (position % 2) * 260,
            y: Math.floor(position / 2) * 136,
        };
    }
    return {
        x: position * 260,
        y: 0,
    };
}

export function parseAresCampaignButtons(
    source: IniFile | CampaignButtonIni | undefined,
    strings?: CampaignStringResolver,
): CampaignButtonModel {
    const ini = source ? asIni(source) : undefined;
    const section = ini?.getSection("UISettings");
    const buttons: CampaignButtonMetadata[] = [];
    const visible: number[] = [];
    for (let index = 1; index <= 4; index++) {
        const fallback = defaults[index - 1];
        const battleValue = valueOf(section, `Campaign${index}`, fallback.battle).trim();
        const hidden = battleValue.toLocaleLowerCase("en-US") === "no";
        const battleId = hidden ? undefined : battleValue || undefined;
        const sublineRaw = explicitValue(section, `Campaign${index}.Subline`);
        const sublineLabel = sublineRaw === undefined ? fallback.subline : sublineRaw;
        const tooltipRaw = explicitValue(section, `Campaign${index}.Tooltip`);
        const tooltipLabel = tooltipRaw === undefined ? sublineLabel : tooltipRaw;
        const subline = resolveCampaignLabel(sublineLabel, sublineLabel, strings);
        const tooltip = resolveCampaignLabel(tooltipLabel, tooltipLabel, strings);
        if (battleId) {
            visible.push(index);
        }
        buttons.push({
            index: index as 1 | 2 | 3 | 4,
            battleId,
            image: valueOf(section, `Campaign${index}.Image`, fallback.image) || undefined,
            palette: valueOf(section, `Campaign${index}.Palette`, fallback.palette) || undefined,
            subline: subline.value,
            sublineLabel,
            tooltip: tooltip.value,
            tooltipLabel,
            visible: Boolean(battleId),
            x: 0,
            y: 0,
            width: 260,
            height: 136,
        });
    }
    const layout = layoutFor(visible);
    for (const button of buttons) {
        if (button.visible) {
            const position = positionFor(button.index, layout, visible);
            button.x = position.x;
            button.y = position.y;
        }
    }
    return new CampaignButtonModel(buttons, layout);
}

export function createAresCampaignButtonModel(
    source: IniFile | CampaignButtonIni | undefined,
    strings?: CampaignStringResolver,
): CampaignButtonModel {
    return parseAresCampaignButtons(source, strings);
}
