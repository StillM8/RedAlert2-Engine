import { describe, expect, test } from "bun:test";
import { resolveAresIvanBombRules } from "@/extensions/ares/AresIvanBombs";

describe("Ares Ivan death bomb lifecycle", () => {
    test("death bombs have negative delay (never auto-detonate)", () => {
        const rules = resolveAresIvanBombRules(
            {
                deathBomb: true,
                deathBombOnAllies: false,
                destroysBridges: true,
                detachable: true,
                detonateOnSell: true,
            },
            { ivanTimedDelay: 60, ivanDamage: 500, ivanWarhead: "IvanWH" },
            false,
        );
        expect(rules.deathBomb).toBe(true);
        expect(rules.delay).toBe(-1);
    });

    test("allied death bombs use DeathBombOnAllies", () => {
        const rules = resolveAresIvanBombRules(
            {
                deathBomb: false,
                deathBombOnAllies: true,
                destroysBridges: true,
                detachable: true,
                detonateOnSell: true,
            },
            { ivanTimedDelay: 60, ivanDamage: 500, ivanWarhead: "IvanWH" },
            true,
        );
        expect(rules.deathBomb).toBe(true);
        expect(rules.delay).toBe(-1);
    });

    test("time bombs keep their positive delay", () => {
        const rules = resolveAresIvanBombRules(
            {
                deathBomb: false,
                deathBombOnAllies: false,
                destroysBridges: true,
                detachable: true,
                detonateOnSell: true,
                delay: 90,
            },
            { ivanTimedDelay: 60, ivanDamage: 500, ivanWarhead: "IvanWH" },
            false,
        );
        expect(rules.deathBomb).toBe(false);
        expect(rules.delay).toBe(90);
    });

    test("respects canDetonateDeathBomb flag", () => {
        const rules = resolveAresIvanBombRules(
            {
                deathBomb: true,
                deathBombOnAllies: false,
                destroysBridges: true,
                detachable: true,
                detonateOnSell: true,
                canDetonateDeathBomb: false,
            },
            { canDetonateDeathBomb: true },
            false,
        );
        expect(rules.canDetonateDeathBomb).toBe(false);
        expect(rules.canDetonateTimeBomb).toBe(true);
    });
});
