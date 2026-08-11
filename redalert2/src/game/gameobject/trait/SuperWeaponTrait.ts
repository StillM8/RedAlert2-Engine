import { ObjectType } from '@/engine/type/ObjectType';
import { NotifyOwnerChange } from '@/game/gameobject/trait/interface/NotifyOwnerChange';
import { NotifySpawn } from '@/game/gameobject/trait/interface/NotifySpawn';
import { NotifyUnspawn } from '@/game/gameobject/trait/interface/NotifyUnspawn';
import { evaluateAresSuperWeaponAvailabilityForOwner } from '@/extensions/ares/AresSuperWeaponAvailability';
export class SuperWeaponTrait {
    private name: string;
    constructor(name: string) {
        this.name = name;
    }
    getSuperWeapon(gameObject: any) {
        return gameObject.owner.superWeaponsTrait?.get(this.name);
    }
    [NotifySpawn.onSpawn](gameObject: any, world: any): void {
        this.addSuperWeaponToPlayerIfNeeded(gameObject.owner, world);
    }
    [NotifyUnspawn.onUnspawn](gameObject: any, world: any): void {
        this.removeSuperWeaponFromPlayerIfNeeded(gameObject.owner, world);
    }
    [NotifyOwnerChange.onChange](gameObject: any, oldOwner: any, newOwner: any): void {
        this.removeSuperWeaponFromPlayerIfNeeded(oldOwner, newOwner);
        this.addSuperWeaponToPlayerIfNeeded(gameObject.owner, newOwner);
    }
    private addSuperWeaponToPlayerIfNeeded(player: any, world: any): void {
        if (!player.superWeaponsTrait || player.superWeaponsTrait.has(this.name)) return;
        const rules = world?.rules?.getSuperWeapon?.(this.name);
        if (rules?.ares && !evaluateAresSuperWeaponAvailabilityForOwner(
            rules.ares,
            player,
            this.name,
            player.superWeaponsTrait.getAresShotsFired?.(this.name, player) ?? 0,
        ).available) return;
        const superWeapon = world.createSuperWeapon(this.name, player);
        player.superWeaponsTrait.add(superWeapon);
        if (superWeapon.rules.isPowered && player.powerTrait?.isLowPower()) {
            superWeapon.pauseTimer();
        }
    }
    private removeSuperWeaponFromPlayerIfNeeded(player: any, world?: any): void {
        const superWeaponsTrait = player.superWeaponsTrait;
        if (!superWeaponsTrait)
            return;
        const hasBuildingWithSuperWeapon = player
            .getOwnedObjectsByType(ObjectType.Building)
            .some(building => building.superWeaponTrait?.name === this.name);
        const superWeapon = superWeaponsTrait.get(this.name);
        if (!superWeapon || superWeapon.isGift) return;
        const rules = world?.rules?.getSuperWeapon?.(this.name);
        if (rules?.ares) {
            const available = evaluateAresSuperWeaponAvailabilityForOwner(
                rules.ares,
                player,
                this.name,
                superWeapon.shotsFired ?? superWeaponsTrait.getAresShotsFired?.(this.name, player) ?? 0,
            ).available;
            if (!available) superWeaponsTrait.remove(this.name);
            return;
        }
        if (!hasBuildingWithSuperWeapon) {
            superWeaponsTrait.remove(this.name);
        }
    }
}
