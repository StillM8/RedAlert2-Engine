import { describe, expect, test } from "bun:test";
import { AudioSystem } from "@/engine/sound/AudioSystem";
import { ChannelType } from "@/engine/sound/ChannelType";

class FakeAudioNode {
    gain = { value: 0 };
    pan = { value: 0 };
    buffer: unknown;
    playbackRate = { value: 1 };
    loop = false;

    connect(): this {
        return this;
    }

    addEventListener(): void { }

    start(): void { }

    stop(): void { }
}

class FakeAudioContext {
    state: AudioContextState = "suspended";
    currentTime = 0;
    resumeCalls = 0;
    destination = new FakeAudioNode();

    async resume(): Promise<void> {
        this.resumeCalls++;
        this.state = "running";
    }

    async close(): Promise<void> {
        this.state = "closed";
    }

    createGain(): FakeAudioNode {
        return new FakeAudioNode();
    }

    createDynamicsCompressor(): FakeAudioNode {
        return new FakeAudioNode();
    }

    createStereoPanner(): FakeAudioNode {
        return new FakeAudioNode();
    }

    createBufferSource(): FakeAudioNode {
        return new FakeAudioNode();
    }

    async decodeAudioData(): Promise<{ duration: number }> {
        return { duration: 1 };
    }
}

describe("AudioSystem lifecycle", () => {
    test("resumes suspended audio even when music is not initialized", async () => {
        const originalAudioContext = (globalThis as any).AudioContext;
        (globalThis as any).AudioContext = FakeAudioContext;
        const mixer = {
            onVolumeChange: {
                subscribe: () => undefined,
                unsubscribe: () => undefined,
            },
            getVolume: () => 1,
            isMuted: () => false,
        };
        try {
            const audioSystem = new AudioSystem(mixer as any);
            audioSystem.initialize();
            const audioContext = (audioSystem as any).audioContext as FakeAudioContext;

            expect(audioSystem.isSuspended()).toBe(true);
            await audioSystem.resume();
            await audioSystem.resume();

            expect(audioSystem.isSuspended()).toBe(false);
            expect(audioContext.resumeCalls).toBe(1);
            audioSystem.dispose();
        }
        finally {
            (globalThis as any).AudioContext = originalAudioContext;
        }
    });

    test("requests a suspended-context resume when playback starts", async () => {
        const originalAudioContext = (globalThis as any).AudioContext;
        (globalThis as any).AudioContext = FakeAudioContext;
        const mixer = {
            onVolumeChange: {
                subscribe: () => undefined,
                unsubscribe: () => undefined,
            },
            getVolume: () => 1,
            isMuted: () => false,
        };
        try {
            const audioSystem = new AudioSystem(mixer as any);
            audioSystem.initialize();
            audioSystem.playWavFile({
                getData: () => new ArrayBuffer(4),
                asFile: () => new File([], "test.wav"),
            }, ChannelType.Voice);
            await Promise.resolve();
            await Promise.resolve();

            const audioContext = (audioSystem as any).audioContext as FakeAudioContext;
            expect(audioContext.resumeCalls).toBe(1);
            audioSystem.dispose();
        }
        finally {
            (globalThis as any).AudioContext = originalAudioContext;
        }
    });
});
