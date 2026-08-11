import { DataStream } from "./DataStream";
import { Blowfish } from "./encoding/Blowfish";
import { BlowfishKey } from "./encoding/BlowfishKey";
import { MixEntry } from "./MixEntry";
import { VirtualFile } from "./vfs/VirtualFile";
enum MixFileFlags {
    Checksum = 0x00010000,
    Encrypted = 0x00020000
}
export class MixFile {
    private stream: DataStream;
    private headerStart = 84;
    private index: Map<number, MixEntry>;
    private dataStart: number = 0;
    constructor(stream: DataStream) {
        this.stream = stream;
        this.index = new Map<number, MixEntry>();
        this.parseHeader();
    }
    private parseHeader(): void {
        const flags = this.stream.readUint32();
        const isWestwoodMix = (flags & ~(MixFileFlags.Checksum | MixFileFlags.Encrypted)) === 0;
        if (isWestwoodMix) {
            if ((flags & MixFileFlags.Encrypted) !== 0) {
                this.dataStart = this.parseRaHeader();
                return;
            }
        }
        else {
            this.stream.seek(0);
        }
        this.dataStart = this.parseTdHeader(this.stream);
    }
    private parseRaHeader(): number {
        const e = this.stream;
        var t: any = e.readUint8Array(80), i: any = new BlowfishKey().decryptKey(t), r: any = e.readUint32Array(2);
        const s = new Blowfish(i);
        let a = new DataStream(s.decrypt(r));
        t = a.readUint16();
        a.readUint32(), (e.position = this.headerStart);
        (i = 6 + t * MixEntry.size),
            (t = ((3 + i) / 4) | 0),
            (r = e.readUint32Array(t + (t % 2)));
        a = new DataStream(s.decrypt(r));
        i = this.headerStart + i + ((1 + (~i >>> 0)) & 7);
        this.parseTdHeader(a);
        return i;
    }
    private parseTdHeader(e: DataStream): number {
        var t = e.readUint16();
        e.readUint32();
        for (let r = 0; r < t; r++) {
            try {
                if (e.position + 12 > e.byteLength) {
                    console.warn(`[MixFile] Truncated index at entry ${r + 1}; stopping parse.`);
                    break;
                }
                var i = new MixEntry(e.readUint32(), e.readUint32(), e.readUint32());
                this.index.set(i.hash, i);
            }
            catch (error) {
                console.warn(`[MixFile] Failed to read index entry ${r + 1}; stopping parse.`, error);
                break;
            }
        }
        return e.position;
    }
    public containsFile(filename: string): boolean {
        return this.index.has(MixEntry.hashFilename(filename));
    }
    public openFile(filename: string): VirtualFile {
        const fileId = MixEntry.hashFilename(filename);
        const entry = this.index.get(fileId);
        if (!entry) {
            throw new Error(`File "${filename}" not found`);
        }
        return VirtualFile.factory(this.stream, filename, this.dataStart + entry.offset, entry.length);
    }
    /**
     * Some retail entries only exist as name hashes (e.g. the Yuri sidebar
     * palette in sidec02md.mix, whose original filename is "radaryuri.pal" (hash 0x0B8D57C4)). This
     * opens them under a caller-chosen alias.
     */
    public containsHash(hash: number): boolean {
        return this.index.has(hash);
    }
    public openFileByHash(hash: number, alias: string): VirtualFile {
        const entry = this.index.get(hash);
        if (!entry) {
            throw new Error(`Hash 0x${hash.toString(16)} not found`);
        }
        return VirtualFile.factory(this.stream, alias, this.dataStart + entry.offset, entry.length);
    }
}
