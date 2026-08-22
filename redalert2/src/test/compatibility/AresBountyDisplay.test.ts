import { describe, expect, test } from "bun:test";
import { SoundHandler } from "@/gui/screen/game/SoundHandler";
import { EventType } from "@/game/event/EventType";
import { AresBountyAwardEvent } from "@/game/event/AresBountyAwardEvent";

/**
 * Proves the AresBountyAward simulation event reaches the shared HUD message
 * channel through the production SoundHandler, closing the bounty display
 * presentation axis. The handler under test is the live class wired in
 * GameScreen; only its collaborators are stubbed.
 */

interface RecordedMessage {
    text: string;
    color: any;
}

function createHandler(strings: Record<string, string>, player?: any): {
    handler: SoundHandler;
    messages: RecordedMessage[];
} {
    const messages: RecordedMessage[] = [];
    const handler = new SoundHandler(
        {},
        { playEffect: () => undefined },
        { play: () => undefined },
        {},
        {},
        {
            addSystemMessage(text: string, color: any): void {
                messages.push({ text, color });
            },
        },
        {
            get: (key: string, ...args: any[]) => {
                const template = strings[key];
                if (template === undefined) return key;
                let result = template;
                for (const arg of args) result = result.replace("%s", arg).replace("%d", arg);
                return result;
            },
            has: (key: string) => key in strings,
        },
        player,
    );
    return { handler, messages };
}

describe("SoundHandler Ares bounty display", () => {
    test("surfaces a positive award with the killer's house color", () => {
        const killer = { name: "Soviet", color: { asHexString: () => "#ff0000" } };
        const { handler, messages } = createHandler({
            TXT_BOUNTY_RECEIVED: "Bounty collected: %s credits",
        });
        handler.handleGameEvent(new AresBountyAwardEvent(killer, {}, {}, 500, undefined));
        expect(messages).toEqual([
            { text: "Bounty collected: 500 credits", color: killer.color },
        ]);
    });

    test("surfaces a negative award through the lost-bounty wording", () => {
        const killer = { name: "Allied", color: { asHexString: () => "#0000ff" } };
        const { handler, messages } = createHandler({
            TXT_BOUNTY_LOST: "Bounty paid: %s credits",
        });
        handler.handleGameEvent(new AresBountyAwardEvent(killer, {}, {}, -250, undefined));
        expect(messages).toEqual([
            { text: "Bounty paid: 250 credits", color: killer.color },
        ]);
    });

    test("falls back to the raw signed amount when no strings are authored", () => {
        const { handler, messages } = createHandler({});
        handler.handleGameEvent(new AresBountyAwardEvent({ color: "grey" }, {}, {}, 750, undefined));
        expect(messages).toEqual([{ text: "+750", color: "grey" }]);
    });

    test("ignores zero-amount awards", () => {
        const { handler, messages } = createHandler({});
        handler.handleGameEvent(new AresBountyAwardEvent({ color: "grey" }, {}, {}, 0, undefined));
        expect(messages).toEqual([]);
    });
});
