import { ShpFile } from "@/data/ShpFile";
import { ShpImage } from "@/data/ShpImage";
export class ShpAggregator {
    static getShpFrameInfo(file: ShpFile, hasShadow: boolean) {
        // A few modern YR/MO animation SHPs contain a single frame while
        // their art section still advertises Shadow=yes.  Treating that as a
        // shadowed file produces zero visible frames and later points the
        // shadow builder one frame past the aggregate.  A shadow needs a
        // separate image, so a one-frame file is a normal, shadowless sprite.
        const imageCount = Math.min(file.numImages, file.images.length);
        const hasUsableShadow = hasShadow && imageCount >= 2;
        return {
            file,
            hasShadow: hasUsableShadow,
            frameCount: hasUsableShadow ? Math.floor(imageCount * 0.5) : imageCount,
        };
    }
    aggregate(frames: Array<{
        file: ShpFile;
        hasShadow: boolean;
        frameCount: number;
    }>, filename: string) {
        const shpFile = new ShpFile();
        shpFile.filename = filename;
        const shadowImages: ShpImage[] = [];
        const imageIndexes = new Map<ShpFile, number>();
        let currentIndex = 0;
        for (const { file, hasShadow, frameCount } of frames) {
            if (!imageIndexes.has(file)) {
                imageIndexes.set(file, currentIndex);
                for (let i = 0; i < frameCount; i++) {
                    shpFile.addImage(file.getImage(i));
                    shadowImages.push(hasShadow ? file.getImage(frameCount + i) : new ShpImage());
                    currentIndex++;
                }
            }
        }
        shadowImages.forEach(image => shpFile.addImage(image));
        return {
            file: shpFile,
            imageIndexes
        };
    }
}
