import { StorageKey } from '../LocalPrefs';
import { GameResSource } from '../engine/gameRes/GameResSource';
import { OperationCanceledError, type CancellationToken } from '@puzzl/core/lib/async/cancellation';
import { gamePathKey, normalizeGamePath } from '../engine/GamePath';
import type { ArchiveSource } from '../data/ArchiveSource';
import { importContentSourceToOpfs } from '../content/InstalledContentImporter';
import type { ContentImportKind, ContentImportProgress, ContentImportSource, PlatformContentProvider } from '../content/PlatformContentProvider';
import { BrowserContentProvider } from '../content/BrowserContentProvider';

declare global {
    interface Window {
        __RA2_SHELL__?: {
            platform: string;
            version: string;
            menuVideoRoot?: string;
            thermalState?: string;
        };
        Ra2Android?: {
            platformReady?: () => boolean;
            pickGameDirectory: () => boolean;
            pickModDirectory?: () => boolean;
            pickModArchives?: () => boolean;
            finishModImport?: () => boolean;
            deleteNativeModImport?: (token: string) => boolean;
            startModDownload?: (url: string, requestId: string) => boolean;
            cancelModDownload?: (requestId: string) => boolean;
            deleteModDownload?: (token: string) => boolean;
        };
        __RA2_NATIVE_GAME_RES_CALLBACK__?: (result: {
            success: boolean;
            error?: string;
        }) => void;
        __RA2_NATIVE_MOD_IMPORT_CALLBACK__?: (result: {
            success: boolean;
            event?: 'progress';
            token?: string;
            error?: string;
            copiedBytes?: number;
            totalBytes?: number;
            copiedFiles?: number;
            totalFiles?: number;
        }) => void;
        __RA2_NATIVE_MOD_DOWNLOAD_CALLBACK__?: (requestId: string, result: {
            success?: boolean;
            event?: string;
            progress?: number;
            total?: number;
            token?: string;
            url?: string;
            size?: number;
            cancelled?: boolean;
            error?: string;
        }) => void;
    }
}

export interface SeedManifest {
    files: { path: string; size: number }[];
}

const SEED_SENTINEL_FILE = '.ra2-shell-seed-sentinel.json';
const SEED_SENTINEL_VERSION = 1;
const USER_GAME_RES_ROOT = '/gameres';
const BUNDLED_GAME_RES_ROOT = '/gameres-bundle';

interface SeedSentinel {
    version: number;
    fingerprint: string;
}

function canonicalSeedManifest(manifest: SeedManifest): string {
    const files = [...manifest.files]
        .map(({ path, size }) => ({ path, size }))
        .sort((a, b) => a.path.localeCompare(b.path) || a.size - b.size);
    return JSON.stringify({ version: SEED_SENTINEL_VERSION, files });
}

export async function computeSeedFingerprint(manifest: SeedManifest): Promise<string> {
    const canonical = canonicalSeedManifest(manifest);
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle) {
        // The canonical form is small (the manifest contains metadata only)
        // and remains an exact, collision-free fallback on older WebViews.
        return `plain:${canonical}`;
    }
    const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function seedSentinelMatches(currentFingerprint: string | undefined, expectedFingerprint: string): boolean {
    return currentFingerprint === expectedFingerprint;
}

async function readSeedSentinel(root: FileSystemDirectoryHandle): Promise<string | undefined> {
    try {
        const sentinelFile = await root.getFileHandle(SEED_SENTINEL_FILE);
        const sentinel = JSON.parse(await (await sentinelFile.getFile()).text()) as Partial<SeedSentinel>;
        if (sentinel.version !== SEED_SENTINEL_VERSION || typeof sentinel.fingerprint !== 'string') {
            return undefined;
        }
        return sentinel.fingerprint;
    }
    catch {
        return undefined;
    }
}

async function writeSeedSentinel(root: FileSystemDirectoryHandle, fingerprint: string): Promise<void> {
    const sentinelFile = await root.getFileHandle(SEED_SENTINEL_FILE, { create: true });
    const writable = await sentinelFile.createWritable();
    await writable.write(JSON.stringify({
        version: SEED_SENTINEL_VERSION,
        fingerprint,
    } satisfies SeedSentinel));
    await writable.close();
}

