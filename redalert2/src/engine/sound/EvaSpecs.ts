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
    private disabled: boolean;
    private specs = new Map<string, EvaSpec>();
    constructor(sideType: SideType, voiceTag?: string) {
        this.sideType = sideType;
        const normalizedVoiceTag = voiceTag?.trim();
        this.disabled = normalizedVoiceTag?.toLocaleLowerCase("en-US") === "none";
        this.voiceTag = this.disabled ? undefined : normalizedVoiceTag || undefined;
    }
    readIni(ini: any): EvaSpecs {
        if (this.disabled) return this;
        let dialogListSection = ini.getSection("DialogList");
        if (!dialogListSection) {
            throw new Error("Missing eva.ini [DialogList] section");
        }
        const dialogNames = new Set(dialogListSection.entries.values());
        const hasExplicitVoiceTag = !!this.voiceTag;
        const sidePrefix = this.voiceTag || (this.sideType === SideType.GDI
            ? "Allied"
            : this.sideType === SideType.Yuri
                ? "Yuri"
                : "Russian");
        for (let dialogName of dialogNames) {
            if (dialogName) {
                let dialogSection = ini.getSection(dialogName);
                if (dialogSection) {
                    // Retail RA2/YR has only a subset of the legacy voice
                    // columns in some files, so retain the old fallback when
                    // the side is selected through SideType. An explicit
                    // Ares EVA.Tag is authoritative: an absent custom entry
                    // means that event has no sound, rather than silently
                    // borrowing Russian or Allied speech.
                    const sound = hasExplicitVoiceTag
                        ? dialogSection.getString(sidePrefix)
                        : dialogSection.getString(sidePrefix) ||
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
