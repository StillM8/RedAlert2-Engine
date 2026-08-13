import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import {
    parseAresParticleSystemRules,
    parseAresParticleTypeRules,
    resolveAresParticleSystems,
} from "@/extensions/ares/AresParticleSystems";

describe("Ares ParticleSystem rule registry", () => {
    test("parses ParticleSystem -> Particle -> Image relationships", () => {
        const ini = new IniFile(`
[ParticleSystems]
0=SmallGreySSys
1=SparkSys

[Particles]
0=SmallGreySmoke
1=Spark

[SmallGreySSys]
HoldsWhat=SmallGreySmoke
BehavesLike=Smoke
ParticleCap=7
SpawnFrames=10

[SparkSys]
HoldsWhat=Spark
BehavesLike=Spark
ParticleCap=6
SpawnSparkPercentage=.2

[SmallGreySmoke]
Image=SGRYSMK1
Velocity=9.0
Deacc=.05
BehavesLike=Smoke

[Spark]
BehavesLike=Spark
MaxEC=500
ColorList=(255,255,255),(200,200,80)
`);

        const particles = parseAresParticleTypeRules(ini);
        const systems = parseAresParticleSystemRules(ini, particles);
        expect(systems.get("smallgreyssys")).toMatchObject({
            id: "SmallGreySSys",
            holdsWhat: "SmallGreySmoke",
            behavesLike: "Smoke",
            particleCap: 7,
            particle: {
                id: "SmallGreySmoke",
                image: "SGRYSMK1",
                velocity: 9,
                deacc: 0.05,
            },
        });
        expect(systems.get("sparksys")?.particle?.colorList).toEqual([
            [255, 255, 255],
            [200, 200, 80],
        ]);
    });

    test("resolves authored IDs case-insensitively and preserves missing definitions", () => {
        const systems = new Map([
            ["smokesys", { id: "SmokeSys", behavesLike: "Smoke" }],
        ]);
        expect(resolveAresParticleSystems(["SMOKESYS", "MissingSys"], systems)).toEqual([
            { id: "SmokeSys", behavesLike: "Smoke" },
            { id: "MissingSys" },
        ]);
    });
});