async function seedManifestFilesMatch(root: FileSystemDirectoryHandle, manifest: SeedManifest): Promise<boolean> {
    for (const file of manifest.files) {
        let normalizedPath: string;
        try {
            normalizedPath = normalizeGamePath(file.path);
        }
        catch {
            return false;
        }
        const segments = normalizedPath.split('/');
        const fileName = segments.pop();
        if (!fileName) {
            return false;
        }
        try {
            let dir = root;
            for (const segment of segments) {
                dir = await dir.getDirectoryHandle(segment, { create: false });
            }
            const existing = await dir.getFileHandle(fileName, { create: false });
            if ((await existing.getFile()).size !== file.size) {
                return false;
            }
        }
        catch {
            return false;
        }
    }
    return true;
}

// The Android folder importer can copy an arbitrary directory tree, so a
// manifest alone is not proof that it contains a playable game. These are the
// implicit archives loaded by the YR engine before any menu can render.
const REQUIRED_RA2_GAME_FILES = [
    'language.mix',
    'multi.mix',
    'ra2.mix',
];

/**
 * Both debug channels below talk to a hardcoded dev host over plain HTTP: the
 * log mirror fires a fetch() per console call, and the REPL polls at 0.5 Hz for
 * the life of the process and eval()s whatever the LAN hands back. Neither may
 * survive into a build a player runs — quite apart from the eval, a forever
 * 0.5 Hz radio wakeup is ~20-70 mW of sustained average power that never lets
 * the Wi-Fi part reach its low-power state.
 *
 * Gate on build mode rather than an ambient env var, so no build path can
 * reship them by accident. Vite folds `import.meta.env.DEV` to `false` in a
 * production build, which lets rollup drop both function bodies (and the host
 * string literals with them, so grepping dist/ is a meaningful check).
 */
const DEBUG_NET_ALLOWED = !!(import.meta as any).env?.DEV
    || !!(import.meta as any).env?.VITE_DEBUG_NET_FORCE;

/**
 * Debug aid: mirrors console output to a dev machine over HTTP so native WebView
 * logs are visible without attaching Safari's inspector. Silently inert when
 * no dev receiver is listening.
 */
export function installShellDebugLog(): void {
    if (!isNativeShell() || !DEBUG_NET_ALLOWED)
        return;
    // Only active when a receiver host was baked in at build time. Without
    // this gate, release builds fire one fetch() per console call at an
    // unreachable host — thousands of in-flight Requests retaining their
    // body strings during boot and world build, in the process that gets
    // jetsam-killed first.
    const host = (import.meta as any).env?.VITE_DEBUG_LOG_HOST;
    if (!host)
        return;
    const endpoint = `http://${host}:4100/log`;
    const safeArg = (a: unknown): string => {
        if (a instanceof Error)
            return `${a.name}: ${a.message}\n${a.stack ?? '(no stack)'}`;
        if (a === null || a === undefined)
            return String(a);
        if (typeof a !== 'object')
            return String(a).slice(0, 2000);
        // Never serialize binary blobs or huge structures over the wire.
        if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer)
            return `[binary ${(a as any).byteLength ?? '?'}b]`;
        try {
            return JSON.stringify(a).slice(0, 2000);
        }
        catch {
            return Object.prototype.toString.call(a);
        }
    };
    const post = (level: string, args: unknown[]) => {
        try {
            const text = args.map(safeArg).join(' ').slice(0, 4000);
            void fetch(endpoint, { method: 'POST', body: `[${level}] ${text}` }).catch(() => { });
        }
        catch { }
    };
    for (const level of ['log', 'warn', 'error'] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            original(...args);
            post(level, args);
        };
    }
    window.addEventListener('error', (e) => post('uncaught', [e.message, e.filename, e.lineno, (e.error?.stack ?? '')]));
    window.addEventListener('unhandledrejection', (e) => post('unhandledrejection', [e.reason]));
}

/**
 * Debug aid (VITE_DEBUG_REPL=1 builds only): polls the dev receiver for JS
 * snippets, evals them in page context and posts the result back. Gives a
 * full REPL into native WebView builds (emulator or device) where no console
 * input channel exists. Inert unless the build flag is set AND a receiver
 * is listening.
 */
export function installShellRepl(): void {
    if (!isNativeShell() || !DEBUG_NET_ALLOWED)
        return;
    if (!(import.meta as any).env?.VITE_DEBUG_REPL)
        return;
    const host = (import.meta as any).env?.VITE_DEBUG_LOG_HOST || '127.0.0.1';
    console.log(`[repl] polling http://${host}:4100/cmd`);
    let logged = false;
    const poll = async () => {
        try {
            // POST, not GET: some embedded WebViews handle the two paths
            // differently while identical POSTs (the /log channel) go through.
            const response = await fetch(`http://${host}:4100/cmd`, { method: 'POST', body: 'poll' });
            if (!logged) {
                logged = true;
                console.log(`[repl] first poll status ${response.status}`);
            }
            if (response.status === 200) {
                const { id, code } = await response.json();
                let result: string;
                try {
                    // eslint-disable-next-line no-eval
                    result = String(await (0, eval)(code));
                }
                catch (error: any) {
                    result = `EVALERR: ${error?.message ?? error}\n${error?.stack ?? ''}`;
                }
                await fetch(`http://${host}:4100/result?id=${encodeURIComponent(id)}`, {
                    method: 'POST',
                    body: result.slice(0, 500000),
                }).catch(() => { });
            }
        }
        catch (error: any) {
            if (!logged) {
                logged = true;
                console.warn(`[repl] poll failed: ${error?.message ?? error}`);
            }
        }
        setTimeout(poll, 2000);
    };
    poll();
}

