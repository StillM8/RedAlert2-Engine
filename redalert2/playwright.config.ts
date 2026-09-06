import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);

export default defineConfig({
    testDir: './e2e/scenarios',
    outputDir: './e2e-results',
    fullyParallel: false,
    forbidOnly: isCi,
    retries: isCi ? 1 : 0,
    workers: 1,
    timeout: 300_000,
    expect: {
        timeout: 30_000,
    },
    reporter: isCi
        ? [['line'], ['html', { outputFolder: 'e2e-report', open: 'never' }]]
        : [['list']],
    use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4173',
        headless: true,
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
        actionTimeout: 30_000,
        navigationTimeout: 180_000,
    },
    webServer: {
        command: 'bun e2e/vite-server.ts',
        url: 'http://127.0.0.1:4173',
        timeout: 120_000,
        reuseExistingServer: !isCi,
    },
    projects: [
        {
            name: 'smoke',
            grep: /@smoke/,
        },
        {
            name: 'assets',
            grep: /@assets/,
        },
        {
            name: 'soak',
            grep: /@soak/,
        },
    ],
});
