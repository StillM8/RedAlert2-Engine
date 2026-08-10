import type { VirtualFile } from "./VirtualFile";
import { gamePathKey, normalizeGamePath } from "../../engine/GamePath";
export class MemArchive {
    private entries: Map<string, VirtualFile>;
    constructor() {
        this.entries = new Map<string, VirtualFile>();
    }
    addFile(file: VirtualFile): void {
        const filename = normalizeGamePath(file.filename);
        file.filename = filename;
        const key = gamePathKey(filename);
        const previous = this.entries.get(key);
        if (previous && previous.filename !== filename) {
            throw new Error(`Case-insensitive filename collision in archive: ${previous.filename} and ${filename}`);
        }
        this.entries.set(key, file);
    }
    containsFile(filename: string): boolean {
        try {
            return this.entries.has(gamePathKey(filename));
        }
        catch {
            return false;
        }
    }
    openFile(filename: string): VirtualFile {
        if (!this.containsFile(filename)) {
            throw new Error(`File "${filename}" not found in MemArchive`);
        }
        return this.entries.get(gamePathKey(filename))!;
    }
    listFiles(): string[] {
        return [...this.entries.values()].map((file) => file.filename);
    }
    getAllFiles(): VirtualFile[] {
        return [...this.entries.values()];
    }
}
