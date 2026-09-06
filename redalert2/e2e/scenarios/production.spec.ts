import { test, expect } from '../harness/fixtures';
import { expectFiniteObjectPositions, expectUniqueObjectIds } from '../harness/GameAssertions';
import { buildBasicEconomy, buildRole, startAssetBackedSkirmish } from './qualificationFlow';

test('@assets builds infantry and vehicle production and completes one unit of each', async ({ engine, diagnostics }) => {
    await startAssetBackedSkirmish(engine);
    await buildBasicEconomy(engine);

    await buildRole(engine, 'barracks');
    const infantry = await engine.queueCombatUnit('infantry');
    await engine.waitForProductionReady(infantry);
    await engine.advanceTicks(30);
    await engine.waitForOwnedObject(infantry.objectName);

    await buildRole(engine, 'war-factory');
    const vehicle = await engine.queueCombatUnit('vehicle');
    await engine.waitForProductionReady(vehicle);
    await engine.advanceTicks(30);
    await engine.waitForOwnedObject(vehicle.objectName);

    const owned = await engine.getOwnedObjects();
    expect(owned.some((object) => object.name === infantry.objectName && object.isUnit)).toBe(true);
    expect(owned.some((object) => object.name === vehicle.objectName && object.isUnit)).toBe(true);
    await expectUniqueObjectIds(engine.page);
    await expectFiniteObjectPositions(engine.page);
    diagnostics.assertNoPageErrors();
});
