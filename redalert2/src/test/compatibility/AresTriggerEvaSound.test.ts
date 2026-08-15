import { describe, expect, test } from "bun:test";
import { SoundHandler } from "@/gui/screen/game/SoundHandler";
import { EventType } from "@/game/event/EventType";
import { TriggerEvaEvent } from "@/game/event/TriggerEvaEvent";

describe("SoundHandler EVA trigger speech", () => {
    test("plays the authored EVA dialog name through the side voice table", () => {
        const evaCalls: string[] = [];
        const handler = new SoundHandler(
            {},
            { playEffect: () => undefined },
            { play: (name: string) => evaCalls.push(name) },
            {},
            {},
            {},
            {},
            {},
        );
        (handler as any).handleGameEvent(new TriggerEvaEvent("EVA_OurBaseIsUnderAttack"));
        expect(evaCalls).toEqual(["EVA_OurBaseIsUnderAttack"]);
    });

    test("ignores trigger speech events without a dialog name", () => {
        const evaCalls: string[] = [];
        const handler = new SoundHandler(
            {},
            { playEffect: () => undefined },
            { play: (name: string) => evaCalls.push(name) },
            {},
            {},
            {},
            {},
            {},
        );
        (handler as any).handleGameEvent({ type: EventType.TriggerEva, soundId: undefined });
        expect(evaCalls).toEqual([]);
    });
});