/**
 * Android can identify the shell with URL parameters because its WebView
 * bootstrap runs after the document has been created. iOS still injects the
 * object at document start, so both native shells expose the same contract.
 */
function ensureShellMarker(): void {
    if (window.__RA2_SHELL__)
        return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('shell'))
        return;
    const platform = params.get('platform') || 'native';
    const requestedMenuVideoRoot = params.get('menuVideoRoot');
    const menuVideoRoot = requestedMenuVideoRoot === '/native-media/android/menu-video' ||
        requestedMenuVideoRoot === '/native-media/ios/menu-video'
        ? requestedMenuVideoRoot
        : platform === 'android'
            ? '/native-media/android/menu-video'
            : platform === 'ios'
                ? '/native-media/ios/menu-video'
                : undefined;
    window.__RA2_SHELL__ = {
        platform,
        version: params.get('shellVersion') || '0.1.0',
        ...(menuVideoRoot ? { menuVideoRoot } : {}),
    };
}

function nativeMenuVideoUrl(filename: string): string | undefined {
    ensureShellMarker();
    if (!/^[A-Za-z0-9._-]+\.bik$/i.test(filename)) {
        return undefined;
    }
    const root = window.__RA2_SHELL__?.menuVideoRoot;
    if (!root) {
        return undefined;
    }
    return new URL(`${root}/${encodeURIComponent(filename)}`, window.location.href).toString();
}

/**
 * Ask the current native shell whether it has a platform-owned Bink file.
 * Android and iOS deliberately use different native URL roots; if neither
 * shell has a loose Bink file, the caller falls back to the shared OPFS/VFS
 * import path, which extracts it from language*.mix.
 */
export async function selectNativeMenuVideoSource(filenames: readonly string[]): Promise<string | undefined> {
    for (const filename of filenames) {
        const url = nativeMenuVideoUrl(filename);
        if (!url) {
            return undefined;
        }
        try {
            const response = await fetch(`${url}?probe=1`, { cache: 'no-store' });
            if (response.ok) {
                return url;
            }
        }
        catch (error) {
            console.debug(`[nativeShell] Native menu video probe failed for ${filename}`, error);
        }
    }
    return undefined;
}

export function isNativeShell(): boolean {
    ensureShellMarker();
    // The query flag also lets a desktop browser exercise the native code path.
    return !!window.__RA2_SHELL__;
}

export function isTauriDesktopShell(): boolean {
    const buildFlag = typeof __RA2_TAURI_BUILD__ !== 'undefined' && __RA2_TAURI_BUILD__;
    if (typeof window === 'undefined') {
        return buildFlag;
    }
    const location = window.location;
    return buildFlag
        || location.protocol === 'tauri:'
        || location.hostname === 'tauri.localhost'
        || !!(window as any).__TAURI_INTERNALS__;
}

function nativeGameResRoot(): string {
    if (typeof window !== 'undefined' &&
        (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
        // Wry exposes custom protocols as http(s)://<scheme>.localhost on
        // Windows and Android. Linux and macOS retain scheme://localhost.
        return 'http://gameres.localhost';
    }
    return 'gameres://localhost';
}

async function pickTauriGameDirectory(): Promise<boolean> {
    const [{ open }, { invoke }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/api/core'),
    ]);
    const selected = await open({
        directory: true,
        multiple: false,
        recursive: true,
        title: "Select your Red Alert 2 / Yuri's Revenge folder",
    });
    const sourcePath = Array.isArray(selected) ? selected[0] : selected;
    if (typeof sourcePath !== 'string' || !sourcePath) {
        return false;
    }
    const result = await invoke<{ fileCount: number; totalBytes: number }>('import_game_directory', {
        sourcePath,
    });
    console.info(`[nativeShell] Imported ${result.fileCount} game files (${result.totalBytes} bytes) from the selected desktop folder`);
    return true;
}

