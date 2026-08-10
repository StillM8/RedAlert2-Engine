import { describe, expect, test } from "bun:test";
import { GameOptRandomGen } from "@/game/gameopts/GameOptRandomGen";
import { RANDOM_COUNTRY_ID } from "@/game/gameopts/constants";

class FixedRandom {
    constructor(private readonly value: number) { }
    generateRandomInt(_min: number, _max: number): number {
        return this.value;
    }
}

describe("Ares country random selection", () => {
    test("uses country random weights while preserving lobby indices", () => {
        const countries = [
            { id: "Alpha", randomSelectionWeight: 1 },
            { id: "Beta", randomSelectionWeight: 0 },
            { id: "Gamma", randomSelectionWeight: 3 },
        ];
        const rules = { getMultiplayerCountries: () => countries };
        const first = { countryId: RANDOM_COUNTRY_ID };
        const last = { countryId: RANDOM_COUNTRY_ID };
        const firstGenerator = new GameOptRandomGen(new FixedRandom(1) as any);
        const lastGenerator = new GameOptRandomGen(new FixedRandom(4) as any);

        expect(firstGenerator.generateCountries({ humanPlayers: [first], aiPlayers: [] }, rules).get(first)).toBe(0);
        expect(lastGenerator.generateCountries({ humanPlayers: [last], aiPlayers: [] }, rules).get(last)).toBe(2);
    });

    test("falls back to all selectable countries if every weight is zero", () => {
        const countries = [
            { id: "Alpha", randomSelectionWeight: 0 },
            { id: "Beta", randomSelectionWeight: 0 },
        ];
        const rules = { getMultiplayerCountries: () => countries };
        const player = { countryId: RANDOM_COUNTRY_ID };
        const generator = new GameOptRandomGen(new FixedRandom(2) as any);

        expect(generator.generateCountries({ humanPlayers: [player], aiPlayers: [] }, rules).get(player)).toBe(1);
    });
});
