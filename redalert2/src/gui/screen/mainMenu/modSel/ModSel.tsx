import React, { useRef, useEffect } from "react";
import { List, ListItem } from "@/gui/component/List";
import { ModDetailsPane } from "@/gui/screen/mainMenu/modSel/ModDetailsPane";
interface Mod {
    id: string;
    name: string;
    supported: boolean;
    status: any;
    meta: any;
}
interface CompatibilityScan {
    sources: string[];
    missingSources: string[];
    featureUsage: Array<{
        featureId: string;
        occurrences: number;
        support?: {
            implemented?: boolean;
            parserImplemented?: boolean;
            runtimeImplemented?: boolean;
        };
    }>;
    unknownExtensionKeys: number;
    uniqueExtensionKeys: number;
}
interface ModSelProps {
    strings: any;
    mods: Mod[] | null;
    activeMod: Mod | null;
    selectedMod: Mod | null;
    compatibilityScan?: CompatibilityScan | null;
    onSelectMod: (mod: Mod, doubleClick?: boolean) => void;
}

const statusOf = (support: CompatibilityScan["featureUsage"][number]["support"]): "complete" | "partial" | "unsupported" | "unregistered" => {
    if (!support) return "unregistered";
    if (support.implemented && support.runtimeImplemented) return "complete";
    if (support.parserImplemented) return "partial";
    return "unsupported";
};

const renderScanSummary = (scan: CompatibilityScan, strings: any): React.ReactElement | null => {
    if (!scan.sources.length) {
        return React.createElement("div", { className: "mod-scan mod-scan-empty" },
            strings.get("GUI:ModScanNoLooseInis"));
    }
    const counts = { complete: 0, partial: 0, unsupported: 0, unregistered: 0 };
    for (const usage of scan.featureUsage) {
        counts[statusOf(usage.support)]++;
    }
    const missingMixNote = scan.missingSources.length > 0
        ? ` ${strings.get("GUI:ModScanMixNote")}` : "";
    return React.createElement("div", { className: "mod-scan" },
        React.createElement("div", { className: "mod-scan-title" },
            strings.get("GUI:ModScanTitle")),
        React.createElement("ul", { className: "mod-scan-list" },
            React.createElement("li", null, strings.get("GUI:ModScanComplete"), ": ", counts.complete),
            React.createElement("li", null, strings.get("GUI:ModScanPartial"), ": ", counts.partial),
            React.createElement("li", null, strings.get("GUI:ModScanUnsupported"), ": ", counts.unsupported),
            React.createElement("li", null, strings.get("GUI:ModScanUnregistered"), ": ", counts.unregistered),
            React.createElement("li", null, strings.get("GUI:ModScanUnknownKeys"), ": ", scan.unknownExtensionKeys),
            React.createElement("li", null, strings.get("GUI:ModScanSources"), ": ", scan.sources.length)),
        missingMixNote &&
        React.createElement("div", { className: "mod-scan-note" }, missingMixNote));
};

export const ModSel: React.FC<ModSelProps> = ({ strings, mods, activeMod, selectedMod, compatibilityScan, onSelectMod, }) => {
    const selectedRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        selectedRef.current?.scrollIntoView();
    }, []);
    return React.createElement("div", { className: "mod-sel-form" }, React.createElement(List, { title: strings.get("GUI:SelectMod"), className: "mod-list" }, mods
        ? mods.map((mod) => {
            const isSelected = mod.id === selectedMod?.id;
            return React.createElement(ListItem, {
                key: mod.id,
                selected: isSelected,
                innerRef: isSelected ? selectedRef : null,
                onClick: () => onSelectMod(mod),
                onDoubleClick: () => onSelectMod(mod, true),
                style: { display: "flex" },
            }, React.createElement("div", { className: "mod-name" }, (mod === activeMod ? "✔ " : "") +
                mod.name +
                (mod.supported
                    ? ""
                    : ` (${strings.get("GUI:ModUnsupported").toUpperCase()})`)));
        })
        : React.createElement(ListItem, { style: { textAlign: "center" } }, strings.get("GUI:LoadingEx"))), selectedMod &&
        React.createElement("div", { className: "mod-details-column" },
            React.createElement(ModDetailsPane, {
                modLoaded: activeMod === selectedMod,
                modStatus: selectedMod.status,
                modDetails: selectedMod.meta,
                strings: strings,
            }),
            compatibilityScan && renderScanSummary(compatibilityScan, strings)));
};
