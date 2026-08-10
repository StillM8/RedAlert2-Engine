import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'fs';
import path from 'path';
const devPort = 4000;
// Mirrors the iOS shell's ra2app://app/gameres/ mount so the ?shell code path
// (first-launch asset seeding) is testable in a desktop browser.
const gameResDir = path.resolve(__dirname, '../gameres-export');
const serveGameResDev = (): Plugin => ({
    name: 'serve-gameres-dev',
    configureServer(server) {
        server.middlewares.use('/gameres', (req, res, next) => {
            const relPath = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
            const filePath = path.join(gameResDir, relPath);
            if (!filePath.startsWith(gameResDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                next();
                return;
            }
            res.setHeader('Content-Type', filePath.endsWith('.json') ? 'application/json' : 'application/octet-stream');
            res.setHeader('Content-Length', fs.statSync(filePath).size);
            fs.createReadStream(filePath).pipe(res);
        });
    },
});
// Keep the root WASM file used by the Android/iOS shells in lockstep with the
// 7z JavaScript wrapper. A stale manually-copied binary fails in WebView with
// an opaque WebAssembly import/link error.
const syncSevenZipWasm = (): Plugin => ({
    name: 'sync-seven-zip-wasm',
    apply: 'build',
    buildStart() {
        const source = path.resolve(__dirname, 'node_modules/7z-wasm/7zz.wasm');
        const target = path.resolve(__dirname, 'public/7zz.wasm');
        if (fs.existsSync(source)) {
            fs.copyFileSync(source, target);
        }
    },
});
// @ffmpeg/ffmpeg is only the browser-side wrapper. Its core is a separate
// WASM package and the wrapper otherwise defaults to unpkg, which is not
// available for offline Android/iOS imports. Keep the core same-origin and
// package it with every web build.
const syncFfmpegCore = (): Plugin => ({
    name: 'sync-ffmpeg-core',
    apply: 'build',
    buildStart() {
        const sourceDir = path.resolve(__dirname, 'node_modules/@ffmpeg/core/dist/esm');
        const targetDir = path.resolve(__dirname, 'public/ffmpeg');
        const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];
        fs.mkdirSync(targetDir, { recursive: true });
        for (const file of files) {
            const source = path.join(sourceDir, file);
            if (!fs.existsSync(source)) {
                throw new Error(`Missing @ffmpeg/core asset: ${source}. Install redalert2 dependencies first.`);
            }
            fs.copyFileSync(source, path.join(targetDir, file));
        }
    },
});
const manualHttpsConfig = fs.existsSync('./certs/server.key') && fs.existsSync('./certs/server.crt')
    ? { key: fs.readFileSync('./certs/server.key'), cert: fs.readFileSync('./certs/server.crt') }
    : undefined;
// http://localhost is still a secure context, so SharedArrayBuffer keeps working
// with the COOP/COEP headers below. Used for embedded-browser dev and the iOS shell.
const useHttp = !!process.env.RA2_HTTP;
export default defineConfig({
    plugins: [react(), serveGameResDev(), syncSevenZipWasm(), syncFfmpegCore(), ...(manualHttpsConfig || useHttp ? [] : [basicSsl()])],
    server: {
        host: '0.0.0.0',
        port: devPort,
        strictPort: true,
        https: useHttp ? undefined : (manualHttpsConfig ?? {}),
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
        },
        fs: {
            allow: ['..']
        }
    },
    preview: {
        host: '0.0.0.0',
        port: devPort,
        strictPort: true,
    },
    resolve: {
        alias: {
            '@': '/src'
        }
    },
    optimizeDeps: {
        exclude: ['7z-wasm', '@ffmpeg/ffmpeg'],
        include: []
    },
    worker: {
        format: 'es'
    },
    assetsInclude: ['**/*.wasm']
});
