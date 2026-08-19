import { describe, expect, test } from "bun:test";
import { GarrisonTrait } from "@/game/gameobject/trait/GarrisonTrait";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { SellTrait } from "@/game/trait/SellTrait";

function owner(id: string, neutral = false): any {
    return { id, isNeutral: neutral, isAi: false, credits: 0, buildingsCaptured: 0 };
}

function building(trueOwner: any, urban: any): any {
    const result: any = {
        name: "BUNKER",
        owner: trueOwner,
        isDestroyed: false,
        healthTrait: { health: 100 },
        rules: {
            aresUrbanCombat: urban,
            occupantsPowerBonus: 0,
            power: 0,
            primary: undefined,
            unsellable: false,
            wall: false,
            cost: 500,
            soylent: 0,
        },
        purchaseValue: 500,
        isBuilding: () => true,
        addTrait: () => undefined,
    };
    result.garrisonTrait = new GarrisonTrait(result, 0.25, 5);
    return result;
}

function infantry(type: string, unitOwner: any): any {
    return {
        name: type,
        owner: unitOwner,
        rules: { name: type, occupier: true, slaved: false },
        mindControllableTrait: { isActive: () => false },
        mindControllerTrait: { isActive: () => false },
        addTrait: () => undefined,
        getHash: () => 1,
        debugGetState: () => ({ type }),
    };
}

describe("Ares Urban Combat garrison integration", () => {
    test("Bunker.Raidable admits an allowed hostile infantry only while empty", () => {
        const defender = owner("defender");
        const attacker = owner("attacker");
        const bunker = building(defender, {
            bunkerRaidable: true,
            canBeOccupiedBy: ["GI"],
        });
        const game: any = {
            areFriendly: (left: any, right: any) => left.owner === right.owner,
            changeObjectOwner: (target: any, nextOwner: any) => { target.owner = nextOwner; },
        };

        const gi = infantry("gi", attacker);
        const engineer = infantry("ENGINEER", attacker);
        expect(bunker.garrisonTrait.canAcceptOccupant(gi, game)).toBe(true);
        expect(bunker.garrisonTrait.canAcceptOccupant(engineer, game)).toBe(false);

        // The real occupy task performs the temporary raid ownership transfer
        // before inserting the first hostile occupant. Model that transaction
        // here instead of directly adding a hostile occupant to a defender-owned
        // bunker, which is not a reachable gameplay state.
        expect(bunker.garrisonTrait.beginTemporaryOccupation(attacker, game)).toBe(true);
        bunker.garrisonTrait.addOccupant(gi, game);
        expect(bunker.garrisonTrait.canAcceptOccupant(infantry("GI", defender), game)).toBe(false);
        expect(bunker.garrisonTrait.canAcceptOccupant(infantry("GI", attacker), game)).toBe(true);
    });

    test("temporary raid ownership cannot be sold and reverts when the last occupant dies", () => {
        const defender = owner("defender");
        const attacker = owner("attacker");
        const bunker = building(defender, {
            bunkerRaidable: true,
            canBeOccupiedBy: [],
        });
        let unplaceCalls = 0;
        const game: any = {
            areFriendly: (left: any, right: any) => left.owner === right.owner,
            changeObjectOwner: (target: any, nextOwner: any) => { target.owner = nextOwner; },
            getConstructionWorker: () => ({ unplace: () => { unplaceCalls++; } }),
            events: { dispatch: () => undefined },
        };
        const raider = infantry("GI", attacker);

        expect(bunker.garrisonTrait.beginTemporaryOccupation(attacker, game)).toBe(true);
        expect(bunker.owner).toBe(attacker);
        bunker.garrisonTrait.addOccupant(raider, game);
        expect(bunker.garrisonTrait.isTemporarilyOccupied()).toBe(true);

        new SellTrait(game, { refundPercent: 1 }).sell(bunker);
        expect(unplaceCalls).toBe(0);

        raider.aresGarrisonOccupantTrait[NotifyDestroy.onDestroy](raider, game);
        expect(bunker.garrisonTrait.getOccupantCount()).toBe(0);
        expect(bunker.owner).toBe(defender);
        expect(bunker.garrisonTrait.isTemporarilyOccupied()).toBe(false);
    });

    test("a conventional owner change becomes the next raid reversion owner", () => {
        const original = owner("original");
        const captured = owner("captured");
        const raiderOwner = owner("raider");
        const bunker = building(original, { bunkerRaidable: true, canBeOccupiedBy: [] });
        const game: any = {
            areFriendly: (left: any, right: any) => left.owner === right.owner,
            changeObjectOwner: (target: any, nextOwner: any) => { target.owner = nextOwner; },
        };
        bunker.owner = captured;
        bunker.garrisonTrait.setTrueOwner(captured);
        bunker.garrisonTrait.beginTemporaryOccupation(raiderOwner, game);
        const raider = infantry("GI", raiderOwner);
        bunker.garrisonTrait.addOccupant(raider, game);
        raider.aresGarrisonOccupantTrait[NotifyDestroy.onDestroy](raider, game);
        expect(bunker.owner).toBe(captured);
    });
});