export function canPickGameDirectoryFromShell(): boolean {
    ensureShellMarker();
    return isTauriDesktopShell()
        || (window.__RA2_SHELL__?.platform === 'android'
            && typeof window.Ra2Android?.pickGameDirectory === 'function');
}

export function pickGameDirectoryFromShell(): Promise<boolean> {
    if (isTauriDesktopShell()) {
        return pickTauriGameDirectory();
    }
    if (!canPickGameDirectoryFromShell())
        return Promise.resolve(false);
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (result: { success: boolean; error?: string }) => {
            if (settled)
                return;
            settled = true;
            window.__RA2_NATIVE_GAME_RES_CALLBACK__ = undefined;
            if (result.success)
                resolve(true);
            else if (result.error)
                reject(new Error(result.error));
            else
                resolve(false);
        };
        window.__RA2_NATIVE_GAME_RES_CALLBACK__ = finish;
        try {
            if (!window.Ra2Android!.pickGameDirectory())
                finish({ success: false });
        }
        catch (error) {
            finish({ success: false, error: String(error) });
        }
    });
}

interface NativeModImportFile {
    path: string;
    size: number;
}

export interface NativeModImportResult {
    id: string;
    name: string;
    version: string;
}

interface TauriModImportResult {
    token: string;
    sourceName: string;
    files: { path: string; size: number }[];
}

function canImportNativeModFromShell(): boolean {
    ensureShellMarker();
    return window.__RA2_SHELL__?.platform === 'android'
        && (typeof window.Ra2Android?.pickModDirectory === 'function'
            || typeof window.Ra2Android?.pickModArchives === 'function');
}

export function canImportModFromShell(): boolean {
    return canImportNativeModFromShell() || isTauriDesktopShell() || BrowserContentProvider.isAvailable();
}

async function pickTauriModSource(
    kind: ContentImportKind,
    multiple: boolean,
    onProgress?: ContentImportProgress,
): Promise<ContentImportSource | undefined> {
    const [{ open }, { invoke }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/api/core'),
    ]);
    const selected = await open(kind === 'directory'
        ? {
            directory: true,
            multiple: false,
            recursive: true,
            title: 'Select an extracted mod folder',
        }
        : {
            directory: false,
            multiple,
            filters: [{ name: 'Mod ZIP archives', extensions: ['zip'] }],
            title: 'Select mod ZIP archive(s)',
        });
    const sourcePaths = (Array.isArray(selected) ? selected : selected ? [selected] : [])
        .filter((path): path is string => typeof path === 'string' && path.length > 0);
    if (!sourcePaths.length) {
        return undefined;
    }
    onProgress?.(kind === 'directory' ? 'Preparing mod folder...' : 'Extracting mod ZIP archive...');
    const result = await invoke<TauriModImportResult>('import_mod_source', {
        sourcePaths,
        sourceKind: kind,
    });
    if (!result?.token || !Array.isArray(result.files) || !result.files.length) {
        throw new Error('The desktop mod importer returned no readable files');
    }
    const files = result.files.map((file) => ({
        path: normalizeGamePath(file.path),
        size: Number(file.size) || 0,
    }));
    const baseUrl = `modres://localhost/${encodeURIComponent(result.token)}`;
    let disposed = false;
    return {
        kind,
        name: result.sourceName || undefined,
        files,
        async readFile(path: string): Promise<ReadableStream<Uint8Array>> {
            const normalizedPath = normalizeGamePath(path);
            const response = await fetch(
                `${baseUrl}/${normalizedPath.split('/').map(encodeURIComponent).join('/')}`,
                { cache: 'no-store' },
            );
            if (!response.ok || !response.body) {
                throw new Error(`Desktop mod file could not be read (${normalizedPath})`);
            }
            return response.body;
        },
        async dispose(): Promise<void> {
            if (disposed) {
                return;
            }
            disposed = true;
            try {
                await invoke('delete_mod_import', { token: result.token });
            }
            catch (error) {
                console.warn('[nativeShell] Could not clean up desktop mod import', error);
            }
        },
    };
}

