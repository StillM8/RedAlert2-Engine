import { VxlBatchedBuilder } from "./VxlBatchedBuilder";
import { VxlNonBatchedBuilder } from "./VxlNonBatchedBuilder";
import { VxlGeometryPool } from "./vxlGeometry/VxlGeometryPool";
import { Camera } from "three";
import { VxlFile } from "@/data/VxlFile";
import { HvaFile } from "@/data/HvaFile";
import { Palette } from "@/data/Palette";
import { VxlBuilder } from "./VxlBuilder";
export class VxlBuilderFactory {
    constructor(private vxlGeometryPool: VxlGeometryPool, private useBatching: boolean, private camera: Camera) { }
    create(vxlData: VxlFile, hvaData: HvaFile | undefined, palettes: Palette[], palette: Palette): VxlBuilder {
        // Ares/custom sides can use a player color that is not present in the
        // vanilla [Colors] list. Batched VXLs need the active palette in their
        // texture-array rows or they fail while creating the first tank/plane.
        // Keep the extra row detached from the mutable active palette because
        // ownership changes remap that object in place later.
        const availablePalettes = palettes.some((candidate) => candidate.hash === palette.hash)
            ? palettes
            : [...palettes, palette.clone()];
        return this.useBatching
            ? new VxlBatchedBuilder(vxlData, hvaData, availablePalettes, palette, this.vxlGeometryPool, this.camera)
            : new VxlNonBatchedBuilder(vxlData, palette, hvaData ?? null, this.vxlGeometryPool, this.camera);
    }
}
