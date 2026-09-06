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
        // Let Playwright supervise Vite directly. Spawning a second Bun
        // process from a TypeScript wrapper can leave the child alive without
        // a listening socket on CI, so the webServer readiness probe waits
        // until it times out. This command works with Bun on Windows, Linux,
        // and macOS and keeps the E2E-only HTTP mode explicit below.
        command: 'bun --bun vite --host 127.0.0.1 --port 4173',
        env: {
            RA2_HTTP: '1',
        },
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
