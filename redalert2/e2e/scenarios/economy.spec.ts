import { test, expect } from '../harness/fixtures';
import { expectFiniteObjectPositions, expectUniqueObjectIds } from '../harness/GameAssertions';
import { buildBasicEconomy, startAssetBackedSkirmish } from './qualificationFlow';

test('@assets runs the opening economy path through MCV, power, refinery, and harvesters', async ({ engine, diagnostics }) => {
    await startAssetBackedSkirmish(engine);
    const startingEconomy = await engine.readEconomy();
    expect(Number.isFinite(startingEconomy.credits)).toBe(true);

    await buildBasicEconomy(engine);
    const economy = await engine.readEconomy();
    expect(economy.objects.some((object) => object.isBuilding && object.name)).toBe(true);
    expect(economy.objects.some((object) => object.isHarvester)).toBe(true);
    expect(Number.isFinite(economy.credits)).toBe(true);

    await engine.advanceTicks(1_200);
    const afterGathering = await engine.readEconomy();
    expect(afterGathering.credits).toBeGreaterThan(economy.credits);
    await expectUniqueObjectIds(engine.page);
    await expectFiniteObjectPositions(engine.page);
    diagnostics.assertNoPageErrors();
});
