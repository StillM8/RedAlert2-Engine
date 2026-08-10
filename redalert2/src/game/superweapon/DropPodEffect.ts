import { ObjectType } from "@/engine/type/ObjectType";
import type { AresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { SpeedType } from "@/game/type/SpeedType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import {
    discardUnspawnedObject,
    findDeliveryTile,
    resolveUnitDeliveryType,
    type UnitDeliveryGame,
} from "@/game/superweapon/UnitDeliveryEffect";
import { SuperWeaponEffect, type TileCoord } from "@/game/superweapon/SuperWeaponEffect";
import type { Game } from "@/game/Game";
import type { Player } from "@/game/Player";

export interface AresDropPodConfiguration {
    types: readonly string[];
    minimum: number;
    maximum: number;
    veterancy: number;
}

type DropPodDefinition = Pick<
    AresSuperWeaponDefinition,
    "dropPodTypes" | "dropPodMinimum" | "dropPodMaximum" | "dropPodVeterancy"
>;

interface DropPodGame extends UnitDeliveryGame {
    rules: UnitDeliveryGame["rules"] & {
        general?: UnitDeliveryGame["rules"]["general"] & {
            veteran?: { veteranCap?: number };
        };
    };
    generateRandomInt(min: number, max: number): number;
}

function finiteInteger(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) ? Math.floor(value as number) : fallback;
}

function finiteNonNegativeInteger(value: number | undefined, fallback: number): number {
    return Math.max(0, finiteInteger(value, fallback));
}

function normalizedTypes(values: readonly string[] | undefined): string[] {
    return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

/**
 * Resolve the effective DropPod settings exactly once at activation time.
 * Antares uses per-superweapon values when the vector/value is present and
 * falls back to [General] for the type list and count bounds.  Its custom SW
 * default veterancy is two (elite), capped by the active VeteranCap.
 */
export function resolveAresDropPodConfiguration(
    definition: DropPodDefinition,
    general: DropPodGame["rules"]["general"] = {},
): AresDropPodConfiguration {
    const localTypes = normalizedTypes(definition.dropPodTypes);
    const types = localTypes.length > 0
        ? localTypes
        : normalizedTypes(general.dropPodTypes);
    const minimum = finiteNonNegativeInteger(
        definition.dropPodMinimum ?? general.dropPodMinimum,
        0,
    );
    const configuredMaximum = finiteNonNegativeInteger(
        definition.dropPodMaximum ?? general.dropPodMaximum,
        0,
    );
    // Invalid reversed ranges are made deterministic and non-negative.  The
    // original RandomRanged call assumes a valid inclusive range.
    const maximum = Math.max(minimum, configuredMaximum);
    const veteranCap = Math.max(
        VeteranLevel.None,
        finiteInteger(general.veteran?.veteranCap, VeteranLevel.Elite),
    );
    const veterancy = Math.min(
        veteranCap,
        Math.max(0, Number.isFinite(definition.dropPodVeterancy)
            ? definition.dropPodVeterancy as number
            : VeteranLevel.Elite),
    );
    return { types, minimum, maximum, veterancy };
}

/**
 * Ares stores DropPod veterancy as a floating-point promotion value.  The
 * standalone runtime exposes integer veteran levels plus relative XP, so a
 * fractional value is applied as progress toward the next promotion instead
 * of being rounded away.  This preserves values such as 1.5.
 */
export function applyAresDropPodVeterancy(object: any, veterancy: number, veteranCap: number): void {
    const target = Math.min(
        Math.max(0, veterancy),
        Math.max(VeteranLevel.None, veteranCap),
    );
    const current = Number(object.veteranTrait?.veteranLevel ?? object.veteranLevel ?? VeteranLevel.None);
    if (!Number.isFinite(target) || target <= current) return;

    if (typeof object.veteranTrait?.setRelativeXP === "function") {
        object.veteranTrait.setRelativeXP(target - current);
    }
    else if (typeof object.veteranTrait?.setVeteranLevel === "function") {
        object.veteranTrait.setVeteranLevel(Math.floor(target));
    }
    else if (object.veteranLevel !== undefined) {
        object.veteranLevel = Math.floor(target);
    }
    object.dropPodVeterancy = target;
}

/**
 * Native TypeScript equivalent of Antares' SW_DropPod::Activate.  The host
 * currently materializes the unit at the first valid landing cell; the
 * DropPod locomotor/trailer presentation is intentionally represented as a
 * separate compatibility gap rather than silently claiming it is complete.
 */
export class DropPodEffect extends SuperWeaponEffect {
    private completed = false;

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
        if (this.completed) return true;
        this.completed = true;
        this.placeUnits(game as unknown as DropPodGame);
        return true;
    }

    private placeUnits(game: DropPodGame): void {
        const general = game.rules.general ?? {};
        const configuration = resolveAresDropPodConfiguration(this.rules, general);
        if (!configuration.types.length) {
            console.error(`DropPod superweapon could not launch: no DropPod.Types or General.DropPodTypes are configured.`);
            return;
        }

        const requestedCount = game.generateRandomInt(configuration.minimum, configuration.maximum);
        let remaining = Math.max(0, requestedCount);
        const attempts = remaining * 3;
        const veteranCap = Math.max(
            VeteranLevel.None,
            finiteInteger(general.veteran?.veteranCap, VeteranLevel.Elite),
        );

        for (let attempt = 0; attempt < attempts && remaining > 0; attempt++) {
            const name = configuration.types[game.generateRandomInt(0, configuration.types.length - 1)];
            if (!name) continue;

            const type = resolveUnitDeliveryType(game.rules, name);
            if (type === undefined) {
                console.warn(`DropPod superweapon references unknown TechnoType "${name}"; skipped.`);
                continue;
            }
            if (type === ObjectType.Building) {
                // Antares aborts the whole activation as soon as a configured
                // random selection resolves to a BuildingType.
                console.error(`DropPod superweapon contains building type "${name}"; aborting activation.`);
                break;
            }

            let object: any;
            try {
                object = game.createObject(type, name);
                game.changeObjectOwner(object, this.owner);
                if (object.rules?.speedType === undefined) {
                    object.rules.speedType = SpeedType.Wheel;
                }
                applyAresDropPodVeterancy(object, configuration.veterancy, veteranCap);

                const landingTile = findDeliveryTile(game, object, this.tile);
                if (!landingTile) {
                    console.warn(`DropPod could not find a valid landing cell for "${name}"; skipped.`);
                    discardUnspawnedObject(object);
                    continue;
                }

                // This metadata is deliberately small and serializable.  It
                // gives later DropPod locomotor/presentation work a stable
                // landing origin without changing simulation identity today.
                object.dropPodState = {
                    phase: "landed",
                    target: { rx: this.tile.rx, ry: this.tile.ry },
                };
                game.spawnObject(object, landingTile);

                if (object.isAircraft?.()) {
                    object.onBridge = false;
                    object.position.tileElevation = object.rules?.flightLevel ?? general.flightLevel ?? 0;
                    object.zone = ZoneType.Air;
                }
                remaining--;
            }
            catch (error) {
                console.warn(`DropPod failed to place "${name}"; skipped.`, error);
                if (object && !object.isSpawned) discardUnspawnedObject(object);
            }
        }
    }
}
