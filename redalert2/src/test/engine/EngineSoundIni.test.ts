import { describe, expect, test } from "bun:test";
import { Engine, EngineType } from "@/engine/Engine";
import { GAME_PROFILES } from "@/engine/GameProfile";
import { IniSourceLoader } from "@/engine/IniSourceLoader";
import { MemArchive } from "@/data/vfs/MemArchive";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";

function archiveWithSoundFiles(files: Record<string, string>): MemArchive {
    const archive = new MemArchive();
    for (const [filename, contents] of Object.entries(files)) {
        archive.addFile(VirtualFile.fromBytes(new TextEncoder().encode(contents), filename));
    }
    return archive;
}

function createVfs(): VirtualFileSystem {
    return new VirtualFileSystem(undefined as any, {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    });
}

describe("Engine sound INI selection", () => {
    test("layers a profile sound index over its engine sound index", () => {
        const previous = {
            activeEngine: Engine.getActiveEngine(),
            activeProfile: (Engine as any).activeProfile,
            iniSourceLoader: (Engine as any).iniSourceLoader,
            vfs: Engine.vfs,
        };
        const vfs = createVfs();
        vfs.addArchive(archiveWithSoundFiles({
            "soundmd.ini": `
[Defaults]
Volume=50
[SoundList]
0=InheritedSound
1=OverriddenSound
[InheritedSound]
Sounds=inherited_voice
[OverriddenSound]
Sounds=base_voice
Volume=10
`,
            "soundmo.ini": `
[SoundList]
0=ProfileSound
1=OverriddenSound
[ProfileSound]
Sounds=profile_voice
[OverriddenSound]
Volume=90
`,
        }), "sound-index.mix");
        try {
            Engine.vfs = vfs;
            (Engine as any).iniSourceLoader = new IniSourceLoader(vfs);
            (Engine as any).activeProfile = GAME_PROFILES["mental-omega"];
            Engine.setActiveEngine(EngineType.YurisRevenge);

            const soundIni = Engine.getSoundIni();

            expect(soundIni.getSection("InheritedSound")?.getString("Sounds")).toBe("inherited_voice");
            expect(soundIni.getSection("ProfileSound")?.getString("Sounds")).toBe("profile_voice");
            expect(soundIni.getSection("OverriddenSound")?.getString("Sounds")).toBe("base_voice");
            expect(soundIni.getSection("OverriddenSound")?.getNumber("Volume")).toBe(90);
        }
        finally {
            Engine.vfs = previous.vfs;
            (Engine as any).activeProfile = previous.activeProfile;
            (Engine as any).iniSourceLoader = previous.iniSourceLoader;
            Engine.setActiveEngine(previous.activeEngine);
        }
    });

    test("keeps the canonical YR sound index unchanged", () => {
        const previous = {
            activeEngine: Engine.getActiveEngine(),
            activeProfile: (Engine as any).activeProfile,
            iniSourceLoader: (Engine as any).iniSourceLoader,
            vfs: Engine.vfs,
        };
        const vfs = createVfs();
        vfs.addArchive(archiveWithSoundFiles({
            "soundmd.ini": `
[Defaults]
Volume=50
[SoundList]
0=YrSound
[YrSound]
Sounds=yr_voice
`,
        }), "sound-index.mix");
        try {
            Engine.vfs = vfs;
            (Engine as any).iniSourceLoader = new IniSourceLoader(vfs);
            (Engine as any).activeProfile = GAME_PROFILES.yr;
            Engine.setActiveEngine(EngineType.YurisRevenge);

            const soundIni = Engine.getSoundIni();

            expect(soundIni.getSection("YrSound")?.getString("Sounds")).toBe("yr_voice");
            expect(soundIni.getOrderedSections()).toHaveLength(4);
        }
        finally {
            Engine.vfs = previous.vfs;
            (Engine as any).activeProfile = previous.activeProfile;
            (Engine as any).iniSourceLoader = previous.iniSourceLoader;
            Engine.setActiveEngine(previous.activeEngine);
        }
    });
});
