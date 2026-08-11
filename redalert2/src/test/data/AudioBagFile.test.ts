import { describe, expect, test } from "bun:test";
import { AudioBagFile } from "@/data/AudioBagFile";
import { VirtualFile } from "@/data/vfs/VirtualFile";

describe("AudioBagFile resource identity", () => {
    test("resolves IDX WAV names case-insensitively", async () => {
        const bag = VirtualFile.fromBytes(new Uint8Array([1, 2, 3, 4]), "audio.bag");
        const idx = {
            entries: new Map([
                ["FoehnVoice.WAV", {
                    offset: 0,
                    length: 4,
                    sampleRate: 22050,
                    flags: 0x02,
                    chunkSize: 0,
                }],
            ]),
        } as any;
        const audio = await new AudioBagFile().fromVirtualFile(bag, idx);

        expect(audio.containsFile("foehnvoice.wav")).toBe(true);
        expect(audio.openFile("FOEHNVOICE.WAV").getSize()).toBeGreaterThan(4);
    });
});
