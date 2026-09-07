import { test, expect } from '../harness/fixtures';
import { expectFiniteObjectPositions, expectUniqueObjectIds } from '../harness/GameAssertions';
import { startAssetBackedSkirmish } from './qualificationFlow';

test('@soak advances an accelerated AI skirmish and checks lifecycle invariants', async ({ engine, diagnostics }) => {
    await startAssetBackedSkirmish(engine, { aiCount: 3 });
    const targetTicks = 30_000;
    const chunkSize = 1_000;
    const maxMatches = 100;
    let totalTicks = 0;
    let matchTicks = 0;
    let maxSingleMatchTicks = 0;
    let maxObjects = 0;
    let matchesCompleted = 0;
    let matchesStarted = 1;
    const finalHashes: Array<number | string> = [];
    let previousTick = (await engine.readState())?.currentTick ?? 0;

    while (totalTicks < targetTicks) {
        const requestedTicks = Math.min(chunkSize, targetTicks - totalTicks);
        const state = await engine.advanceTicks(requestedTicks);
        const currentTick = state.currentTick ?? previousTick;
        const advancedTicks = currentTick - previousTick;
        expect(advancedTicks).toBeGreaterThanOrEqual(0);
        // The normal wall-clock turn loop may execute between the two
        // browser evaluations, so observed progress can exceed the explicit
        // accelerated request. Count the authoritative tick delta rather
        // than treating that concurrent progress as a test failure.
        if (advancedTicks === 0 && state.status !== 2) {
            throw new Error(`AI soak stopped advancing at tick ${currentTick} before the match ended`);
        }
        totalTicks += advancedTicks;
        matchTicks += advancedTicks;
        previousTick = currentTick;
        maxObjects = Math.max(maxObjects, state.objectCount ?? 0);
        await expectUniqueObjectIds(engine.page);
        await expectFiniteObjectPositions(engine.page);

        if (state.status === 2) {
            matchesCompleted++;
            maxSingleMatchTicks = Math.max(maxSingleMatchTicks, matchTicks);
            if (state.hash !== undefined) {
                finalHashes.push(state.hash);
            }
            if (totalTicks >= targetTicks) {
                break;
            }
            if (matchesStarted >= maxMatches) {
                throw new Error(`AI soak exceeded ${maxMatches} matches before reaching ${targetTicks} cumulative ticks`);
            }
            await startAssetBackedSkirmish(engine, { aiCount: 3 });
            matchesStarted++;
            matchTicks = 0;
            previousTick = (await engine.readState())?.currentTick ?? 0;
        }
    }

    const finalState = await engine.readState();
    maxSingleMatchTicks = Math.max(maxSingleMatchTicks, matchTicks);
    if (finalState?.hash !== undefined && finalHashes.at(-1) !== finalState.hash) {
        finalHashes.push(finalState.hash);
    }
    const summary = {
        matchesCompleted,
        totalTicks,
        maxObjects,
        maxSingleMatchTicks,
        finalHashes,
    };
    console.info(`[E2E soak summary] ${JSON.stringify(summary)}`);
    await test.info().attach('soak-summary.json', {
        body: JSON.stringify(summary, null, 2),
        contentType: 'application/json',
    });
    expect(totalTicks).toBeGreaterThanOrEqual(targetTicks);
    expect(maxSingleMatchTicks).toBeGreaterThan(0);
    diagnostics.assertNoPageErrors();
    diagnostics.assertNoRepeatedRuntimeErrors();
});
