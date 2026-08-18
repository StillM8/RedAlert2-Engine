import { ObjectType } from '@/engine/type/ObjectType';
import { TriggerAnimEvent } from '@/game/event/TriggerAnimEvent';
import { NotifyDestroy } from './interface/NotifyDestroy';
import type { AresRubbleOwner, AresRubbleTransition } from '@/extensions/ares/AresUrbanCombat';

/**
 * Runtime bridge for Ares Advanced Rubble.
 *
 * The source BuildingType owns the transition metadata. Destruction is allowed
 * to finish through the normal Game.destroyObject transaction first; the
 * replacement is promoted on afterTick so tile occupation, owner accounting,
 * selection, and world iteration are never mutated recursively from a destroy
 * callback.
 */
export class AresAdvancedRubbleTrait implements NotifyDestroy {
    [NotifyDestroy.onDestroy](building: any, world: any): void {
        const transition: AresRubbleTransition | undefined = building.rules?.aresUrbanCombat?.rubbleDestroyed;
        if (!transition) return;
        const tile = building.tile;
        const owner = building.owner;
        world.afterTick(() => {
            if (building.isSpawned) {
                // LeaveRubble=yes keeps the disposed source occupying the map;
                // Advanced Rubble replaces it with another BuildingType, so
                // remove that vanilla shell before promoting the target type.
                world.unspawnObject(building);
            }
            AresAdvancedRubbleTrait.applyTransition(
                building,
                transition,
                world,
                tile,
                owner,
                true,
            );
        });
    }

    canRepairWithEngineer(building: any): boolean {
        return !!building?.rules?.aresUrbanCombat?.rubbleIntact;
    }

    /**
     * Restore a rubble type without consuming the engineer. Returns the new
     * building (if any) so callers can publish the normal repair event against
     * the restored object.
     */
    repairWithEngineer(building: any, engineer: any, world: any): any | undefined {
        const transition: AresRubbleTransition | undefined = building.rules?.aresUrbanCombat?.rubbleIntact;
        if (!transition || building.isDestroyed) return undefined;
        const tile = building.tile;
        const owner = building.owner;
        if (building.isSpawned) world.unspawnObject(building);
        const replacement = AresAdvancedRubbleTrait.applyTransition(
            building,
            transition,
            world,
            tile,
            owner,
            false,
        );
        building.dispose?.();
        return replacement;
    }

    private static applyTransition(
        source: any,
        transition: AresRubbleTransition,
        world: any,
        tile: any,
        sourceOwner: any,
        destroyedStage: boolean,
    ): any | undefined {
        if (transition.animation) {
            world.events?.dispatch?.(new TriggerAnimEvent(
                transition.animation,
                tile,
                source.position?.worldPosition?.clone?.() ?? source.position?.worldPosition,
                sourceOwner,
                source,
            ));
        }
        if (transition.remove || !transition.target) return undefined;
        if (!world.rules?.hasObject?.(transition.target, ObjectType.Building)) return undefined;

        let replacement: any;
        try {
            replacement = world.createObject(ObjectType.Building, transition.target);
        }
        catch {
            return undefined;
        }

        const nextOwner = AresAdvancedRubbleTrait.resolveOwner(
            transition.owner,
            sourceOwner,
            world,
        );
        if (nextOwner) world.changeObjectOwner(replacement, nextOwner);

        if (destroyedStage) {
            AresAdvancedRubbleTrait.forceRubbleRuntimeRules(replacement);
        }
        world.spawnObject(replacement, tile);
        AresAdvancedRubbleTrait.applyStrength(replacement, transition.strength, destroyedStage);
        return replacement;
    }

    private static forceRubbleRuntimeRules(building: any): void {
        // Never mutate the shared TechnoRules instance: clone only this object
        // while preserving the original prototype/methods.
        const sourceRules = building.rules;
        const rules = Object.assign(
            Object.create(Object.getPrototypeOf(sourceRules)),
            sourceRules,
            {
                capturable: false,
                togglePower: false,
                unsellable: true,
                canBeOccupied: false,
            },
        );
        building.rules = rules;
        if (building.garrisonTrait) {
            building.traits?.remove?.(building.garrisonTrait);
            building.garrisonTrait = undefined;
        }
        building.poweredTrait?.setTurnedOn?.(true);
    }

    private static applyStrength(building: any, strength: number, destroyedStage: boolean): void {
        if (!building?.healthTrait) return;
        if (!destroyedStage && strength === -1) {
            building.healthTrait.health = 1;
            return;
        }
        // Destroyed Strength=0 is Ares' full-strength sentinel. New objects are
        // already full health, so no mutation is necessary.
        if (destroyedStage && strength === 0) return;
        if (Number.isFinite(strength) && strength > 0) {
            const max = Number((building.healthTrait as any).maxHitPoints ?? strength);
            building.healthTrait.setHitPoints(Math.max(1, Math.min(max, Math.floor(strength))));
        }
    }

    private static resolveOwner(selector: AresRubbleOwner, fallback: any, world: any): any {
        if (selector === 'default') return fallback;
        const players = world.playerList?.getAll?.() ?? world.getAllPlayers?.() ?? [];
        const byCountry = (pattern: RegExp) => players.find((player: any) =>
            pattern.test(String(player.country?.name ?? player.country?.id ?? '')),
        );
        if (selector === 'civilian') {
            return byCountry(/^civilian$/i) ?? players.find((player: any) => player.isNeutral) ?? fallback;
        }
        if (selector === 'special') {
            return byCountry(/^special$/i) ?? players.find((player: any) => player.isNeutral) ?? fallback;
        }
        if (selector === 'neutral') {
            return players.find((player: any) => player.isNeutral) ?? fallback;
        }
        return fallback;
    }
}
