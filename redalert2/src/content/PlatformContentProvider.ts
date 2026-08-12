/**
 * Files selected by a platform shell are exposed to the shared content layer
 * through this contract. The picker/storage implementation may be Android
 * SAF, an iOS document provider, Windows Explorer, or a browser picker; the
 * importer must not need to know which one supplied the files.
 */
export type ContentImportKind = "directory" | "archives";
export type ContentImportProgress = (text: string) => void;

export interface ContentImportFile {
    path: string;
    size: number;
}

export interface ContentImportSource {
    readonly kind: ContentImportKind;
    readonly name?: string;
    readonly files: readonly ContentImportFile[];
    readFile(path: string): Promise<ReadableStream<Uint8Array>>;
    dispose(): void | Promise<void>;
}

export interface PlatformContentProvider {
    /** Browser/desktop providers return a streamable source; Android's native
     * game picker commits directly through SAF and therefore may omit this. */
    pickGameDirectory?(): Promise<ContentImportSource | undefined>;
    pickModDirectory(onProgress?: ContentImportProgress): Promise<ContentImportSource | undefined>;
    pickModArchives(options?: { multiple?: boolean; onProgress?: ContentImportProgress }): Promise<ContentImportSource | undefined>;
}
