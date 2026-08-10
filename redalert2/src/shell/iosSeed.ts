import { StorageKey } from '../LocalPrefs';
import { GameResSource } from '../engine/gameRes/GameResSource';
import { OperationCanceledError, type CancellationToken } from '@puzzl/core/lib/async/cancellation';

declare global {
    interface Window {
        __RA2_SHELL__?: {
            platform: string;
            version: string;
            engine?: 'ra2' | 'yr';
            thermalState?: string;
        };
        Ra2Android?: {
            pickGameDirectory: () => boolean;
            pickModDirectory?: () => boolean;
            pickModArchives?: () => boolean;
            deleteNativeModImport?: (token: string) => boolean;
            startModDownload?: (url: string, requestId: string) => boolean;
            cancelModDownload?: (requestId: string) => boolean;
            deleteModDownload?: (token: string) => boolean;
            readModDownloadChunk?: (token: string, offset: number, length: number) => string;
        };
        __RA2_NATIVE_GAME_RES_CALLBACK__?: (result: {
            success: boolean;
            error?: string;
        }) => void;
        __RA2_NATIVE_MOD_IMPORT_CALLBACK__?: (result: {
            success: boolean;
            token?: string;
            error?: string;
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

interface SeedManifest {
    files: { path: string; size: number }[];
}

// The Android folder importer can copy an arbitrary directory tree, so a
// manifest alone is not proof that it contains a playable game. These are the
// implicit archives loaded by the YR engine before any menu can render.
const REQUIRED_RA2_GAME_FILES = [
    'language.mix',
    'multi.mix',
    'ra2.mix',
];
const OPTIONAL_YR_GAME_FILES = [
    'langmd.mix',
    'multimd.mix',
    'ra2md.mix',
];
const NATIVE_ENGINE_STORAGE_KEY = '_ra2_native_engine';

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
    window.__RA2_SHELL__ = {
        platform: params.get('platform') || 'native',
        version: params.get('shellVersion') || '0.1.0',
        ...(params.get('engine') === 'ra2' || params.get('engine') === 'yr'
            ? { engine: params.get('engine') as 'ra2' | 'yr' }
            : {}),
    };
}

export function isNativeShell(): boolean {
    ensureShellMarker();
    // The query flag also lets a desktop browser exercise the native code path.
    return !!window.__RA2_SHELL__;
}

export function getNativeShellEngine(): 'ra2' | 'yr' | undefined {
    ensureShellMarker();
    return window.__RA2_SHELL__?.engine;
}

export function canPickGameDirectoryFromShell(): boolean {
    ensureShellMarker();
    return window.__RA2_SHELL__?.platform === 'android'
        && typeof window.Ra2Android?.pickGameDirectory === 'function';
}

export function pickGameDirectoryFromShell(): Promise<boolean> {
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

interface NativeModImportResult {
    id: string;
    name: string;
    version: string;
}

export function canImportModFromShell(): boolean {
    ensureShellMarker();
    return window.__RA2_SHELL__?.platform === 'android'
        && getNativeShellEngine() === 'yr'
        && (typeof window.Ra2Android?.pickModDirectory === 'function'
            || typeof window.Ra2Android?.pickModArchives === 'function');
}

/**
 * Imports an extracted mod folder selected by Android's Storage Access
 * Framework. ZIP archive selection remains available as a fallback for
 * installations that have not been extracted. The resulting files are
 * streamed into the same OPFS mod directory used by the desktop importer.
 */
export async function importModFromShell(
    modId: string,
    onProgress?: (text: string) => void,
): Promise<NativeModImportResult | undefined> {
    if (!canImportModFromShell())
        return undefined;
    const nativeApi = window.Ra2Android!;
    const result = await new Promise<{ success: boolean; token?: string; error?: string }>((resolve) => {
        let settled = false;
        const finish = (value: { success: boolean; token?: string; error?: string }) => {
            if (settled)
                return;
            settled = true;
            window.__RA2_NATIVE_MOD_IMPORT_CALLBACK__ = undefined;
            resolve(value);
        };
        window.__RA2_NATIVE_MOD_IMPORT_CALLBACK__ = finish;
        try {
            const picker = nativeApi.pickModDirectory ?? nativeApi.pickModArchives;
            if (!picker || !picker())
                finish({ success: false });
        }
        catch (error: any) {
            finish({ success: false, error: String(error) });
        }
    });
    if (!result.success || !result.token) {
        if (result.error)
            throw new Error(result.error);
        return undefined;
    }

    const token = result.token;
    try {
        const manifestResponse = await fetch(`/native-mod-imports/${encodeURIComponent(token)}/manifest.json`, {
            cache: 'no-store',
        });
        if (!manifestResponse.ok)
            throw new Error(`Native mod manifest could not be read (${manifestResponse.status})`);
        const manifest = await manifestResponse.json() as { files?: NativeModImportFile[] };
        const files = Array.isArray(manifest.files) ? manifest.files : [];
        if (!files.length)
            throw new Error('The selected mod folder contains no root game files');

        if (typeof navigator.storage?.getDirectory !== 'function')
            throw new Error('Android OPFS storage is unavailable');
        const root = await navigator.storage.getDirectory();
        const modsDir = await root.getDirectoryHandle('mods', { create: true });
        const modDir = await modsDir.getDirectoryHandle(modId, { create: true });
        for await (const entry of modDir.keys()) {
            await modDir.removeEntry(entry, { recursive: true });
        }

        const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
        let copiedBytes = 0;
        for (const file of files) {
            const response = await fetch(
                `/native-mod-imports/${encodeURIComponent(token)}/${encodeURIComponent(file.path)}`,
                { cache: 'no-store' },
            );
            if (!response.ok || !response.body)
                throw new Error(`Native mod file could not be read (${file.path})`);
            const fileHandle = await modDir.getFileHandle(file.path, { create: true });
            const writable = await fileHandle.createWritable();
            try {
                await response.body.pipeTo(writable);
            }
            catch (error) {
                await writable.abort();
                throw error;
            }
            copiedBytes += file.size;
            onProgress?.(`Preparing Mental Omega... ${(copiedBytes / 1048576).toFixed(0)} / ${(totalBytes / 1048576).toFixed(0)} MB`);
        }

        const metadata = [
            '[General]',
            `ID=${modId}`,
            'Name=Mental Omega 3.3.6',
            'Version=3.3.6',
            'Author=Mental Omega team',
            'Website=https://mentalomega.com/',
            '',
        ].join('\n');
        const metaHandle = await modDir.getFileHandle('modcd.ini', { create: true });
        const metaWritable = await metaHandle.createWritable();
        await metaWritable.write(metadata);
        await metaWritable.close();
        nativeApi.deleteNativeModImport?.(token);
        return { id: modId, name: 'Mental Omega 3.3.6', version: '3.3.6' };
    }
    catch (error) {
        nativeApi.deleteNativeModImport?.(token);
        throw error;
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
 * then read it back in bounded chunks so the existing JS importer and 7-Zip
 * path remain shared with desktop/iOS.
 *
 * Returns undefined when the current shell has no native downloader, allowing
 * callers to use their normal browser fetch path.
 */
export function downloadModFromShell(
    url: string,
    fileName: string,
    cancellationToken?: CancellationToken,
    onProgress?: (progress: number) => void,
): Promise<File> | undefined {
    if (!canDownloadModFromShell())
        return undefined;
    installNativeModDownloadDispatcher();
    const requestId = `mod-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nativeApi = window.Ra2Android!;
    let started = false;
    let cancelPromise: ((error: Error) => void) | undefined;
    const promise = new Promise<File>((resolve, reject) => {
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
                        const totalSize = result.size ?? 0;
                        if (!totalSize || typeof nativeApi.readModDownloadChunk !== 'function') {
                            throw new Error('Native mod download returned no readable archive');
                        }
                        const chunkSize = 256 * 1024;
                        const chunks: Uint8Array[] = [];
                        let offset = 0;
                        while (offset < totalSize) {
                            cancellationToken?.throwIfCancelled();
                            const encoded = nativeApi.readModDownloadChunk(result.token!, offset, chunkSize);
                            if (!encoded)
                                throw new Error('Native mod download ended before all bytes were read');
                            const binary = atob(encoded);
                            const chunk = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++)
                                chunk[i] = binary.charCodeAt(i);
                            chunks.push(chunk);
                            offset += chunk.length;
                            onProgress?.(Math.floor(Math.min(1, offset / totalSize) * 100));
                            // Give the WebView event loop a turn between Binder
                            // reads so cancellation and rendering remain live.
                            await Promise.resolve();
                        }
                        nativeApi.deleteModDownload?.(result.token!);
                        resolve(new File(chunks as unknown as BlobPart[], fileName || 'mod-archive', {
                            type: 'application/octet-stream',
                        }));
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
 * First-launch bootstrap for the native shell: copies the bundled, pre-imported
 * game resources (served by the shell at /gameres/) into origin-private storage,
 * then marks the import as complete exactly like GameResImporter would.
 *
 * No-op outside the shell, or once storage is already seeded.
 */
export async function seedGameResFromShell(): Promise<void> {
    if (!isNativeShell())
        return;
    // Never trust the localStorage flag alone: an OS can purge origin storage
    // under disk pressure while localStorage survives, or vice versa. The seed
    // itself verifies per-file sizes and only copies what is missing or stale,
    // so running it on every launch is cheap and self-healing.
    let overlay: ReturnType<typeof createSeedOverlay> | undefined;
    let wroteFiles = 0;
    try {
        wroteFiles = await runSeed((text) => {
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

async function runSeed(onProgress: (text: string) => void): Promise<number> {
    const manifestResponse = await fetch('/gameres/manifest.json');
    if (!manifestResponse.ok) {
        // A shell build may intentionally omit retail resources. Let the
        // normal GameRes flow render its import/CDN chooser rather than
        // aborting Application.main() before the UI exists.
        if (manifestResponse.status === 404) {
            console.info('[nativeShell] No bundled game-resource manifest; continuing with normal resource selection');
            return 0;
        }
        throw new Error(`Shell seed manifest missing (${manifestResponse.status})`);
    }
    const manifest: SeedManifest = await manifestResponse.json();
    const manifestPaths = new Set(manifest.files.map((file) => file.path.toLowerCase()));
    const missingRequiredFiles = REQUIRED_RA2_GAME_FILES.filter((file) => !manifestPaths.has(file));
    const hasYuriFiles = OPTIONAL_YR_GAME_FILES.every((file) => manifestPaths.has(file));
    const requestedEngine = getNativeShellEngine();
    const engineFilesAvailable = requestedEngine !== 'yr' || hasYuriFiles;
    if (missingRequiredFiles.length > 0 || !engineFilesAvailable) {
        console.warn(
            `[nativeShell] Resource import is incomplete for ${requestedEngine ?? 'the detected'} engine; ` +
            `missing ${missingRequiredFiles.concat(!hasYuriFiles && requestedEngine === 'yr' ? OPTIONAL_YR_GAME_FILES : []).join(', ')}. ` +
            'The game-resource chooser will remain available.',
        );
        localStorage.removeItem(StorageKey.GameRes);
        localStorage.removeItem(NATIVE_ENGINE_STORAGE_KEY);
    }
    else {
        const selectedEngine = requestedEngine ?? (hasYuriFiles ? 'yr' : 'ra2');
        localStorage.setItem(NATIVE_ENGINE_STORAGE_KEY, selectedEngine);
        console.info(`[nativeShell] Selected ${selectedEngine === 'yr' ? "Yuri's Revenge" : "Red Alert 2"} resources`);
    }
    const totalBytes = manifest.files.reduce((sum, f) => sum + f.size, 0);
    let copiedBytes = 0;
    let wroteFiles = 0;
    if (typeof navigator.storage?.getDirectory !== 'function') {
        throw new Error('Native shell requires Origin Private File System support to seed game resources');
    }
    const root = await navigator.storage.getDirectory();
    for (const file of manifest.files) {
        const segments = file.path.split('/');
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
        const response = await fetch(`/gameres/${file.path}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch bundled resource "${file.path}" (${response.status})`);
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
    if (missingRequiredFiles.length === 0 && engineFilesAvailable) {
        const config = String(GameResSource.Local);
        localStorage.setItem(StorageKey.GameRes, config);
    }
    console.log(`[nativeShell] Seeded ${manifest.files.length} files (${totalBytes} bytes, ${wroteFiles} written) from shell bundle`);
    return wroteFiles;
}