async function pickNativeModSource(
    kind: ContentImportKind,
    picker: (() => boolean) | undefined,
    onProgress?: ContentImportProgress,
): Promise<ContentImportSource | undefined> {
    if (!picker || !canImportNativeModFromShell()) {
        return undefined;
    }
    const nativeApi = window.Ra2Android!;
    const result = await new Promise<{ success: boolean; token?: string; error?: string }>((resolve) => {
        let settled = false;
        const finish = (value: {
            success: boolean;
            event?: 'progress';
            token?: string;
            error?: string;
            copiedBytes?: number;
            totalBytes?: number;
            copiedFiles?: number;
            totalFiles?: number;
        }) => {
            if (value.event === 'progress') {
                const copiedBytes = Number(value.copiedBytes) || 0;
                const totalBytes = Number(value.totalBytes) || 0;
                const copiedFiles = Number(value.copiedFiles) || 0;
                const totalFiles = Number(value.totalFiles) || 0;
                const copiedMb = (copiedBytes / 1048576).toFixed(0);
                const totalMb = (totalBytes / 1048576).toFixed(0);
                const amount = totalBytes > 0 ? `${copiedMb} / ${totalMb} MB` : `${copiedMb} MB`;
                const files = totalFiles > 0 ? ` (${copiedFiles} / ${totalFiles} files)` : ` (${copiedFiles} files)`;
                onProgress?.(`Copying mod files... ${amount}${files}`);
                return;
            }
            if (settled)
                return;
            settled = true;
            window.__RA2_NATIVE_MOD_IMPORT_CALLBACK__ = undefined;
            resolve(value);
        };
        window.__RA2_NATIVE_MOD_IMPORT_CALLBACK__ = finish;
        try {
            if (!picker())
                finish({ success: false });
        }
        catch (error: any) {
            finish({ success: false, error: String(error) });
        }
    });
    if (!result.success || !result.token) {
        nativeApi.finishModImport?.();
        if (result.error)
            throw new Error(result.error);
        return undefined;
    }

    const token = result.token;
    let manifestResponse: Response;
    try {
        manifestResponse = await fetch(`/native-mod-imports/${encodeURIComponent(token)}/manifest.json`, {
            cache: 'no-store',
        });
    }
    catch (error) {
        nativeApi.deleteNativeModImport?.(token);
        nativeApi.finishModImport?.();
        throw error;
    }
    if (!manifestResponse.ok) {
        nativeApi.deleteNativeModImport?.(token);
        nativeApi.finishModImport?.();
        throw new Error(`Native mod manifest could not be read (${manifestResponse.status})`);
    }
    let manifest: { files?: NativeModImportFile[]; sourceName?: string };
    let files: NativeModImportFile[];
    const originalPathByKey = new Map<string, string>();
    try {
        manifest = await manifestResponse.json() as {
            files?: NativeModImportFile[];
            sourceName?: string;
        };
        files = Array.isArray(manifest.files) ? manifest.files : [];
        if (!files.length) {
            throw new Error('The selected mod content contains no readable files');
        }
        for (const file of files) {
            const normalizedPath = normalizeGamePath(file.path);
            const key = gamePathKey(normalizedPath);
            if (originalPathByKey.has(key)) {
                throw new Error(`Native mod manifest contains duplicate path: ${file.path}`);
            }
            originalPathByKey.set(key, file.path);
        }
    }
    catch (error) {
        nativeApi.deleteNativeModImport?.(token);
        nativeApi.finishModImport?.();
        throw error;
    }
    // Keep the temporary native directory until the OPFS import finishes so
    // a killed WebView can be retried from the same handoff.
    let disposed = false;
    return {
        kind,
        name: typeof manifest.sourceName === 'string' && manifest.sourceName.trim()
            ? manifest.sourceName.trim()
            : undefined,
        files,
        async readFile(path: string): Promise<ReadableStream<Uint8Array>> {
            const normalizedPath = normalizeGamePath(path);
            const sourcePath = originalPathByKey.get(gamePathKey(normalizedPath)) ?? normalizedPath;
            const response = await fetch(
                `/native-mod-imports/${encodeURIComponent(token)}/${sourcePath.split('/').map(encodeURIComponent).join('/')}`,
                { cache: 'no-store' },
            );
            if (!response.ok || !response.body) {
                throw new Error(`Native mod file could not be read (${sourcePath})`);
            }
            return response.body;
        },
        dispose(): void {
            if (disposed)
                return;
            disposed = true;
            nativeApi.deleteNativeModImport?.(token);
        },
    };
}

/** Shared content-picker boundary implemented by each platform shell/browser. */
export function getPlatformContentProvider(): PlatformContentProvider | undefined {
    if (canImportNativeModFromShell()) {
        const nativeApi = window.Ra2Android!;
        return {
            // Android's base-game picker still commits directly through the
            // shell because it owns the SAF permission and persistent root.
            // Keep the bridge call bound to the injected object. Android
            // WebView rejects a JavaScript bridge method invoked detached
            // from its injected receiver as a non-injected object.
            pickModDirectory: (onProgress) => pickNativeModSource(
                'directory',
                () => nativeApi.pickModDirectory?.() ?? false,
                onProgress,
            ),
            pickModArchives: (options = {}) => pickNativeModSource(
                'archives',
                () => nativeApi.pickModArchives?.() ?? false,
                options.onProgress,
            ),
        };
    }
    if (isTauriDesktopShell()) {
        return {
            pickModDirectory: (onProgress) => pickTauriModSource('directory', false, onProgress),
            pickModArchives: (options = {}) => pickTauriModSource(
                'archives',
                options.multiple !== false,
                options.onProgress,
            ),
        };
    }
    return BrowserContentProvider.isAvailable()
        ? new BrowserContentProvider()
        : undefined;
}

