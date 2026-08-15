import { describe, expect, test } from "bun:test";
import { SoundHandler } from "@/gui/screen/game/SoundHandler";
import { OrderFeedbackType } from "@/game/order/OrderFeedbackType";

function makeUnit(voiceAttack: string, voiceIfvRepair?: string) {
    return {
        rules: {
            voiceAttack,
            voiceCapture: "VoiceCapture",
            voiceSpecialAttack: "VoiceSpecialAttack",
            ares: voiceIfvRepair !== undefined
                ? { ifv: { voiceIfvRepair } }
                : undefined,
        },
    };
}

function playFeedback(unit: any, feedbackType: OrderFeedbackType): string | undefined {
    const calls: any[][] = [];
    const handler = new SoundHandler(
        {},
        { playEffect: () => undefined },
        {},
        { play: (...args: any[]) => calls.push(args) },
        {},
        {},
        {},
        {},
    );
    (handler as any).lastFeedbackTime = 0;
    (handler as any).handleOrderPushed(unit, 0, feedbackType);
    return calls[0]?.[0];
}

describe("Ares VoiceIFVRepair feedback", () => {
    test("uses VoiceIFVRepair when present", () => {
        const unit = makeUnit("VoiceAttack", "VoiceIFVRepair");
        expect(playFeedback(unit, OrderFeedbackType.Repair)).toBe("VoiceIFVRepair");
    });

    test("falls back to VoiceAttack when VoiceIFVRepair is absent", () => {
        const unit = makeUnit("VoiceAttack");
        expect(playFeedback(unit, OrderFeedbackType.Repair)).toBe("VoiceAttack");
    });

    test("does not change existing capture feedback", () => {
        const unit = makeUnit("VoiceAttack", "VoiceIFVRepair");
        expect(playFeedback(unit, OrderFeedbackType.Capture)).toBe("VoiceCapture");
    });
});
