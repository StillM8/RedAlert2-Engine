import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'fs';
import path from 'path';
const devPort = 4000;
const tauriDevHost = process.env.TAURI_DEV_HOST;
const isTauriBuild = !!process.env.TAURI_ENV_PLATFORM || !!tauriDevHost;
// Mirrors the native shells' packaged-only /gameres-bundle/ mount so the
// ?shell code path (first-launch asset seeding) is testable in a desktop
// browser without conflating it with a user's imported /gameres/ files.
const gameResDir = path.resolve(__dirname, '../gameres-export');
const serveGameResDev = (): Plugin => ({
    name: 'serve-gameres-dev',
    configureServer(server) {
        server.middlewares.use('/gameres-bundle', (req, res, next) => {
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
interface E2eAssetManifestEntry {
    kind: 'file' | 'directory';
    entries?: Record<string, E2eAssetManifestEntry>;
}

function buildE2eAssetManifest(directory: string): Record<string, E2eAssetManifestEntry> {
    const entries: Record<string, E2eAssetManifestEntry> = {};
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        // Do not follow links from an asset fixture. Apart from making the
        // manifest deterministic, this prevents an accidental symlink from
        // exposing files outside the explicitly configured fixture root.
        if (entry.isSymbolicLink()) {
            continue;
        }
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            entries[entry.name] = {
                kind: 'directory',
                entries: buildE2eAssetManifest(entryPath),
            };
        }
        else if (entry.isFile()) {
            entries[entry.name] = { kind: 'file' };
        }
    }
    return entries;
}

function contentTypeForE2eAsset(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
        case '.json':
            return 'application/json';
        case '.mix':
        case '.bag':
        case '.idx':
        case '.aud':
        case '.wav':
        case '.shp':
        case '.vxl':
        case '.hva':
            return 'application/octet-stream';
        default:
            return 'application/octet-stream';
    }
}

// Playwright asset-backed tests use this route only when the caller supplies
// RA2_E2E_ASSETS. It is deliberately a development-server feature: it is not
// included in a production bundle and it never copies the fixture into the
// repository or release artifacts.
const serveE2eAssets = (): Plugin => ({
    name: 'serve-e2e-assets',
    configureServer(server) {
        const configuredRoot = process.env.RA2_E2E_ASSETS?.trim();
        if (!configuredRoot) {
            return;
        }
        const assetRoot = path.resolve(configuredRoot);
        if (!fs.existsSync(assetRoot) || !fs.statSync(assetRoot).isDirectory()) {
            throw new Error(`RA2_E2E_ASSETS must point to a directory: ${assetRoot}`);
        }
        const manifest = {
            version: 1,
            rootName: path.basename(assetRoot),
            entries: buildE2eAssetManifest(assetRoot),
        };
        server.middlewares.use('/__e2e_assets__', (req, res, next) => {
            let relativePath: string;
            try {
                relativePath = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
            }
            catch {
                res.statusCode = 400;
                res.end('Invalid asset path');
                return;
            }
            if (relativePath === '__manifest.json') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(manifest));
                return;
            }
            const filePath = path.resolve(assetRoot, relativePath);
            if (filePath !== assetRoot && !filePath.startsWith(`${assetRoot}${path.sep}`)) {
                res.statusCode = 403;
                res.end('Asset path is outside the configured fixture');
                return;
            }
            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                next();
                return;
            }
            res.setHeader('Content-Type', contentTypeForE2eAsset(filePath));
            res.setHeader('Content-Length', fs.statSync(filePath).size);
            fs.createReadStream(filePath).on('error', next).pipe(res);
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
// Tauri's development webview must connect to the same fixed HTTP URL as its
// `devUrl`. Browser development keeps the existing local HTTPS default.
const useHttp = !!process.env.RA2_HTTP || isTauriBuild;
const tauriBuildTarget = process.env.TAURI_ENV_PLATFORM === 'windows'
    ? 'chrome105'
    : isTauriBuild
        ? 'safari13'
        : undefined;
export default defineConfig({
    clearScreen: false,
    define: {
        __RA2_TAURI_BUILD__: JSON.stringify(isTauriBuild),
    },
    plugins: [react(), serveGameResDev(), serveE2eAssets(), syncSevenZipWasm(), syncFfmpegCore(), ...(manualHttpsConfig || useHttp ? [] : [basicSsl()])],
    server: {
        host: tauriDevHost || '0.0.0.0',
        port: devPort,
        strictPort: true,
        https: useHttp ? undefined : (manualHttpsConfig ?? {}),
        hmr: tauriDevHost
            ? { protocol: 'ws', host: tauriDevHost, port: devPort }
            : undefined,
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
        },
        fs: {
            allow: ['..']
        },
        watch: {
            ignored: ['**/src-tauri/**'],
        },
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
    build: {
        ...(tauriBuildTarget ? { target: tauriBuildTarget } : {}),
        ...(process.env.TAURI_ENV_DEBUG ? { minify: false, sourcemap: true } : {}),
    },
    assetsInclude: ['**/*.wasm']
});
