import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { SoundControl, SoundSpecs } from "@/engine/sound/SoundSpecs";

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

    test("does not treat an inline Control clause in Sounds as audio names", () => {
        const ini = new IniFile(`
[Defaults]
MinVolume=0
Range=100
Volume=100
Limit=1
Type=Global
Priority=Normal
[SoundList]
0=AmbientMarket
[AmbientMarket]
Sounds=market_a market_b Control=random loop all
Control=random loop all ambient
`);

        const specs = new SoundSpecs(ini);
        const spec = specs.getSpec("ambientmarket");

        expect(spec?.sounds).toEqual(["market_a", "market_b"]);
        expect(spec?.control).toEqual(new Set([
            SoundControl.All,
            SoundControl.Random,
            SoundControl.Loop,
            SoundControl.Ambient,
        ]));
        expect(specs.getMissingAudioFiles(() => false)).toEqual([
            "market_a.wav",
            "market_b.wav",
        ]);
    });

    test("accepts whitespace around an inline Control marker", () => {
        const ini = new IniFile(`
[Defaults]
MinVolume=0
Range=100
Volume=100
Limit=1
Type=Global
Priority=Normal
[SoundList]
0=AmbientMarket
[AmbientMarket]
Sounds=market_a control = random loop
`);

        expect(new SoundSpecs(ini).getSpec("AmbientMarket")?.sounds).toEqual(["market_a"]);
    });
});
