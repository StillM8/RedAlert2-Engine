import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { IniSection } from "@/data/IniSection";
import { Palette } from "@/data/Palette";
import { ObjectType } from "@/engine/type/ObjectType";
import { VxlBuilder } from "@/engine/renderable/builder/VxlBuilder";
import { VxlBuilderFactory } from "@/engine/renderable/builder/VxlBuilderFactory";
import { ObjectArt } from "@/game/art/ObjectArt";
import { ObjectRules } from "@/game/rules/ObjectRules";

class TestVxlBuilder extends VxlBuilder {
    createVxlMeshes(): Map<string, THREE.Mesh> {
        return new Map([["Main Rotor", new THREE.Mesh(new THREE.BufferGeometry())]]);
    }
}

function makeRules(type: ObjectType, name: string, values: Record<string, string> = {}): ObjectRules {
    const section = new IniSection(name);
    for (const [key, value] of Object.entries(values)) section.set(key, value);
    return new ObjectRules(type, section);
}

describe("generic voxel/Ares asset compatibility", () => {
    test("uses the actual retail SHAD rotor section names", () => {
        const art = new ObjectArt(ObjectType.Vehicle, makeRules(ObjectType.Vehicle, "SHAD"), new IniSection("SHAD"));

        expect(art.rotors?.map((rotor) => rotor.name)).toEqual(["Main Rotor", "Rear Rotor"]);
    });

    test("does not apply infantry alternate-arctic art to voxel units", () => {
        const previous = ObjectArt.inSnowTheater;
        ObjectArt.inSnowTheater = true;
        try {
            const vehicle = new ObjectArt(
                ObjectType.Vehicle,
                makeRules(ObjectType.Vehicle, "TANK", { AlternateArcticArt: "yes" }),
                new IniSection("TANK"),
            );
            const infantry = new ObjectArt(
                ObjectType.Infantry,
                makeRules(ObjectType.Infantry, "SEAL", { AlternateArcticArt: "yes" }),
                new IniSection("SEAL"),
            );

            expect(vehicle.imageName).toBe("TANK");
            expect(infantry.imageName).toBe("SEALA");
        }
        finally {
            ObjectArt.inSnowTheater = previous;
        }
    });

    test("resolves VXL sections without depending on authoring case", () => {
        const builder = new TestVxlBuilder({ rotation: { y: 0 } });
        builder.build();

        expect(builder.getSection("main rotor")).toBeDefined();
    });

    test("adds an active custom palette row for batched VXLs", () => {
        const palette = new Palette();
        const factory = new VxlBuilderFactory({} as any, true, { rotation: { y: 0 } } as any);
        const builder = factory.create({ sections: [] } as any, undefined, [], palette);

        expect((builder as any).palettes).toHaveLength(1);
        expect((builder as any).palettes[0].hash).toBe(palette.hash);
    });
});
