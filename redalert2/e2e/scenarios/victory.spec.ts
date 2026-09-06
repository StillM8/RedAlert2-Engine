import { test, expect } from '../harness/fixtures';
import { expectFiniteObjectPositions, expectUniqueObjectIds } from '../harness/GameAssertions';
import { buildVehicleProduction, startAssetBackedSkirmish } from './qualificationFlow';

test('@assets reaches a normal game-end state after the playable combat path', async ({ engine, diagnostics }) => {
    await startAssetBackedSkirmish(engine);
    await buildVehicleProduction(engine);
    const attack = await engine.attackNearestEnemy();
    await engine.waitForDamage(attack.targetId, attack.targetHealth);
    await engine.waitForDestroyed(attack.targetId);

    // This is intentionally a real simulation wait. The harness must report
    // a failure if the AI/game rules cannot reach a legal victory state rather
    // than calling Game.end() or mutating the world from the test.
    const finalState = await engine.waitForGameEnd();
    expect(finalState.status).toBe(2);
    await engine.waitForScoreScreen();
    await expectUniqueObjectIds(engine.page);
    await expectFiniteObjectPositions(engine.page);
    diagnostics.assertNoPageErrors();
});
