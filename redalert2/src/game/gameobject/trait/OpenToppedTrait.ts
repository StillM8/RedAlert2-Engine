import { Weapon } from "@/game/Weapon";
import { WeaponType } from "@/game/WeaponType";
import { ArmedTrait } from "@/game/gameobject/trait/ArmedTrait";
import { AttackTrait } from "@/game/gameobject/trait/AttackTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";

// OpenTopped=yes transports (YR Battle Fortress) fire their passengers' weapons.
// Pragmatic model: the transport itself is armed with the strongest armed
// passenger's primary weapon; ROF is divided by the armed passenger count
// (same approximation Weapon uses for garrisoned buildings) and range gains
// [CombatDamage] OpenToppedRangeBonus. The transport's own primary (BFRT's
// 20mmRapid) is stashed and restored when the passengers leave.
export class OpenToppedTrait implements NotifyTick {
    private lastSignature: string = "";
    private armedPassengerCount: number = 0;
    private passengerWeapon?: Weapon;
    private armedPassenger?: any;
    private ownPrimaryWeapon?: Weapon;
    private attackDisabledByUs: boolean = false;

    getArmedPassengerCount(): number {
        return this.armedPassengerCount;
    }

    hasArmedPassengers(): boolean {
        return this.armedPassengerCount > 0;
    }

    getPassenger(): any | undefined {
        return this.armedPassenger;
    }

    [NotifyTick.onTick](transport: any, game: any): void {
        const armedPassengers = (transport.transportTrait?.units ?? []).filter((unit: any) => unit.isInfantry() &&
            unit.primaryWeapon &&
            // Weapons the transport can't safely proxy-fire: mind control needs a
            // mindControllerTrait on the shooter, limbo-launch would limbo the
            // transport itself, spawners need an airSpawnTrait.
            !unit.primaryWeapon.warhead.rules.mindControl &&
            !unit.primaryWeapon.rules.limboLaunch &&
            !unit.primaryWeapon.rules.spawner);
        this.armedPassengerCount = armedPassengers.length;
        const signature = armedPassengers
            .map((unit: any) => unit.primaryWeapon.name)
            .join(",");
        if (signature === this.lastSignature &&
            // Re-arm if something else rebuilt the weapons (e.g. elite promotion)
            (!signature || transport.armedTrait?.primaryWeapon === this.passengerWeapon)) {
            return;
        }
        this.lastSignature = signature;
        if (armedPassengers.length) {
            this.arm(transport, game, armedPassengers);
        }
        else {
            this.disarm(transport);
        }
    }

    private arm(transport: any, game: any, armedPassengers: any[]): void {
        const strongest = armedPassengers.reduce((best: any, unit: any) => (unit.primaryWeapon.rules.damage > best.primaryWeapon.rules.damage ? unit : best));
        this.armedPassenger = strongest;
        if (!transport.armedTrait) {
            transport.armedTrait = new ArmedTrait(transport, game.rules);
            transport.addTrait(transport.armedTrait);
        }
        if (transport.armedTrait.primaryWeapon !== this.passengerWeapon) {
            this.ownPrimaryWeapon = transport.armedTrait.primaryWeapon;
        }
        const weapon = Weapon.factory(strongest.primaryWeapon.name, WeaponType.Primary, transport, game.rules, transport.art.primaryFireFlh);
        weapon.rangeBonus = game.rules.combatDamage.openToppedRangeBonus;
        transport.armedTrait.primaryWeapon = weapon;
        this.passengerWeapon = weapon;
        if (!transport.attackTrait) {
            transport.attackTrait = new AttackTrait(game.map.tiles, game.map.tileOccupation);
            transport.addTrait(transport.attackTrait);
        }
        else if (this.attackDisabledByUs) {
            transport.attackTrait.setDisabled(false);
            this.attackDisabledByUs = false;
        }
    }

    private disarm(transport: any): void {
        if (this.passengerWeapon &&
            transport.armedTrait?.primaryWeapon === this.passengerWeapon) {
            transport.armedTrait.primaryWeapon = this.ownPrimaryWeapon;
        }
        this.passengerWeapon = undefined;
        this.armedPassenger = undefined;
        this.ownPrimaryWeapon = undefined;
        if (transport.attackTrait &&
            !transport.primaryWeapon &&
            !transport.secondaryWeapon &&
            !transport.attackTrait.isDisabled()) {
            transport.attackTrait.setDisabled(true);
            this.attackDisabledByUs = true;
        }
    }

    dispose(): void {
        this.passengerWeapon = undefined;
        this.armedPassenger = undefined;
        this.ownPrimaryWeapon = undefined;
    }
}
