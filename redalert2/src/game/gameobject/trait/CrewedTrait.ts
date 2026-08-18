import { NotifySell } from "@/game/gameobject/trait/interface/NotifySell";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { NotifyCrash } from "@/game/gameobject/trait/interface/NotifyCrash";
import { SideType } from "@/game/SideType";
import { ObjectType } from "@/engine/type/ObjectType";
import { ScatterTask } from "@/game/gameobject/task/ScatterTask";
import { ParadropTask } from "@/game/gameobject/task/ParadropTask";
import { Infantry } from "@/game/gameobject/Infantry";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import {
    copyAresSurvivorExperience,
    getAresSideSurvivorOverride,
    getAresSurvivorPilotChance,
    getAresSurvivorPilotCount,
    rollAresSurvivorPercent,
} from "@/extensions/ares/AresSurvivors";

/**
 * Retail crew spawning plus the Ares vehicle/aircraft Survivor.* extension.
 *
 * Buildings and non-Ares matches deliberately retain the original refund /
 * SurvivorDivisor behavior. Ares vehicle/aircraft pilots use PilotCount and a
 * per-pilot rank chance instead, as documented by Ares.
 */
export class CrewedTrait implements NotifyCrash {
    private crashPilotsResolved = false;

    constructor(private readonly aresSurvivorsEnabled: boolean = false) {}

    [NotifySell.onSell](target: any, context: any): void {
        // Survivor.* is destruction behavior. Selling continues through the
        // engine's retail crew/refund path even when Ares is active.
        this.spawnLegacySurvivors(target, context);
    }

    [NotifyCrash.onCrash](target: any, context: any, damageInfo?: any): void {
        if (!this.aresSurvivorsEnabled || this.crashPilotsResolved ||
            !(target.isVehicle?.() || target.isAircraft?.())) {
            return;
        }
        this.spawnAresPilots(target, context, damageInfo, true);
        this.crashPilotsResolved = true;
    }

    [NotifyDestroy.onDestroy](target: any, context: any, damageInfo: any, isSell: boolean): void {
        if (isSell || (damageInfo?.obj === target && damageInfo.weapon?.rules.suicide)) {
            return;
        }
        if (this.aresSurvivorsEnabled && (target.isVehicle?.() || target.isAircraft?.())) {
            if (!this.crashPilotsResolved) {
                this.spawnAresPilots(target, context, damageInfo, false);
            }
            return;
        }
        // Preserve the established non-Ares behavior exactly: moving vehicles
        // and crashable objects do not emit the legacy crew here.
        if (!(target.isVehicle() && target.moveTrait.isMoving()) && !target.crashableTrait) {
            this.spawnLegacySurvivors(target, context);
        }
    }

    private resolveCrewType(target: any, context: any): string | undefined {
        const override = getAresSideSurvivorOverride(target);
        if (override) return override;
        const crewRules = context.rules.general.crew;
        const side = target.owner.country.side;
        const sideDefinition = target.owner.country.sideDefinition;
        if (sideDefinition?.crew) return sideDefinition.crew;
        if (side === SideType.GDI) return crewRules.alliedCrew;
        if (side === SideType.Nod) return crewRules.sovietCrew;
        return undefined;
    }

    private spawnAresPilots(target: any, context: any, _damageInfo: any, airborne: boolean): void {
        const crewType = this.resolveCrewType(target, context);
        if (!crewType) return;
        let pilotCount = getAresSurvivorPilotCount(target);
        pilotCount = target.aresVehicleHijackerTrait?.adjustSurvivorPilotCount?.(pilotCount) ?? pilotCount;
        if (pilotCount <= 0) return;

        const chance = getAresSurvivorPilotChance(target, context.rules.general.crew.crewEscape);
        if (chance <= 0) {
            // Ares explicitly says PilotChance=0 does not create virtual pilot
            // casualties. Nothing needs to be instantiated in that case.
            return;
        }

        let infantryRules: any;
        try {
            infantryRules = context.rules.getObject(crewType, ObjectType.Infantry);
        }
        catch {
            return;
        }
        if (!infantryRules) return;

        for (let index = 0; index < pilotCount; index++) {
            if (!rollAresSurvivorPercent(context, chance)) {
                // Ares attributes a failed positive-chance pilot as a casualty
                // to the transport's killer. This engine has no safe virtual
                // limbo-kill primitive yet, so do not fabricate a spawned unit.
                continue;
            }
            const landing = this.resolvePilotLanding(target, context, infantryRules);
            if (!landing) {
                continue;
            }
            const unit = context.createUnitForPlayer(infantryRules, target.owner);
            if (unit.isInfantry()) {
                unit.position.subCell = Infantry.SUB_CELLS[0];
            }
            context.spawnObject(unit, target.tile);
            // Ares pilots emerge at 50% max health regardless of source health.
            if (unit.healthTrait) {
                unit.healthTrait.health = 50;
            }
            copyAresSurvivorExperience(target, unit, context);
            if (airborne) {
                unit.position.tileElevation = target.position.tileElevation;
                unit.zone = ZoneType.Air;
                unit.onBridge = false;
                unit.unitOrderTrait.addTask(new ParadropTask(context));
            }
            else {
                unit.position.tileElevation = landing.onBridge?.tileElevation ?? 0;
                unit.onBridge = !!landing.onBridge;
                unit.zone = context.map.getTileZone(target.tile, !landing.onBridge);
                unit.unitOrderTrait.addTask(new ScatterTask(context, undefined, {
                    ignoredBlockers: target.isDestroyed ? undefined : [target],
                }));
            }
        }
    }

