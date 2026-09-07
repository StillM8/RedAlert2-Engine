import fs from 'node:fs';
import path from 'node:path';

export type E2eGameProfile = 'ra2' | 'yr';

/**
 * Describes the user-owned game directory used by an asset-backed browser
 * test. The directory is never copied into the repository or into a release
 * artifact; Vite exposes it read-only for the lifetime of the test server.
 */
export class AssetProfile {
    readonly game: E2eGameProfile;
    readonly rootDirectory?: string;

    private constructor(game: E2eGameProfile, rootDirectory?: string) {
        this.game = game;
        this.rootDirectory = rootDirectory;
    }

    static fromEnvironment(): AssetProfile {
        const rawGame = (process.env.RA2_E2E_PROFILE ?? 'ra2').trim().toLowerCase();
        if (rawGame !== 'ra2' && rawGame !== 'yr') {
            throw new Error(`RA2_E2E_PROFILE must be "ra2" or "yr", got "${rawGame}"`);
        }
        const rawRoot = process.env.RA2_E2E_ASSETS?.trim();
        return new AssetProfile(
            rawGame,
            rawRoot ? path.resolve(rawRoot) : undefined,
        );
    }

    get isConfigured(): boolean {
        return Boolean(this.rootDirectory);
    }

    requireConfigured(): string {
        if (!this.rootDirectory) {
            throw new Error(
                'Asset-backed tests require RA2_E2E_ASSETS to point to a user-owned Red Alert 2/Yuri\'s Revenge directory. ' +
                'Example: RA2_E2E_ASSETS="/path/to/game" bun run test:e2e:assets',
            );
        }
        if (!fs.existsSync(this.rootDirectory) || !fs.statSync(this.rootDirectory).isDirectory()) {
            throw new Error(`RA2_E2E_ASSETS is not a directory: ${this.rootDirectory}`);
        }
        return this.rootDirectory;
    }

    /**
     * Installs a browser-side FileSystemDirectoryHandle adapter. This runs
     * before React/Application boot, so the regular GameResBoxApi folder
     * button drives the regular importer instead of a test-only import path.
     */
    createPickerInitScript(): string {
        const assetBaseUrl = '/__e2e_assets__';
        return `
(() => {
    const assetBaseUrl = ${JSON.stringify(assetBaseUrl)};
    let manifestPromise;

    const missing = (kind, name) => Promise.reject(new DOMException(
        \`No such \${kind} "\${name}" in the E2E asset fixture\`,
        'NotFoundError',
    ));

    const notAllowed = (name) => Promise.reject(new DOMException(
        \`The read-only E2E asset fixture cannot create "\${name}"\`,
        'NotAllowedError',
    ));

    const loadManifest = async () => {
        if (!manifestPromise) {
            manifestPromise = fetch(assetBaseUrl + '/__manifest.json').then(async (response) => {
                if (!response.ok) {
                    throw new Error('Unable to load the E2E asset manifest: HTTP ' + response.status);
                }
                return response.json();
            });
        }
        return manifestPromise;
    };

    const encodePath = (relativePath) => relativePath
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');

    const readFile = async (relativePath, name) => {
        const response = await fetch(assetBaseUrl + '/' + encodePath(relativePath));
        if (!response.ok) {
            throw new DOMException('Unable to read E2E asset "' + name + '"', 'NotFoundError');
        }
        // Do not materialize a Blob and then copy it into a File. Large MIX
        // archives can exceed Chromium's renderer buffer when the response is
        // duplicated. The importer only needs File.name and arrayBuffer(), so
        // keep the read-once response behind that small File-compatible shape.
        const contentLength = Number(response.headers.get('content-length'));
        return {
            name,
            size: Number.isSafeInteger(contentLength) ? contentLength : 0,
            type: response.headers.get('content-type') || 'application/octet-stream',
            lastModified: 0,
            arrayBuffer: () => response.arrayBuffer(),
        };
    };

    const makeHandle = (name, relativePath, entry) => {
        if (entry.kind === 'file') {
            return {
                kind: 'file',
                name,
                async getFile() {
                    return readFile(relativePath, name);
                },
            };
        }

        const children = entry.entries || {};
        const child = (childName) => {
            const childEntry = children[childName];
            if (!childEntry) {
                return undefined;
            }
            const childPath = relativePath ? relativePath + '/' + childName : childName;
            return makeHandle(childName, childPath, childEntry);
        };
        return {
            kind: 'directory',
            name,
            async *entries() {
                for (const childName of Object.keys(children).sort()) {
                    yield [childName, child(childName)];
                }
            },
            async *keys() {
                for (const childName of Object.keys(children).sort()) {
                    yield childName;
                }
            },
            async *values() {
                for (const childName of Object.keys(children).sort()) {
                    yield child(childName);
                }
            },
            async getDirectoryHandle(childName, options) {
                const handle = child(childName);
                if (!handle || handle.kind !== 'directory') {
                    return missing('directory', childName);
                }
                if (options && options.create) {
                    return notAllowed(childName);
                }
                return handle;
            },
            async getFileHandle(childName, options) {
                const handle = child(childName);
                if (!handle || handle.kind !== 'file') {
                    return missing('file', childName);
                }
                if (options && options.create) {
                    return notAllowed(childName);
                }
                return handle;
            },
            async removeEntry(childName) {
                return notAllowed(childName);
            },
        };
    };

    globalThis.__RA2_E2E_PICK_DIRECTORY__ = async () => {
        const manifest = await loadManifest();
        return makeHandle(manifest.rootName || 'e2e-assets', '', {
            kind: 'directory',
            entries: manifest.entries || {},
        });
    };
})();`;
    }
}
