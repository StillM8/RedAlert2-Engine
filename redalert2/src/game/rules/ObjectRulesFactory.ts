import { ObjectType } from '@/engine/type/ObjectType';
import { ObjectRules } from './ObjectRules';
import { TechnoRules } from './TechnoRules';
import { OverlayRules } from './OverlayRules';
import { TerrainRules } from './TerrainRules';
import { SmudgeRules } from './SmudgeRules';
import { DebrisRules } from './DebrisRules';
import { ArmorRegistry } from '@/extensions/ares/AresArmor';
import type { AresSideRegistry } from '@/extensions/ares/AresSides';
import type { AresParticleSystemRules, AresParticleTypeRules } from '@/extensions/ares/AresParticleSystems';
import { registerAresPassengerRules } from '@/extensions/ares/AresPassengers';
export class ObjectRulesFactory {
    create(type: ObjectType, ini: any, generalRules: any, index: number = -1, armorRegistry?: ArmorRegistry, sideRegistry?: AresSideRegistry, particleSystemRules?: ReadonlyMap<string, AresParticleSystemRules>, particleTypeRules?: ReadonlyMap<string, AresParticleTypeRules>) {
        switch (type) {
            case ObjectType.Aircraft:
            case ObjectType.Building:
            case ObjectType.Infantry:
            case ObjectType.Vehicle: {
                const rules = new TechnoRules(type, ini, index, {
                    ...generalRules,
                    aresParticleSystemRules: particleSystemRules,
                    aresParticleTypeRules: particleTypeRules,
                }, armorRegistry, sideRegistry);
                // Passenger extensions are normalized once at rule creation.
                // Transport/order runtime code never has to re-read raw INI.
                registerAresPassengerRules(rules, ini);
                return rules;
            }
            case ObjectType.Overlay:
                return new OverlayRules(type, ini, index, generalRules, armorRegistry);
            case ObjectType.Terrain:
                return new TerrainRules(type, ini, index, generalRules);
            case ObjectType.Smudge:
                return new SmudgeRules(type, ini, index, generalRules);
            case ObjectType.VoxelAnim:
                return new DebrisRules(type, ini, index, generalRules);
            default:
                return new ObjectRules(type, ini, index, generalRules);
        }
    }
}