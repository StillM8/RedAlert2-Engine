import { test } from '../harness/fixtures';
import { expectFiniteObjectPositions, expectUniqueObjectIds } from '../harness/GameAssertions';
import { buildVehicleProduction, startAssetBackedSkirmish } from './qualificationFlow';

test('@assets moves a produced combat unit into attack and observes authoritative damage', async ({ engine, diagnostics }) => {
    await startAssetBackedSkirmish(engine);
    await buildVehicleProduction(engine);
    const attack = await engine.attackNearestEnemy();
    await engine.waitForDamage(attack.targetId, attack.targetHealth);
    await expectUniqueObjectIds(engine.page);
    await expectFiniteObjectPositions(engine.page);
    diagnostics.assertNoPageErrors();
});
