/** A streamable archive source used by the mod importer. */
export interface ArchiveSource {
    name: string;
    size?: number;
    stream(): ReadableStream<Uint8Array>;
    dispose?: () => void | Promise<void>;
}
