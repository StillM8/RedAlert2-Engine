/**
 * Files selected by a platform shell are exposed to the shared content layer
 * through this contract. The picker/storage implementation may be Android
 * SAF, an iOS document provider, Windows Explorer, or a browser picker; the
 * importer must not need to know which one supplied the files.
 */
export type ContentImportKind = "directory" | "archives";

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
    pickModDirectory(): Promise<ContentImportSource | undefined>;
    pickModArchives(options?: { multiple?: boolean }): Promise<ContentImportSource | undefined>;
}
