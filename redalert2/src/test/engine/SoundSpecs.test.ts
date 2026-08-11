import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { SoundSpecs } from "@/engine/sound/SoundSpecs";

describe("SoundSpecs content loading", () => {
    test("flattens repeated SoundList/Sounds values and resolves names case-insensitively", () => {
        const ini = new IniFile(`
[Defaults]
MinVolume=0
Range=100
Volume=100
Limit=1
Type=Global
Priority=Normal
[SoundList]
0=MenuClick
1[]=UnitVoice
2[]=unitvoice
[MenuClick]
Sounds=menu_click.wav
[UnitVoice]
Sounds[]=foehn_select
Sounds[]=foehn_select_alt.wav
`);

        const specs = new SoundSpecs(ini);
        expect(specs.getSpec("menuclick")?.sounds).toEqual(["menu_click.wav"]);
        expect(specs.getSpec("UNITVOICE")?.sounds).toEqual(["foehn_select", "foehn_select_alt.wav"]);
        expect(specs.getAll()).toHaveLength(2);
        expect(specs.getMissingAudioFiles((filename) => filename === "menu_click.wav")).toEqual([
            "foehn_select.wav",
            "foehn_select_alt.wav",
        ]);
    });
});
