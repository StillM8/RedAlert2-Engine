import {
    getOriginPrivateDirectory,
    polyfillDataTransferItem,
    showDirectoryPicker,
    showOpenFilePicker,
    showSaveFilePicker,
    support,
} from 'file-system-access';
import cache from 'file-system-access/lib/adapters/cache.js';
import indexeddb from 'file-system-access/lib/adapters/indexeddb.js';
import type { FileSystemAccessLib } from './FileSystemAccessLib';

export const browserFileSystemAccess: FileSystemAccessLib = {
    support,
    adapters: {
        indexeddb,
        cache,
    },
    getOriginPrivateDirectory,
    async polyfillDataTransferItem() {
        await polyfillDataTransferItem();
    },
    showDirectoryPicker: async (options?: any) => {
        // Playwright's asset-backed integration tests install a read-only
        // FileSystemDirectoryHandle before the application boots. Keeping the
        // hook here exercises the same GameResBoxApi/importer path as a real
        // browser folder selection without adding a product-facing bypass.
        const e2ePicker = (globalThis as any).__RA2_E2E_PICK_DIRECTORY__;
        if (typeof e2ePicker === 'function') {
            return e2ePicker(options);
        }
        return showDirectoryPicker(options);
    },
    showOpenFilePicker,
    showSaveFilePicker,
};
