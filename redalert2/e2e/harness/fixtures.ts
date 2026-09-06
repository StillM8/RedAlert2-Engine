import { test as base, expect } from '@playwright/test';
import { AssetProfile } from './AssetProfile';
import { Diagnostics } from './Diagnostics';
import { EngineDriver } from './EngineDriver';

type HarnessFixtures = {
    assets: AssetProfile;
    diagnostics: Diagnostics;
    engine: EngineDriver;
};

export const test = base.extend<HarnessFixtures>({
    assets: async ({}, use) => {
        await use(AssetProfile.fromEnvironment());
    },
    diagnostics: async ({ page }, use) => {
        await use(new Diagnostics(page));
    },
    engine: async ({ page, assets, diagnostics }, use, testInfo) => {
        const engine = new EngineDriver(page, assets, diagnostics);
        await use(engine);
        if (testInfo.status !== testInfo.expectedStatus) {
            const snapshot = await diagnostics.capture();
            await testInfo.attach('engine-diagnostics.json', {
                body: JSON.stringify({
                    ...snapshot,
                    recentActions: engine.getRecentActions(),
                }, null, 2),
                contentType: 'application/json',
            });
        }
    },
});

export { expect };
