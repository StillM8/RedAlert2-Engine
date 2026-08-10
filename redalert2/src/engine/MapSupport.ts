import { MapFile } from "@/data/MapFile";
import { Strings } from "@/data/Strings";
import { Rules } from "@/game/rules/Rules";
import { Engine } from "@/engine/Engine";
import { TileSets } from "@/game/theater/TileSets";
import { TheaterType } from "@/engine/TheaterType";
import { ObjectType } from "@/engine/type/ObjectType";
interface BuildingRule {
    undeploysInto?: string;
}
interface TechnoRule {
    spawns?: string;
    deploysInto?: string;
}
export class MapSupport {
    static check(map: MapFile, translator: Strings): string | undefined {
        const hasReference = (value: string | undefined): value is string =>
            !!value && value.toLowerCase() !== "none";
        if (map.iniFormat < 4) {
            return translator.get("TS:MapUnsupportedGame");
        }
        if (map.startingLocations.length < 2) {
            return translator.get("TXT_SCENARIO_TOO_SMALL", map.startingLocations.length);
        }
        if (!Engine.supportsTheater(map.theaterType)) {
            return translator.get("TS:MapUnsupportedTheater", TheaterType[map.theaterType]);
        }
        const theaterIni = Engine.getTheaterIni(Engine.getActiveEngine(), map.theaterType);
        const tileSets = new TileSets(theaterIni);
        if (map.maxTileNum > tileSets.readMaxTileNum()) {
            return translator.get("TS:MapUnsupportedTileSet");
        }
        const rules = new Rules(Engine.getRules().clone().mergeWith(map));
        if (!rules.hasOverlayId(map.maxOverlayId)) {
            return translator.get("TS:MapUnsupportedOverlay", map.maxOverlayId);
        }
        for (const weaponType of rules.weaponTypes.values()) {
            if (!rules.getIni().getSection(weaponType)) {
                return translator.get("TS:MapUnsupportedWeapon", weaponType);
            }
            const weaponData = rules.getWeapon(weaponType);
            const projectile = weaponData.projectile;
            const warhead = weaponData.warhead;
            if (!projectile || !warhead) {
                return translator.get("TS:MapUnsupportedWeapon", weaponType);
            }
            // Projectiles may legitimately lack an ini section — the original
            // engine defaults all flags (YR's InvisibleLow relies on this), and
            // Rules.getProjectile synthesizes an empty section to match.
            if (!rules.warheadRules.has(warhead.toLowerCase()) &&
                !rules.getIni().getSection(warhead)) {
                return translator.get("TS:MapUnsupportedWarhead", warhead);
            }
        }
        const general = rules.general;
        for (const unit of [...general.baseUnit, ...general.harvesterUnit]) {
            if (hasReference(unit) && !rules.hasObject(unit, ObjectType.Vehicle)) {
                return translator.get("TS:MapUnsupportedTechno", unit);
            }
        }
        for (const disguise of general.defaultMirageDisguises) {
            if (hasReference(disguise) && !rules.terrainRules.has(disguise)) {
                return translator.get("TS:MapUnsupportedTerrain", disguise);
            }
        }
        const crewAndDisguiseUnits = [
            general.engineer,
            general.crew.alliedCrew,
            general.crew.sovietCrew,
            general.alliedDisguise,
            general.sovietDisguise,
        ];
        for (const unit of crewAndDisguiseUnits) {
            if (hasReference(unit) && !rules.infantryRules.has(unit)) {
                return translator.get("TS:MapUnsupportedTechno", unit);
            }
        }
        const crateRules = rules.crateRules;
        for (const crateImg of [crateRules.crateImg, crateRules.waterCrateImg]) {
            if (crateImg && !rules.overlayRules.has(crateImg)) {
                return translator.get("TS:MapUnsupportedOverlay", crateImg);
            }
        }
        for (const building of rules.buildingRules.values() as IterableIterator<BuildingRule>) {
            if (hasReference(building.undeploysInto) &&
                !rules.hasObject(building.undeploysInto, ObjectType.Vehicle)) {
                return translator.get("TS:MapUnsupportedTechno", building.undeploysInto);
            }
        }
        const allTechnoRules = [
            ...rules.infantryRules.values(),
            ...rules.vehicleRules.values(),
            ...rules.aircraftRules.values(),
        ] as TechnoRule[];
        for (const techno of allTechnoRules) {
            if (hasReference(techno.spawns) && !rules.hasObject(techno.spawns, ObjectType.Aircraft)) {
                return translator.get("TS:MapUnsupportedTechno", techno.spawns);
            }
            if (hasReference(techno.deploysInto) &&
                !rules.hasObject(techno.deploysInto, ObjectType.Building)) {
                return translator.get("TS:MapUnsupportedTechno", techno.deploysInto);
            }
        }
        return undefined;
    }
}
