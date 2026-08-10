import { SideType } from "../../game/SideType";
export enum EvaPriority {
    Low = 0,
    Normal = 1,
    Important = 2,
    Critical = 3
}
interface EvaSpec {
    text: string;
    sound: string;
    priority: EvaPriority;
    queue: boolean;
}
export class EvaSpecs {
    private sideType: SideType;
    private voiceTag?: string;
    private specs = new Map<string, EvaSpec>();
    constructor(sideType: SideType, voiceTag?: string) {
        this.sideType = sideType;
        this.voiceTag = voiceTag?.trim() || undefined;
    }
    readIni(ini: any): EvaSpecs {
        let dialogListSection = ini.getSection("DialogList");
        if (!dialogListSection) {
            throw new Error("Missing eva.ini [DialogList] section");
        }
        const dialogNames = new Set(dialogListSection.entries.values());
        const sidePrefix = this.voiceTag || (this.sideType === SideType.GDI
            ? "Allied"
            : this.sideType === SideType.Yuri
                ? "Yuri"
                : "Russian");
        for (let dialogName of dialogNames) {
            if (dialogName) {
                let dialogSection = ini.getSection(dialogName);
                if (dialogSection) {
                    // Fall back across voice columns for entries a side does
                    // not record (RA2's eva.ini has no Yuri column at all).
                    const sound = dialogSection.getString(sidePrefix) ||
                        dialogSection.getString("Russian") ||
                        dialogSection.getString("Allied");
                    const spec: EvaSpec = {
                        text: dialogSection.getString("Text"),
                        sound,
                        priority: dialogSection.getEnum("Priority", EvaPriority, EvaPriority.Normal, true),
                        queue: dialogSection.getString("Type").trim().toLowerCase() === "queue",
                    };
                    this.specs.set(dialogName as string, spec);
                }
                else {
                    console.warn(`Missing eva section [${dialogName}]`);
                }
            }
        }
        return this;
    }
    getSpec(name: string): EvaSpec | undefined {
        return this.specs.get(name);
    }
}