/**
 * Imports an extracted mod folder selected by Android's Storage Access
 * Framework. ZIP archive selection remains available as a fallback for
 * installations that have not been extracted. The resulting files are
 * streamed into the same OPFS mod directory used by the desktop importer.
 */
export async function importModFromShell(
    requestedId?: string,
    onProgress?: (text: string) => void,
    requestedKind: 'auto' | ContentImportKind = 'auto',
): Promise<NativeModImportResult | undefined> {
    const provider = getPlatformContentProvider();
    if (!provider)
        return undefined;
    const source = await (canImportNativeModFromShell()
        ? (requestedKind === 'archives' && typeof window.Ra2Android?.pickModArchives === 'function'
            ? provider.pickModArchives({ multiple: true, onProgress })
            : typeof window.Ra2Android?.pickModDirectory === 'function'
                ? provider.pickModDirectory(onProgress)
                : provider.pickModArchives({ multiple: true, onProgress }))
        : isTauriDesktopShell()
            ? (requestedKind === 'directory'
                ? provider.pickModDirectory(onProgress)
                : provider.pickModArchives({ multiple: true, onProgress }))
            : provider.pickModArchives({ multiple: true, onProgress }));
    if (!source) {
        window.Ra2Android?.finishModImport?.();
        return undefined;
    }
    try {
        const imported = await importContentSourceToOpfs(source, requestedId, onProgress);
        return { id: imported.id, name: imported.name, version: imported.version };
    }
    finally {
        await source.dispose();
        // Native Android keeps a foreground notification alive through the
        // WebView's OPFS copy as well as its SAF copy. This prevents a
        // successful native handoff from looking finished while the actual
        // mod is still being written.
        window.Ra2Android?.finishModImport?.();
    }
}

interface NativeModDownloadResult {
    success?: boolean;
    event?: string;
    progress?: number;
    total?: number;
    token?: string;
    url?: string;
    size?: number;
    cancelled?: boolean;
    error?: string;
}

interface NativeModDownloadHandler {
    onProgress?: (progress: number) => void;
    resolve: (result: NativeModDownloadResult) => void;
    reject: (error: Error) => void;
}

const nativeModDownloadHandlers = new Map<string, NativeModDownloadHandler>();
let nativeModDownloadDispatcherInstalled = false;

function installNativeModDownloadDispatcher(): void {
    if (nativeModDownloadDispatcherInstalled)
        return;
    nativeModDownloadDispatcherInstalled = true;
    window.__RA2_NATIVE_MOD_DOWNLOAD_CALLBACK__ = (requestId, result) => {
        const handler = nativeModDownloadHandlers.get(requestId);
        if (!handler)
            return;
        if (result.event === 'progress' || result.progress !== undefined) {
            const total = result.total ?? 0;
            const progress = total > 0
                ? Math.floor(Math.min(1, result.progress! / total) * 100)
                : 0;
            handler.onProgress?.(progress);
            return;
        }
        nativeModDownloadHandlers.delete(requestId);
        handler.resolve(result);
    };
}

export function canDownloadModFromShell(): boolean {
    ensureShellMarker();
    return window.__RA2_SHELL__?.platform === 'android'
        && typeof window.Ra2Android?.startModDownload === 'function';
}

/**
 * Android's WebView cannot read many community mod hosts because their
 * archives omit CORS headers. Ask the shell to download the archive natively,
 * then expose its same-origin response stream to the shared 7-Zip importer.
 * Archive bytes never cross the bridge as base64 or as a retained JS chunk
 * array.
 *
 * Returns undefined when the current shell has no native downloader, allowing
 * callers to use their normal browser fetch path.
 */
