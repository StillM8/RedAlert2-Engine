import { describe, expect, test } from "bun:test";
import { AudioSystem } from "@/engine/sound/AudioSystem";

class FakeAudioNode {
    gain = { value: 0 };

    connect(): this {
        return this;
    }
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
});
