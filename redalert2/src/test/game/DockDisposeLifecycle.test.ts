import { describe, expect, test } from "bun:test";
import { DockTrait } from "@/game/gameobject/trait/DockTrait";
import { DockableTrait } from "@/game/gameobject/trait/DockableTrait";

/**
 * Regression tests for dock lifecycle on building destruction.
 *
 * Bug: DockTrait.onDestroy only cleaned up docked units when the
 * shouldRepairUnits gate passed. On death paths that skip that branch
 * (temporal erase, forced cleanup) the trait was disposed with
 * unitsByDockNumber still populated, so a docked aircraft's
 * WingedLocomotor kept reading isDocked()==true from the disposed trait and
 * never took off — permanently grounded while hovering over the wreck.
 *
 * The dispose() release must also tolerate units whose own traits were
 * already torn down (Traits.get throws "No matching trait" then).
 */

interface StubUnitOptions {
    id: number;
    destroyed?: boolean;
    disposed?: boolean;
    withDockable?: boolean;
}

function makeUnit(options: StubUnitOptions): any {
    const unit: any = {
        name: `aircraft-${options.id}`,
        isDestroyed: options.destroyed === true,
        isDisposed: options.disposed === true,
        isVehicle: () => false,
        isAircraft: () => true,
    };
    if (options.withDockable !== false) {
        unit.dockableTrait = new DockableTrait();
        const traits = {
            allTraits: [unit.dockableTrait],
            get(type: any) {
                const found = this.allTraits.find(trait => trait instanceof type);
                if (!found) throw new Error("No matching trait found");
                return found;
            },
        };
        unit.traits = traits;
    }
    return unit;
}

function makeDock(dockCount: number): { dock: DockTrait; building: any } {
    const building: any = {
        name: "GADEPT",
        isDisposed: false,
        isDestroyed: false,
    };
    const dock = new DockTrait(building, { getByMapCoords: () => undefined }, dockCount, []);
    // Bypass tile resolution done in onSpawn by seeding slots directly.
    return { dock, building };
}

describe("DockTrait disposal releases docked units", () => {
    test("dispose undocks live units so they can take off after their dock died", () => {
        const { dock } = makeDock(2);
        const aircraft = makeUnit({ id: 1 });
        (dock as any).unitsByDockNumber[0] = aircraft;
        aircraft.dockableTrait.dock = { dockTrait: dock };

        dock.dispose();

        expect((dock as any).unitsByDockNumber[0]).toBeUndefined();
        expect(aircraft.dockableTrait.dock).toBeUndefined();
        expect(dock.isDocked(aircraft)).toBe(false);
    });

    test("dispose tolerates destroyed units without touching their traits", () => {
        const { dock } = makeDock(2);
        const deadUnit = makeUnit({ id: 1, destroyed: true, withDockable: false });
        const liveUnit = makeUnit({ id: 2 });
        (dock as any).unitsByDockNumber[0] = deadUnit;
        (dock as any).unitsByDockNumber[1] = liveUnit;

        expect(() => dock.dispose()).not.toThrow();
        expect((dock as any).unitsByDockNumber[0]).toBeUndefined();
        expect((dock as any).unitsByDockNumber[1]).toBeUndefined();
    });

    test("dispose tolerates disposed units lacking DockableTrait", () => {
        const { dock } = makeDock(1);
        const disposedUnit = makeUnit({ id: 1, disposed: true, withDockable: false });
        (dock as any).unitsByDockNumber[0] = disposedUnit;

        expect(() => dock.dispose()).not.toThrow();
        expect((dock as any).unitsByDockNumber[0]).toBeUndefined();
    });

    test("stale reservations are cleared for destroyed units", () => {
        const { dock } = makeDock(1);
        const deadUnit = makeUnit({ id: 1, destroyed: true });
        (dock as any).reservedDocks[0] = deadUnit;

        dock.dispose();

        expect((dock as any).reservedDocks[0]).toBeUndefined();
    });

    test("the pre-fix behavior would keep the unit docked (documents the bug)", () => {
        // Documents what the bug looked like: without the dispose cleanup,
        // isDocked stays true against a disposed trait. The fix guarantees
        // this no longer happens; if someone removes the dispose release,
        // this test fails via the first case above. Kept as an explicit
        // semantic statement of the lifecycle invariant.
        const { dock } = makeDock(1);
        const aircraft = makeUnit({ id: 1 });
        (dock as any).unitsByDockNumber[0] = aircraft;
        dock.dispose();
        // The invariant that matters for gameplay:
        expect(dock.isDocked(aircraft)).toBe(false);
    });
});
