import { Action } from './Action';
import { ActionType } from './ActionType';
import { DataStream } from '@/data/DataStream';

/**
 * Ares remote Ivan-bomb detonation (IvanBomb.CanDetonateTimeBomb /
 * IvanBomb.CanDetonateDeathBomb). The player who planted an active bomb may
 * detonate it early through the documented detonator control; eligibility
 * comes from the bomb's own CanDetonate* rules. Processing is fully
 * deterministic and drops malformed requests instead of aborting the tick.
 */
export class DetonateIvanBombsAction extends Action {
    private objectId = 0;

    constructor(private readonly game: any) {
        super(ActionType.DetonateIvanBombs);
    }

    setObjectId(objectId: number): void {
        this.objectId = objectId;
    }

    unserialize(data: Uint8Array): void {
        const stream = new DataStream(data);
        this.objectId = stream.readUint32();
    }

    serialize(): Uint8Array {
        const stream = new DataStream(4);
        stream.dynamicSize = false;
        stream.writeUint32(this.objectId);
        return stream.toUint8Array();
    }

    print(): string {
        return `Detonate Ivan bomb on object ${this.objectId}`;
    }

    process(): void {
        const object = this.game.getObjectById(this.objectId);
        const trait = object?.tntChargeTrait;
        if (!object || !trait || typeof trait.hasCharge !== "function" || !trait.hasCharge()) {
            console.warn(`No active Ivan bomb on object ${this.objectId}; ignored`);
            return;
        }
        const owner = typeof trait.getChargeOwner === "function" ? trait.getChargeOwner() : undefined;
        if (owner && owner !== this.player) {
            console.warn(`Ivan bomb on object ${this.objectId} belongs to another player; ignored`);
            return;
        }
        if (!trait.tryManualDetonate(object, this.game)) {
            console.warn(`Ivan bomb on object ${this.objectId} cannot be manually detonated; ignored`);
        }
    }
}
