import { ObjectType } from "@/engine/type/ObjectType";
import type { AresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { SpeedType } from "@/game/type/SpeedType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
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

export interface AresDropPodPresentation {
    weaponName?: string;
    trailerAnimation: string;
}

type DropPodDefinition = Pick<
    AresSuperWeaponDefinition,
    "dropPodTypes" | "dropPodMinimum" | "dropPodMaximum" | "dropPodVeterancy"
>;

interface DropPodGame extends UnitDeliveryGame {
    rules: UnitDeliveryGame["rules"] & {
        general?: UnitDeliveryGame["rules"]["general"] & {
            veteran?: { veteranCap?: number };
            dropPodWeapon?: string;
            dropPodTrailer?: string;
        };
    };
    generateRandomInt(min: number, max: number): number;
    events?: { dispatch?: (event: any) => void };
    createTarget?: (object: any, tile: any) => any;
    createLooseProjectile?: (weaponName: string, owner: any, target: any) => any;
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

function normalizedOptionalName(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    const compact = normalized.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
    return compact === "none" || compact === "notaweapon" ? undefined : normalized;
}

/** Resolve the data-defined drop-pod impact weapon and smoke trailer. */
export function resolveAresDropPodPresentation(
    definition: Pick<AresSuperWeaponDefinition, "dropPodWeapon" | "dropPodTrailer">,
    general: DropPodGame["rules"]["general"] = {},
): AresDropPodPresentation {
    return {
        weaponName: normalizedOptionalName(definition.dropPodWeapon) ?? normalizedOptionalName(general?.dropPodWeapon),
        trailerAnimation: normalizedOptionalName(definition.dropPodTrailer) ??
            normalizedOptionalName(general?.dropPodTrailer) ??
            "SMOKEY",
    };
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
 * Native TypeScript equivalent of Antares' SW_DropPod::Activate. Ares accepts
 * InfantryTypes here; rejecting other TechnoTypes keeps invalid content from
 * being silently converted into a different delivery behavior.
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
        const presentation = resolveAresDropPodPresentation(this.rules, general);
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
            if (type !== ObjectType.Infantry) {
                // Ares' DropPod.Types is an InfantryType list. Invalid entries
                // consume this retry just like an invalid random selection;
                // the remaining pods may still be delivered.
                console.warn(`DropPod superweapon contains non-infantry type "${name}"; skipped.`);
                continue;
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

                // This metadata is deliberately small and serializable. It
                // gives the drop-pod presentation and save-state layers a
                // stable landing origin without changing simulation identity.
                object.dropPodState = {
                    phase: "landed",
                    target: { rx: this.tile.rx, ry: this.tile.ry },
                };
                game.spawnObject(object, landingTile);
                this.presentDropPodLanding(game, landingTile, presentation);

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

    private presentDropPodLanding(
        game: DropPodGame,
        landingTile: any,
        presentation: AresDropPodPresentation,
    ): void {
        // Ares creates the configured smoke trailer even when no impact
        // weapon exists. The shared animation event keeps this presentation
        // local to the renderer and deterministic in the simulation.
        game.events?.dispatch?.(new TriggerAnimEvent(
            presentation.trailerAnimation,
            landingTile,
            undefined,
            this.owner,
        ));

        const weaponName = presentation.weaponName;
        if (!weaponName || !game.createLooseProjectile || !game.createTarget) return;
        try {
            const projectile = game.createLooseProjectile(
                weaponName,
                this.owner,
                game.createTarget(undefined, landingTile),
            );
            if (!projectile) return;
            if (projectile.position?.moveToTileCoords) {
                projectile.position.moveToTileCoords(landingTile.rx + 0.5, landingTile.ry + 0.5);
            }
            else if (projectile.position) {
                projectile.position.tile = landingTile;
            }
            if (projectile.position) {
                projectile.position.tileElevation = projectile.rules?.detonationAltitude ?? 0;
            }
            game.spawnObject(projectile, projectile.position?.tile ?? landingTile);
        }
        catch (error) {
            // Optional content must not make a valid DropPod activation fail.
            console.warn(`DropPod impact weapon "${weaponName}" could not be spawned.`, error);
        }
    }
}
