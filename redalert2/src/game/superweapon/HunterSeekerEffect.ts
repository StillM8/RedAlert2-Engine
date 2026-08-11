import { ObjectType } from "@/engine/type/ObjectType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { MoveTask } from "@/game/gameobject/task/move/MoveTask";
import { AresHunterSeekerTrait } from "@/game/gameobject/trait/AresHunterSeekerTrait";
import {
    resolveAresHunterSeekerConfiguration,
    selectAresHunterSeekerLaunchBuildings,
} from "@/extensions/ares/AresHunterSeeker";
import { findDeliveryTile, discardUnspawnedObject, resolveUnitDeliveryType } from "@/game/superweapon/UnitDeliveryEffect";
import { SuperWeaponEffect, type TileCoord } from "@/game/superweapon/SuperWeaponEffect";
import type { Game } from "@/game/Game";
import type { Player } from "@/game/Player";
import type { AresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";

/**
 * Ares Type=HunterSeeker activation.  Antares launches one configured
 * aircraft from each eligible HSBuilding (bounded by SW.MaxCount), then the
 * aircraft's normal object trait owns target acquisition and detonation.
 */
export class HunterSeekerEffect extends SuperWeaponEffect {
    constructor(
        type: string,
        owner: Player,
        tile: TileCoord,
        private readonly rules: AresSuperWeaponDefinition,
    ) {
        super(type, owner, tile);
    }

    onStart(_game: Game): void { }

    onTick(game: Game): boolean {
        const general = game.rules.general ?? {};
        const side = this.owner.country?.sideDefinition;
        const configuration = resolveAresHunterSeekerConfiguration(this.rules, general, side);
        if (!configuration.typeName) {
            console.warn(`HunterSeeker superweapon "${this.rules.typeId ?? this.type}" has no HunterSeeker.Type or side fallback.`);
            return true;
        }
        if (!configuration.buildingTypes.length) {
            console.warn(`HunterSeeker superweapon "${this.rules.typeId ?? this.type}" has no HSBuilding launch sites.`);
            return true;
        }

        const aircraftType = resolveUnitDeliveryType(game.rules, configuration.typeName);
        if (aircraftType !== ObjectType.Aircraft) {
            console.warn(`HunterSeeker references non-aircraft or unknown TechnoType "${configuration.typeName}"; launch skipped.`);
            return true;
        }
        const aircraftRules = game.rules.getObject(configuration.typeName, ObjectType.Aircraft);
        const buildings = selectAresHunterSeekerLaunchBuildings(
            [...(this.owner.buildings ?? [])],
            configuration.buildingTypes,
            configuration.maxCount,
        );
        for (const building of buildings) {
            let aircraft: any;
            try {
                aircraft = game.createUnitForPlayer(aircraftRules, this.owner);
                const launchTile = findDeliveryTile(game as any, aircraft, building.centerTile ?? building.tile);
                if (!launchTile) {
                    console.warn(`HunterSeeker could not find a launch cell near building "${building.name}".`);
                    discardUnspawnedObject(aircraft);
                    continue;
                }

                game.addObjectTrait(aircraft, new AresHunterSeekerTrait({
                    randomOnly: configuration.randomOnly,
                    affectsHouse: this.rules.swAffectsHouse ?? "Enemies",
                    detonateProximity: configuration.detonateProximity,
                    descendProximity: configuration.descendProximity,
                    ascentSpeed: configuration.ascentSpeed,
                    descentSpeed: configuration.descentSpeed,
                    emergeSpeed: configuration.emergeSpeed,
                    createMoveTask: (context, targetTile) => new MoveTask(context, targetTile, false, {
                        allowOutOfBoundsTarget: true,
                        forceMove: true,
                        closeEnoughTiles: 0,
                    }),
                }));
                aircraft.hunterSeekerLaunchBuilding = building.name;
                game.spawnObject(aircraft, launchTile);
                aircraft.onBridge = false;
                aircraft.position.tileElevation = aircraft.rules.flightLevel ?? general.flightLevel ?? 0;
                aircraft.zone = ZoneType.Air;
            }
            catch (error) {
                console.warn(`HunterSeeker failed to launch near "${building.name}".`, error);
                if (aircraft && !aircraft.isSpawned) discardUnspawnedObject(aircraft);
            }
        }
        return true;
    }
}
