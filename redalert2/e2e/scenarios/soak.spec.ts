import { test, expect } from '../harness/fixtures';
import { expectFiniteObjectPositions, expectUniqueObjectIds } from '../harness/GameAssertions';
import { startAssetBackedSkirmish } from './qualificationFlow';

test('@soak advances an accelerated AI skirmish and checks lifecycle invariants', async ({ engine, diagnostics }) => {
    await startAssetBackedSkirmish(engine, { aiCount: 3 });
    const initial = await engine.readState();
    const targetTick = (initial?.currentTick ?? 0) + 30_000;
    let currentTick = initial?.currentTick ?? 0;
    while (currentTick < targetTick) {
        const state = await engine.advanceTicks(Math.min(1_000, targetTick - currentTick));
        expect(state.currentTick).toBeGreaterThanOrEqual(0);
        await expectUniqueObjectIds(engine.page);
        await expectFiniteObjectPositions(engine.page);
        currentTick = state.currentTick ?? currentTick;
        if (state.status === 2) {
            break;
        }
    }
    const finalState = await engine.readState();
    expect(finalState?.currentTick).toBeGreaterThanOrEqual(initial?.currentTick ?? 0);
    diagnostics.assertNoPageErrors();
    diagnostics.assertNoRepeatedRuntimeErrors();
});
