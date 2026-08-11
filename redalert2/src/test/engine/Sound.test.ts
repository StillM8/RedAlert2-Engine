import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { ChannelType } from "@/engine/sound/ChannelType";
import { Sound } from "@/engine/sound/Sound";
import { SoundSpecs } from "@/engine/sound/SoundSpecs";

function createSound(iniText: string, files: Map<string, any> = new Map()): {
    sound: Sound;
    calls: Array<{ kind: string; files?: any[] }>;
} {
    const calls: Array<{ kind: string; files?: any[] }> = [];
    const handle = {
        isPlaying: () => false,
        stop: () => undefined,
    };
    const audioSystem = {
        playWavFile: () => {
            calls.push({ kind: "file" });
            return handle;
        },
        playWavSequence: (wavFiles: any[]) => {
            calls.push({ kind: "sequence", files: wavFiles });
            return handle;
        },
        playWavLoop: (wavFiles: any[]) => {
            calls.push({ kind: "loop", files: wavFiles });
            return handle;
        },
    };
    const specs = new SoundSpecs(new IniFile(iniText));
    const sound = new Sound(
        audioSystem as any,
        { get: (filename: string) => files.get(filename) },
        specs,
        { ini: { getString: () => undefined } },
        {} as any,
    );
    return { sound, calls };
}

const defaults = `[Defaults]
MinVolume=0
Range=100
Volume=100
Limit=1
Type=Global
Priority=Normal
`;

describe("Sound playback safety", () => {
    test("does not invent an empty main sound in an attack/decay sequence", () => {
        const { sound, calls } = createSound(`${defaults}
[SoundList]
0=BrokenSequence
[BrokenSequence]
Sounds=attack decay
Control=attack decay
Attack=1
Decay=1
`, new Map([
            ["attack.wav", { name: "attack.wav" }],
            ["decay.wav", { name: "decay.wav" }],
        ]));

        sound.play("BrokenSequence", ChannelType.Effect);

        expect(calls).toHaveLength(1);
        expect(calls[0].kind).toBe("sequence");
        expect(calls[0].files?.map((file) => file.name)).toEqual(["attack.wav", "decay.wav"]);
    });

    test("does not send an all-missing attack/decay sequence to the audio backend", () => {
        const { sound, calls } = createSound(`${defaults}
[SoundList]
0=MissingSequence
[MissingSequence]
Sounds=missing_attack missing_decay
Control=attack decay
Attack=1
Decay=1
`);

        sound.play("MissingSequence", ChannelType.Effect);

        expect(calls).toEqual([]);
    });

    test("does not send an all-missing loop to the audio backend", () => {
        const { sound, calls } = createSound(`${defaults}
[SoundList]
0=MissingLoop
[MissingLoop]
Sounds=missing_loop_a missing_loop_b
Control=loop
`);

        sound.play("MissingLoop", ChannelType.Effect);

        expect(calls).toEqual([]);
    });
});
