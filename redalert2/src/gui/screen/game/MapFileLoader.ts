import { FileNotFoundError } from '@/data/vfs/FileNotFoundError';
import { VirtualFile } from '@/data/vfs/VirtualFile';
import { Engine } from '@/engine/Engine';
export class MapFileLoader {
    constructor(private resourceLoader: any, private vfs?: any) { }
    async load(filename: string, cancellationToken?: any): Promise<VirtualFile> {
        let mapFile: VirtualFile | undefined;
        if (this.vfs) {
            try {
                if (!Engine.isGameResCdn()) {
                    await this.vfs.loadDeferredMapArchives?.(Engine.getActiveEngine(), Engine.getActiveProfile?.());
                }
                mapFile = await this.vfs.openFileWithRfs(filename);
            }
            catch (error) {
                if (!(error instanceof FileNotFoundError)) {
                    console.error(error);
                }
            }
        }
        if (!mapFile) {
            if (!Engine.isGameResCdn()) {
                throw new FileNotFoundError(`Map "${filename}" not found in imported game resources`);
            }
            const bytes = await this.resourceLoader.loadBinary(filename, cancellationToken);
            mapFile = VirtualFile.fromBytes(bytes, filename);
        }
        return mapFile;
    }
}
