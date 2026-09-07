import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { AssetProfile } from './AssetProfile';
import { Diagnostics } from './Diagnostics';
import { EngineDriver } from './EngineDriver';

type HarnessFixtures = {
    assets: AssetProfile;
    diagnostics: Diagnostics;
    engine: EngineDriver;
};

type PlaywrightInternalFixtures = {
    _combinedContextOptions: Record<string, unknown>;
};

export const test = base.extend<HarnessFixtures & PlaywrightInternalFixtures>({
    context: async ({ browser, launchOptions, _combinedContextOptions }, use) => {
        // Chromium's normal Playwright test context is isolated and has a
        // small per-origin quota. A real YR installation can exceed that
        // quota before the importer reaches the game. Asset-backed runs use a
        // disposable persistent profile so the qualification exercises the
        // normal importer with real files instead of a reduced fixture.
        if (!process.env.RA2_E2E_ASSETS) {
            const context = await browser.newContext(_combinedContextOptions);
            await use(context);
            await context.close();
            return;
        }
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra2-engine-e2e-'));
        const context = await browser.browserType().launchPersistentContext(userDataDir, {
            ...launchOptions,
            ..._combinedContextOptions,
        });
        try {
            await use(context);
        }
        finally {
            await context.close();
            fs.rmSync(userDataDir, { recursive: true, force: true });
        }
    },
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
