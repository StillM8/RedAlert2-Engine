import { spawn } from 'node:child_process';

const child = spawn(process.execPath, [
    '--bun',
    'vite',
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
], {
    env: {
        ...process.env,
        // The Playwright server is local and does not need Vite's generated
        // development certificate. Plain HTTP also makes its URL portable to
        // Windows, Linux, and macOS without trusting a local CA.
        RA2_HTTP: '1',
    },
    stdio: 'inherit',
});

const stop = () => child.kill('SIGTERM');
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

const exitCode = await new Promise<number>((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
process.exit(exitCode);
