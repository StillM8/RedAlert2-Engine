import { describe, expect, test } from "bun:test";
import { ScoreTable } from "@/gui/screen/mainMenu/score/ScoreTable";

describe("ScoreTable", () => {
    test("renders the RA2/YR-style table from the retained game state", () => {
        const player = {
            name: "Player",
            isObserver: false,
            isAi: false,
            defeated: false,
            score: 125,
            country: { name: "Americans" },
            color: { asHexString: () => "#ffffff" },
            getUnitsKilled: () => 3,
            getUnitsLost: () => 1,
        };
        const game = {
            getNonNeutralPlayers: () => [player],
            currentTime: 90_000,
            speed: { value: 1 },
            gameOpts: { mapTitle: "Test Map" },
            stalemateDetectTrait: undefined,
            alliances: { getAllies: () => [] },
        };

        const element: any = ScoreTable({
            game,
            singlePlayer: true,
            tournament: false,
            localPlayer: player,
            strings: { get: (key: string) => key },
        });

        expect(element.type).toBe("div");
        expect(element.props.children[1].type).toBe("div");
    });
});