export function downloadModFromShell(
    url: string,
    fileName: string,
    cancellationToken?: CancellationToken,
    onProgress?: (progress: number) => void,
): Promise<ArchiveSource> | undefined {
    if (!canDownloadModFromShell())
        return undefined;
    installNativeModDownloadDispatcher();
    const requestId = `mod-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nativeApi = window.Ra2Android!;
    let started = false;
    let cancelPromise: ((error: Error) => void) | undefined;
    const promise = new Promise<ArchiveSource>((resolve, reject) => {
        cancelPromise = reject;
        const handler: NativeModDownloadHandler = {
            onProgress,
            resolve: (result) => {
                if (!result.success || !result.token) {
                    reject(result.cancelled
                        ? new OperationCanceledError(cancellationToken as CancellationToken)
                        : new Error(result.error || 'Native mod download failed'));
                    return;
                }
                void (async () => {
                    try {
                        if (!result.url || !result.size) {
                            throw new Error('Native mod download returned no readable archive URL');
                        }
                        cancellationToken?.throwIfCancelled();
                        const response = await fetch(result.url, { cache: 'no-store' });
                        if (!response.ok || !response.body) {
                            throw new Error(`Native mod download stream failed (${response.status})`);
                        }
                        let disposed = false;
                        const dispose = () => {
                            if (!disposed) {
                                disposed = true;
                                nativeApi.deleteModDownload?.(result.token!);
                            }
                        };
                        resolve({
                            name: fileName || 'mod-archive',
                            size: result.size,
                            // The response body is consumed directly by the
                            // 7-Zip importer. No base64, chunk array, or
                            // duplicate File/Blob is created in the WebView.
                            stream: () => response.body!,
                            dispose,
                        });
                    }
                    catch (error: any) {
                        nativeApi.deleteModDownload?.(result.token!);
                        reject(error instanceof Error ? error : new Error(String(error)));
                    }
                })();
            },
            reject,
        };
        nativeModDownloadHandlers.set(requestId, handler);
        try {
            started = !!nativeApi.startModDownload!(url, requestId);
        }
        catch (error: any) {
            nativeModDownloadHandlers.delete(requestId);
            reject(error instanceof Error ? error : new Error(String(error)));
        }
        if (!started) {
            nativeModDownloadHandlers.delete(requestId);
        }
    });
    if (!started)
        return undefined;
    cancellationToken?.register(() => {
        if (!nativeModDownloadHandlers.has(requestId))
            return;
        nativeModDownloadHandlers.delete(requestId);
        nativeApi.cancelModDownload?.(requestId);
        cancelPromise?.(new OperationCanceledError(cancellationToken as CancellationToken));
    });
    return promise;
}

/**
 * First-launch bootstrap for a native shell: copies the shell's game-resource
 * mount into origin-private storage,
 * then marks the import as complete exactly like GameResImporter would.
 *
 * No-op outside the shell, or once storage is already seeded.
 */
export async function seedGameResFromShell(): Promise<void> {
    const tauriDesktop = isTauriDesktopShell();
    if (!isNativeShell() && !tauriDesktop)
        return;
    const seedRoots = tauriDesktop
        ? [nativeGameResRoot()]
        : [USER_GAME_RES_ROOT, BUNDLED_GAME_RES_ROOT];
    let seedRoot: string | undefined;
    for (const candidate of seedRoots) {
        const probe = await fetch(`${candidate}/manifest.json`, { cache: 'no-store' });
        if (probe.ok) {
            seedRoot = candidate;
            break;
        }
        if (probe.status !== 404) {
            throw new Error(`Shell game-resource manifest failed (${probe.status})`);
        }
    }
    if (!seedRoot) {
        console.info('[nativeShell] No user or bundled game-resource mount; continuing with normal resource selection');
        return;
    }
    // Never trust the localStorage flag alone: an OS can purge origin storage
    // under disk pressure while localStorage survives, or vice versa. The seed
    // itself verifies per-file sizes and only copies what is missing or stale,
    // so running it on every launch is cheap and self-healing.
    let overlay: ReturnType<typeof createSeedOverlay> | undefined;
    let wroteFiles = 0;
    try {
        wroteFiles = await runSeed(seedRoot, (text) => {
            overlay ??= createSeedOverlay();
            overlay.setText(text);
        });
    }
    finally {
        overlay?.remove();
    }
    // Copying ~750MB into OPFS leaves the content process at a memory
    // high-water mark that the first game load can push over the WebView
    // renderer limit. After a real
    // first-time seed, reload once up front so the process starts the session
    // clean instead of dying mid game-load.
    if (wroteFiles > 0 && !sessionStorage.getItem('shellSeedReloaded')) {
        sessionStorage.setItem('shellSeedReloaded', '1');
        console.log(`[nativeShell] Fresh seed wrote ${wroteFiles} files; reloading once to reset memory high-water`);
        window.location.reload();
        // Halt boot; the reload takes over.
        await new Promise(() => { });
    }
}

function createSeedOverlay(): { setText: (text: string) => void; remove: () => void } {
    const el = document.createElement('div');
    el.style.cssText =
        'position:fixed;inset:0;background:#000;color:#c00;display:flex;' +
        'align-items:center;justify-content:center;z-index:99999;' +
        'font:16px monospace;text-align:center;';
    el.textContent = 'Preparing game files...';
    document.body.appendChild(el);
    return {
        setText: (text) => { el.textContent = text; },
        remove: () => el.remove(),
    };
}

async function runSeed(seedRoot: string, onProgress: (text: string) => void): Promise<number> {
    const manifestResponse = await fetch(`${seedRoot}/manifest.json`, { cache: 'no-store' });
    if (!manifestResponse.ok) {
        // A shell build may intentionally omit retail resources. Let the
        // normal GameRes flow render its import/CDN chooser rather than
        // aborting Application.main() before the UI exists.
        if (manifestResponse.status === 404) {
            console.info(`[nativeShell] No game-resource mount at ${seedRoot}; continuing with normal resource selection`);
            return 0;
        }
        throw new Error(`Shell seed manifest missing (${manifestResponse.status})`);
    }
    const manifest: SeedManifest = await manifestResponse.json();
    const fingerprint = await computeSeedFingerprint(manifest);
    const manifestPaths = new Set(manifest.files.map((file) => {
        try {
            return gamePathKey(file.path);
        }
        catch {
            return '';
        }
    }));
    const missingRequiredFiles = REQUIRED_RA2_GAME_FILES.filter((file) => !manifestPaths.has(gamePathKey(file)));
    if (missingRequiredFiles.length > 0) {
        console.warn(
            '[nativeShell] Resource import is incomplete for the RA2-family base; ' +
            `missing ${missingRequiredFiles.join(', ')}. The game-resource chooser will remain available.`,
        );
        localStorage.removeItem(StorageKey.GameRes);
    }
    else {
        console.info('[nativeShell] Base resources are available; content will be selected from Menu -> Mods');
    }
    const totalBytes = manifest.files.reduce((sum, f) => sum + f.size, 0);
    let copiedBytes = 0;
    let wroteFiles = 0;
    if (typeof navigator.storage?.getDirectory !== 'function') {
        throw new Error('Native shell requires Origin Private File System support to seed game resources');
    }
    const root = await navigator.storage.getDirectory();
    const currentFingerprint = await readSeedSentinel(root);
    if (seedSentinelMatches(currentFingerprint, fingerprint) && await seedManifestFilesMatch(root, manifest)) {
        console.info('[nativeShell] Game-resource bundle is already seeded; skipping resource copy');
        return 0;
    }
    for (const file of manifest.files) {
        let normalizedPath: string;
        try {
            normalizedPath = normalizeGamePath(file.path);
        }
        catch {
            throw new Error(`Unsafe bundled game-resource path: ${file.path}`);
        }
        const segments = normalizedPath.split('/');
        const fileName = segments.pop()!;
        let dir = root;
        for (const segment of segments) {
            dir = await dir.getDirectoryHandle(segment, { create: true });
        }
        const existing = await dir
            .getFileHandle(fileName)
            .then((h) => h.getFile())
            .catch(() => undefined);
        if (existing && existing.size === file.size) {
            copiedBytes += file.size;
            continue;
        }
        const response = await fetch(`${seedRoot}/${normalizedPath}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch native game resource "${normalizedPath}" (${response.status})`);
        }
        if (!response.body) {
            throw new Error(`Native game resource "${normalizedPath}" returned an empty response body`);
        }
        const handle = await dir.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await response.body!.pipeTo(writable);
        copiedBytes += file.size;
        wroteFiles++;
        onProgress(
            `Preparing game files... ${(copiedBytes / 1048576).toFixed(0)} / ${(totalBytes / 1048576).toFixed(0)} MB`,
        );
    }
    if (missingRequiredFiles.length === 0) {
        const config = String(GameResSource.Local);
        localStorage.setItem(StorageKey.GameRes, config);
    }
    try {
        await writeSeedSentinel(root, fingerprint);
    }
    catch (error) {
        // The sentinel only avoids future validation walks. A metadata write
        // failure must not discard a successfully copied resource bundle;
        // without a readable sentinel the next launch safely repairs it.
        console.warn('[nativeShell] Could not persist game-resource seed sentinel', error);
    }
    console.log(`[nativeShell] Seeded ${manifest.files.length} files (${totalBytes} bytes, ${wroteFiles} written) from ${seedRoot}`);
    return wroteFiles;
}
