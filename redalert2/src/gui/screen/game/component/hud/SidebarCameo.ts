import { ShpImage } from "@/data/ShpImage";

export interface SidebarSlotSize {
    width: number;
    height: number;
}

export type SidebarSpriteSurface = "shp" | "pcx";

/**
 * Sidebar cells are laid out from their top-left corner. SHP and canvas
 * sprites have different internal anchor conventions, so keep the conversion
 * in one place instead of making each sidebar consumer guess at it.
 */
export function getSidebarSlotSpriteAlignment(
    surface: SidebarSpriteSurface,
): { x: number; y: number } {
    // SHP sprites default to the ShpBuilder UI anchor (x=1, y=-1), which
    // centers the sprite in its slot. PCX/canvas sprites compensate their
    // anchor in CanvasSpriteBuilder.getSpriteGeometryOptions and use the
    // same final geometry align, so their slot-level alignment stays x=-1
    // (flipped horizontally) with the standard y=-1.
    return surface === "pcx"
        ? { x: -1, y: -1 }
        : { x: 1, y: -1 };
}

/**
 * Put a cropped SHP frame into the fixed canvas used by a sidebar slot.
 *
 * SHP frame headers are allowed to describe a cropped image with an x/y
 * offset. That offset is meaningful when the frame is rendered from its
 * original file, but it cannot be carried across an aggregate whose canvas
 * size is shared by every cameo. Copying into the slot canvas makes the
 * aggregate deterministic while retaining the authored placement and
 * clipping frames that extend outside the canvas.
 */
export function normalizeSidebarCameoFrame(
    image: ShpImage,
    slotSize: SidebarSlotSize,
): ShpImage {
    const width = Math.max(1, Math.trunc(slotSize.width));
    const height = Math.max(1, Math.trunc(slotSize.height));
    const data = new Uint8Array(width * height);

    const sourceX = Math.trunc(image.x);
    const sourceY = Math.trunc(image.y);
    const sourceStartX = Math.max(0, -sourceX);
    const sourceStartY = Math.max(0, -sourceY);
    const destinationStartX = Math.max(0, sourceX);
    const destinationStartY = Math.max(0, sourceY);
    const copyWidth = Math.min(
        image.width - sourceStartX,
        width - destinationStartX,
    );
    const copyHeight = Math.min(
        image.height - sourceStartY,
        height - destinationStartY,
    );

    if (copyWidth > 0 && copyHeight > 0) {
        for (let row = 0; row < copyHeight; row++) {
            const sourceOffset = (sourceStartY + row) * image.width + sourceStartX;
            const destinationOffset = (destinationStartY + row) * width + destinationStartX;
            data.set(
                image.imageData.subarray(sourceOffset, sourceOffset + copyWidth),
                destinationOffset,
            );
        }
    }

    return new ShpImage(data, width, height, 0, 0);
}
