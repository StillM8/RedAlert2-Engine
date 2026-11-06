import { describe, expect, test } from "bun:test";
import {
    TNT_CHARGE_TRAIT_STATE_VERSION,
    TntChargeTrait,
} from "@/game/gameobject/trait/TntChargeTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import type { AresIvanBombChargeRules } from "@/extensions/ares/AresIvanBombs";

function bombRules(overrides: Partial<AresIvanBombChargeRules> = {}): AresIvanBombChargeRules {
    return {
        deathBomb: false,
        destroysBridges: true,
        detachable: true,
        damage: 125,
        delay: 30,
        tickingSound: "Tick",
        attachSound: "Plant",
        warhead: "IvanWH",
        image: "BOMB",
        flickerRate: 4,
        canDetonateTimeBomb: true,
        canDetonateDeathBomb: true,
        detonateOnSell: true,
        ...overrides,
    };
}

describe("TntChargeTrait state codec", () => {
    test("round-trips timer attacker and bomb rules without weapon references", () => {
        const player = { playerListIndex: 2 };
        const attacker = { id: 17 };
        const source = new TntChargeTrait();
        source.setCharge(30, 100, { player, obj: attacker, weapon: { rules: { name: "Secret" } } }, bombRules());
        source[NotifyTick.onTick]({} as any, { currentTick: 100 } as any);
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        expect(snapshot.version).toBe(TNT_CHARGE_TRAIT_STATE_VERSION);
        expect(snapshot).toMatchObject({
            active: true,
            ticksLeft: 29,
            initialTicks: 30,
            startedAtTick: 100,
            attackerPlayerListIndex: 2,
            attackerObjectId: 17,
        });
        expect(JSON.stringify(snapshot)).not.toContain("weapon");

        const target = new TntChargeTrait();
        target.restoreState(snapshot, {
            strict: true,
            resolvePlayerByIndex: index => index === 2 ? player : undefined,
            resolveObjectById: id => id === 17 ? attacker : undefined,
        });

        expect(target.captureState()).toEqual(snapshot);
        expect(target.getHash()).toBe(source.getHash());
        expect(target.getChargeOwner()).toBe(player);
    });

    test("keeps zero-delay charges active and resolves complete image frames", () => {
        const zeroDelay = new TntChargeTrait();
        zeroDelay.setCharge(0, 4, { player: { playerListIndex: 0 } }, bombRules({ delay: 0 }));
        expect(zeroDelay.hasCharge()).toBe(true);
        expect(zeroDelay.getBombFrame(6, 0)).toBe(0);

        const timed = new TntChargeTrait();
        timed.setCharge(5, 10, { player: { playerListIndex: 0 } }, bombRules({ delay: 5, flickerRate: 0 }));
        timed[NotifyTick.onTick]({} as any, { currentTick: 10 } as any);
        expect(timed.getBombFrame(6, 0)).toBe(1);

        const death = new TntChargeTrait();
        death.setCharge(-1, 20, { player: { playerListIndex: 0 } }, bombRules({ deathBomb: true, delay: -1 }));
        expect(death.getBombFrame(6, 0)).toBe(5);
    });

    test("hash includes timer attacker and authored bomb rules", () => {
        const player = { playerListIndex: 0 };
        const base = new TntChargeTrait();
        base.setCharge(20, 40, { player, obj: { id: 1 } }, bombRules());
        const timer = new TntChargeTrait();
        timer.setCharge(21, 40, { player, obj: { id: 1 } }, bombRules());
        const attacker = new TntChargeTrait();
        attacker.setCharge(20, 40, { player, obj: { id: 2 } }, bombRules());
        const rules = new TntChargeTrait();
        rules.setCharge(20, 40, { player, obj: { id: 1 } }, bombRules({ detonateOnSell: false }));
        const started = new TntChargeTrait();
        started.setCharge(20, 41, { player, obj: { id: 1 } }, bombRules());

        expect(timer.getHash()).not.toBe(base.getHash());
        expect(attacker.getHash()).not.toBe(base.getHash());
        expect(rules.getHash()).not.toBe(base.getHash());
        expect(started.getHash()).not.toBe(base.getHash());
    });

    test("strict validation resolves canonical identities before mutation", () => {
        const player = { playerListIndex: 1 };
        const attacker = { id: 8 };
        const source = new TntChargeTrait();
        source.setCharge(12, 50, { player, obj: attacker }, bombRules());
        const snapshot = source.captureState();
        const target = new TntChargeTrait();
        target.setCharge(4, 90, { player, obj: attacker }, bombRules({ damage: 1 }));
        const before = target.captureState();

        expect(() => target.restoreState({
            ...snapshot,
            attackerPlayerListIndex: 3,
        }, {
            strict: true,
            resolvePlayerByIndex: index => index === 1 ? player : undefined,
        })).toThrow(/player identity 3 is unresolved/);
        expect(target.captureState()).toEqual(before);

        expect(() => target.restoreState({
            ...snapshot,
            bombRules: { ...snapshot.bombRules, damage: "bad" },
        }, { strict: true })).toThrow(/bombRules\.damage/);
        expect(target.captureState()).toEqual(before);
    });

    test("restores death-bomb timer bounds and rejects unsupported state", () => {
        const player = { playerListIndex: 0 };
        const source = new TntChargeTrait();
        source.setCharge(-1, 77, { player }, bombRules({ deathBomb: true, delay: -1 }));
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));
        const target = new TntChargeTrait();

        target.restoreState(snapshot, {
            strict: true,
            resolvePlayerByIndex: () => player,
        });

        expect(target.hasCharge()).toBe(true);
        expect(target.getInitialTicks()).toBe(Number.MAX_SAFE_INTEGER);
        expect(target.captureState()).toEqual(snapshot);
        expect(() => target.restoreState({ ...snapshot, version: 2 })).toThrow(/version/i);
    });
});
