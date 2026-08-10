import type { VirtualFile } from '../../data/vfs/VirtualFile';
import type { DataStream } from '../../data/DataStream';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
export class VideoConverter {
    async convertBinkVideo(
        ffmpeg: FFmpeg,
        binkFile: VirtualFile,
        outputFormat: "webm" | "mp4" = "webm",
        onProgress?: (progress: number) => void,
    ): Promise<Uint8Array> {
        const inputFileName = binkFile.filename;
        const outputFileName = inputFileName.replace(/\.[^.]+$/, "") + "." + outputFormat;
        const binkDataStream = binkFile.stream as DataStream;
        const binkFileData = new Uint8Array(binkDataStream.buffer, binkDataStream.byteOffset, binkDataStream.byteLength);
        const progressHandler = ({ progress }: { progress: number }) => onProgress?.(progress);
        if (onProgress) {
            ffmpeg.on("progress", progressHandler);
        }
        await ffmpeg.writeFile(inputFileName, binkFileData);
        try {
            if (outputFormat === "webm") {
                await ffmpeg.exec([
                    "-i", inputFileName,
                    "-vcodec", "libvpx",
                    "-crf", "10",
                    "-b:v", "2M",
                    "-an",
                    outputFileName,
                ]);
            }
            else if (outputFormat === "mp4") {
                await ffmpeg.exec([
                    "-i", inputFileName,
                    "-vcodec", "libx264",
                    "-crf", "25",
                    "-b:v", "2M",
                    "-an",
                    outputFileName,
                ]);
            }
            else {
                throw new Error(`Unsupported video output format: ${outputFormat}`);
            }
            return await ffmpeg.readFile(outputFileName) as Uint8Array;
        }
        finally {
            if (onProgress) {
                ffmpeg.off("progress", progressHandler);
            }
            try {
                await ffmpeg.deleteFile(inputFileName);
            }
            catch {
                // The worker may already have removed the input after a failed exec.
            }
            try {
                await ffmpeg.deleteFile(outputFileName);
            }
            catch {
                // There may be no output file when conversion fails.
            }
        }
    }
}
