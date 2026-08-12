import { gamePathKey, normalizeGamePath } from "@/engine/GamePath";
import type {
    ContentImportFile,
    ContentImportKind,
    ContentImportSource,
    ContentImportProgress,
    PlatformContentProvider,
} from "@/content/PlatformContentProvider";

interface DirectoryPickerWindow {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker?: (options?: {
        multiple?: boolean;
    }) => Promise<FileSystemFileHandle[]>;
}

interface SourceFile {
    path: string;
    size: number;
    read: () => Promise<File>;
}

function isAbortError(error: unknown): boolean {
    return (error as { name?: unknown } | undefined)?.name === "AbortError";
}

function sourceFromFiles(
    kind: ContentImportKind,
    name: string | undefined,
    sourceFiles: SourceFile[],
): ContentImportSource {
    const byPath = new Map<string, SourceFile>();
    const files: ContentImportFile[] = [];
    for (const sourceFile of sourceFiles) {
        const normalizedPath = normalizeGamePath(sourceFile.path);
        const key = gamePathKey(normalizedPath);
        if (byPath.has(key)) {
            throw new Error(`Selected content contains duplicate path: ${sourceFile.path}`);
        }
        byPath.set(key, { ...sourceFile, path: normalizedPath });
        files.push({ path: normalizedPath, size: sourceFile.size });
    }
    return {
        kind,
        name,
        files,
        async readFile(path: string): Promise<ReadableStream<Uint8Array>> {
            const normalizedPath = normalizeGamePath(path);
            const sourceFile = byPath.get(gamePathKey(normalizedPath));
            if (!sourceFile) {
                throw new Error(`Selected content file is missing: ${path}`);
            }
            return sourceFile.read().then((file) => file.stream());
        },
        dispose(): void {
            // Browser file handles and File objects are owned by the picker.
        },
    };
}

async function sourceFromDirectory(handle: FileSystemDirectoryHandle): Promise<ContentImportSource> {
    const sourceFiles: SourceFile[] = [];
    const visit = async (directory: FileSystemDirectoryHandle, prefix = ""): Promise<void> => {
        for await (const [name, child] of directory.entries()) {
            const path = prefix ? `${prefix}/${name}` : name;
            if (child.kind === "directory") {
                await visit(child as FileSystemDirectoryHandle, path);
                continue;
            }
            const fileHandle = child as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            sourceFiles.push({
                path,
                size: file.size,
                read: () => fileHandle.getFile(),
            });
        }
    };
    await visit(handle);
    if (!sourceFiles.length) {
        throw new Error("The selected folder contains no readable files");
    }
    return sourceFromFiles("directory", handle.name, sourceFiles);
}

function sourceFromInputFiles(
    kind: ContentImportKind,
    files: File[],
    directory: boolean,
): ContentImportSource {
    const rawPaths = files.map((file) => {
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        return relativePath || file.name;
    });
    const directoryRoot = directory
        ? rawPaths[0]?.split("/")[0]
        : undefined;
    const sourceFiles = files.map((file, index) => {
        const rawPath = rawPaths[index];
        const path = directoryRoot && rawPath.startsWith(`${directoryRoot}/`)
            ? rawPath.slice(directoryRoot.length + 1)
            : rawPath;
        return {
            path,
            size: file.size,
            read: async () => file,
        } satisfies SourceFile;
    });
    return sourceFromFiles(
        kind,
        directoryRoot || (files.length === 1 ? files[0]?.name : "imported-content"),
        sourceFiles,
    );
}

export class BrowserContentProvider implements PlatformContentProvider {
    static isAvailable(): boolean {
        return typeof document !== "undefined";
    }

    async pickGameDirectory(): Promise<ContentImportSource | undefined> {
        return this.pickDirectory();
    }

    async pickModDirectory(_onProgress?: ContentImportProgress): Promise<ContentImportSource | undefined> {
        return this.pickDirectory();
    }

    async pickModArchives(options: { multiple?: boolean; onProgress?: ContentImportProgress } = {}): Promise<ContentImportSource | undefined> {
        const pickerWindow = globalThis as DirectoryPickerWindow;
        if (pickerWindow.showOpenFilePicker) {
            try {
                const handles = await pickerWindow.showOpenFilePicker({ multiple: options.multiple !== false });
                return sourceFromFiles(
                    "archives",
                    handles.length === 1 ? handles[0]?.name : "imported-content",
                    await Promise.all(handles.map(async (handle) => {
                        const file = await handle.getFile();
                        return {
                            path: file.name,
                            size: file.size,
                            read: () => handle.getFile(),
                        } satisfies SourceFile;
                    })),
                );
            }
            catch (error) {
                if (isAbortError(error)) return undefined;
                throw error;
            }
        }
        return this.pickFromInput("archives", options.multiple !== false, false);
    }

    private async pickDirectory(): Promise<ContentImportSource | undefined> {
        const pickerWindow = globalThis as DirectoryPickerWindow;
        if (pickerWindow.showDirectoryPicker) {
            try {
                return await sourceFromDirectory(await pickerWindow.showDirectoryPicker());
            }
            catch (error) {
                if (isAbortError(error)) return undefined;
                throw error;
            }
        }
        return this.pickFromInput("directory", false, true);
    }

    private pickFromInput(
        kind: ContentImportKind,
        multiple: boolean,
        directory: boolean,
    ): Promise<ContentImportSource | undefined> {
        if (typeof document === "undefined") return Promise.resolve(undefined);
        return new Promise((resolve, reject) => {
            const input = document.createElement("input");
            let settled = false;
            input.type = "file";
            input.multiple = multiple;
            if (directory) {
                input.setAttribute("webkitdirectory", "");
                input.setAttribute("directory", "");
            }
            input.style.display = "none";
            const cleanup = () => {
                input.remove();
                window.removeEventListener("focus", onWindowFocus);
            };
            const finish = (value: ContentImportSource | undefined) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };
            const onWindowFocus = () => {
                // Chromium fires focus after the native file dialog closes;
                // defer one turn so a selected file can populate input.files.
                setTimeout(() => {
                    if (!input.files?.length) finish(undefined);
                }, 0);
            };
            input.addEventListener("cancel", () => finish(undefined), { once: true });
            input.addEventListener("change", () => {
                const files = Array.from(input.files ?? []);
                if (!files.length) {
                    finish(undefined);
                    return;
                }
                try {
                    finish(sourceFromInputFiles(kind, files, directory));
                }
                catch (error) {
                    cleanup();
                    settled = true;
                    reject(error);
                }
            }, { once: true });
            (document.body ?? document.documentElement).appendChild(input);
            window.addEventListener("focus", onWindowFocus);
            input.click();
        });
    }
}
