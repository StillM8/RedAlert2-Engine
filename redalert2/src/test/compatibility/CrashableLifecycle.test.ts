import { describe, expect, test } from "bun:test";
import { CrashableTrait } from "@/game/gameobject/trait/CrashableTrait";
import { NotifyCrash } from "@/game/gameobject/trait/interface/NotifyCrash";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { LocomotorType } from "@/game/type/LocomotorType";

describe("Crashable lifecycle", () => {
    test("emits NotifyCrash exactly once and forwards attacker context", () => {
        const attacker = { obj: { id: 7 } };
        let calls = 0;
        let receivedAttacker: any;
        const crashObserver = {
            [NotifyCrash.onCrash]: (_target: any, _world: any, source: any) => {
                calls++;
                receivedAttacker = source;
            },
        };
        const target: any = {
            isCrashing: false,
            cachedTraits: { tick: [] },
            rules: { locomotor: LocomotorType.Unsupported },
            traits: { filter: () => [crashObserver] },
        };
        const world: any = { events: { dispatch: () => undefined } };
        const trait = new CrashableTrait(target);
        trait.crash(attacker);

        expect(() => trait[NotifyTick.onTick](target, world)).toThrow();
        expect(calls).toBe(1);
        expect(receivedAttacker).toBe(attacker);

        expect(() => trait[NotifyTick.onTick](target, world)).toThrow();
        expect(calls).toBe(1);
    });
});
