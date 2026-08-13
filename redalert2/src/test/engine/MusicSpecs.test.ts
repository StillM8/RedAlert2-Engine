import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { MusicSpecs } from "@/engine/sound/MusicSpecs";

describe("MusicSpecs content loading", () => {
    test("resolves Ares side themes case-insensitively", () => {
        const specs = new MusicSpecs(new IniFile(`
[Themes]
0=FoehnWin
[FoehnWin]
Name=Foehn Victory
Sound=foehnwin
Repeat=yes
`));

        expect(specs.getSpec("foehnwin")).toEqual({
            name: "Foehn Victory",
            sound: "foehnwin",
            normal: true,
            repeat: true,
        });
    });
});