    private resolvePilotLanding(target: any, context: any, infantryRules: any): { onBridge?: any } | undefined {
        const tile = target.tile;
        if (!tile || !context.map.isWithinBounds?.(tile)) return undefined;
        const bridge = context.map.tileOccupation.getBridgeOnTile(tile);
        const layers = bridge ? [bridge, undefined] : [undefined];
        for (const onBridge of layers) {
            if (context.map.terrain.getPassableSpeed(
                tile,
                infantryRules.speedType,
                true,
                !!onBridge,
                undefined,
                true,
            ) <= 0) {
                continue;
            }
            // The dying transport itself is allowed to occupy the cell. Other
            // solid ground objects make the pilot's landing cell unavailable.
            const blockers = context.map.getGroundObjectsOnTile?.(tile) ?? [];
            if (blockers.some((object: any) => object !== target &&
                !object.isSmudge?.() &&
                !(object.isOverlay?.() && object.isTiberium?.()))) {
                continue;
            }
            return { onBridge };
        }
        return undefined;
    }

    private spawnLegacySurvivors(target: any, context: any): void {
        const crewRules = context.rules.general.crew;
        const side = target.owner.country.side;
        const sideDefinition = target.owner.country.sideDefinition;
        let survivorDivisor: number;
        let crewType: string;
        if (sideDefinition?.crew && sideDefinition.survivorDivisor && sideDefinition.survivorDivisor > 0) {
            survivorDivisor = sideDefinition.survivorDivisor;
            crewType = sideDefinition.crew;
        }
        else if (side === SideType.GDI) {
            survivorDivisor = crewRules.alliedSurvivorDivisor;
            crewType = crewRules.alliedCrew;
        }
        else if (side === SideType.Nod) {
            survivorDivisor = crewRules.sovietSurvivorDivisor;
            crewType = crewRules.sovietCrew;
        }
        else {
            return;
        }
        let survivorCount = context.sellTrait.computeRefundValue(target) / survivorDivisor;
        survivorCount = survivorCount > 0 && survivorCount < 1 ? 1 : Math.floor(survivorCount);
        survivorCount = target.isVehicle() ? Math.min(1, survivorCount) : Math.min(5, survivorCount);
        if (target.isVehicle?.() || target.isAircraft?.()) {
            survivorCount = target.aresVehicleHijackerTrait?.adjustSurvivorPilotCount?.(survivorCount) ?? survivorCount;
        }
        const crewTypes: string[] = [];
        for (let i = 0; i < survivorCount; i++) {
            crewTypes.push(crewType);
        }
        if (crewTypes.length > 0) {
            if (target.rules.constructionYard) {
                crewTypes[crewTypes.length - 1] = sideDefinition?.engineer ?? context.rules.general.engineer;
            }
            const validTiles = context.map.tiles
                .getInRectangle(target.tile, target.getFoundation())
                .filter((tile: any) => context.map.isWithinBounds(tile));
            let availableTiles = [...validTiles];
            for (const legacyCrewType of crewTypes) {
                const infantryRules = context.rules.getObject(legacyCrewType, ObjectType.Infantry);
                if (context.map.terrain.getPassableSpeed(target.tile, infantryRules.speedType, true, !target.isBuilding() && target.onBridge, undefined, true)) {
                    const unit = context.createUnitForPlayer(infantryRules, target.owner);
                    let spawnTile = availableTiles.length
                        ? availableTiles.splice(context.generateRandomInt(0, availableTiles.length - 1), 1)[0]
                        : undefined;
                    spawnTile = spawnTile || validTiles[context.generateRandomInt(0, validTiles.length - 1)];
                    if (unit.isInfantry()) {
                        unit.position.subCell = Infantry.SUB_CELLS[0];
                    }
                    if (unit.veteranTrait && target.owner.canProduceVeteran(unit.rules)) {
                        unit.veteranTrait.setVeteranLevel(VeteranLevel.Veteran);
                    }
                    context.spawnObject(unit, spawnTile);
                    if (target.isBuilding()) {
                        unit.unitOrderTrait.addTask(new ScatterTask(context, undefined, {
                            ignoredBlockers: target.isDestroyed ? undefined : [target]
                        }));
                    }
                }
            }
        }
    }
}
