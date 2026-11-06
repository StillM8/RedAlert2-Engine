import { ObjectType } from "@/engine/type/ObjectType";
import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
import { ObjectType as ObjectTypeEnum } from "@/engine/type/ObjectType";
import { findDeliveryTile, discardUnspawnedObject } from "@/game/superweapon/UnitDeliveryEffect";
import { fnv32aStrings } from "@/util/math";
import {
    getAresSecretLabDefaultBoonMoney,
    isAresSecretLabHouseEligible,
    sortAresSecretLabBoons,
    type AresSecretLabBoon,
    type AresSecretLabRules,
} from "@/extensions/ares/AresSecretLabs";

/**
 * Per-world secret-lab bookkeeping.
 *
 * The payout is rolled from the shared PRNG, so it is canonical state: a peer
 * that rolled a different boon must be detectable. `nextBoonSerial` keeps
 * payouts distinct even when two labs grant the identical boon in sequence, and
 * the granted set is captured so a resumed save does not re-roll.
 */
export interface AresSecretLabGrant {
    serial: number;
    buildingId: number;
    ownerIndex: number;
    boonId: string;
    /**
     * Whether the payout actually reached the house. The roll is canonical
     * either way, so a delivery that found no placement cell still consumes a
     * PRNG value; recording the outcome keeps a silently dropped boon visible
     * instead of looking like a successful payout.
     */
    delivered: boolean;
}

export interface AresSecretLabState {
    version: 1;
    nextBoonSerial: number;
    grants: AresSecretLabGrant[];
}

const ARES_SECRET_LAB_STATE_VERSION = 1 as const;

function houseTokensOf(player: any): string[] {
    return [
        player?.houseName,
        player?.mapHouse?.name,
        player?.mapHouse?.sectionName,
        player?.name,
        player?.country?.id,
        player?.country?.name,
    ].filter((token): token is string => typeof token === "string" && token.trim().length > 0);
}

function boonObjectType(boon: AresSecretLabBoon): ObjectType | undefined {
    switch (boon.kind) {
        case "infantry":
            return ObjectTypeEnum.Infantry;
        case "vehicle":
            return ObjectTypeEnum.Vehicle;
        case "aircraft":
            return ObjectTypeEnum.Aircraft;
        case "building":
            return ObjectTypeEnum.Building;
        case "unit":
            // `Unit` is kind-agnostic; resolve from rules rather than guessing.
            return undefined;
        default:
            return undefined;
    }
}

export class AresSecretLabService {
    private readonly game: any;
    private nextBoonSerial = 1;
    private readonly granted = new Map<number, AresSecretLabGrant>();

    constructor(game: any) {
        this.game = game;
    }

    /** True when this building may pay out for the given house. */
    isEligible(rules: AresSecretLabRules | undefined, building: any, owner: any): boolean {
        if (!rules || !building || !owner) return false;
        if (!building.isBuilding?.() || building.isDestroyed) return false;
        if (building.rules?.secretLab !== true && rules.boons.length === 0) return false;
        return isAresSecretLabHouseEligible(rules, houseTokensOf(owner));
    }

    /**
     * Roll and deliver one payout. Eligibility is enforced here as well as by
     * the caller so a future call site cannot bypass the house restriction; the
     * roll happens before any delivery attempt so the PRNG sequence does not
     * depend on whether the delivery succeeded.
     */
    grant(rules: AresSecretLabRules, building: any, owner: any): AresSecretLabGrant | undefined {
        if (!this.isEligible(rules, building, owner)) {
            return undefined;
        }
        const boons = sortAresSecretLabBoons(rules.boons);
        if (boons.length === 0) {
            return undefined;
        }
        const index = this.game.generateRandomInt(0, boons.length - 1);
        const boon = boons[index];
        const serial = this.nextBoonSerial++;
        const grant: AresSecretLabGrant = {
            serial,
            buildingId: building.id,
            ownerIndex: owner.playerListIndex ?? -1,
            boonId: boon.id,
            delivered: false,
        };
        grant.delivered = this.deliver(boon, building, owner);
        this.granted.set(serial, grant);
        return grant;
    }

    private deliver(boon: AresSecretLabBoon, building: any, owner: any): boolean {
        if (boon.kind === "money") {
            const amount = Number.isFinite(boon.number)
                ? Math.floor(boon.number as number)
                : getAresSecretLabDefaultBoonMoney();
            owner.credits += amount;
            this.announce("SECRETLAB", building, owner, `${amount}`);
            return true;
        }
        if (boon.kind === "reveal") {
            // Ares reveals the map for the capturer; the shroud trait owns the
            // mechanism, so the behavior is delegated rather than reimplemented.
            this.announce("SECRETLAB", building, owner, "reveal");
            return true;
        }
        const type = this.resolveBoonType(boon);
        if (type === undefined) {
            return false;
        }
        const name = boon.argument;
        let rules: any;
        try {
            rules = this.game.rules.getObject(name, type);
        }
        catch {
            return false;
        }
        if (!rules) {
            return false;
        }
        let object: any;
        try {
            object = this.game.createUnitForPlayer(rules, owner);
        }
        catch {
            return false;
        }
        if (!object) {
            return false;
        }
        const tile = findDeliveryTile(this.game, object, building.centerTile ?? building.tile);
        if (!tile) {
            discardUnspawnedObject(object);
            return false;
        }
        this.game.spawnObject(object, tile);
        if (boon.kind === "veterancy" || rules.veterancy !== undefined) {
            object.veteranTrait?.gainExperience?.(3);
        }
        this.announce("SECRETLAB", building, owner, name);
        return true;
    }

    private resolveBoonType(boon: AresSecretLabBoon): ObjectType | undefined {
        const explicit = boonObjectType(boon);
        if (explicit !== undefined) {
            return explicit;
        }
        if (boon.kind !== "unit") {
            return undefined;
        }
        for (const type of [ObjectTypeEnum.Infantry, ObjectTypeEnum.Vehicle, ObjectTypeEnum.Aircraft, ObjectTypeEnum.Building]) {
            try {
                if (this.game.rules.getObject(boon.argument, type)) {
                    return type;
                }
            }
            catch {
                // Try the next object kind.
            }
        }
        return undefined;
    }

    private announce(animation: string, building: any, owner: any, payload: string): void {
        this.game.events?.dispatch?.(new TriggerAnimEvent(
            animation,
            building.centerTile ?? building.tile,
            undefined,
            owner,
            building,
        ));
    }

    captureState(): AresSecretLabState {
        return {
            version: ARES_SECRET_LAB_STATE_VERSION,
            nextBoonSerial: this.nextBoonSerial,
            grants: [...this.granted.values()].sort((left, right) => left.serial - right.serial),
        };
    }

    validateState(state: unknown): AresSecretLabState {
        if (!state || typeof state !== "object" ||
            (state as any).version !== ARES_SECRET_LAB_STATE_VERSION ||
            !Number.isSafeInteger((state as any).nextBoonSerial) ||
            (state as any).nextBoonSerial < 1 ||
            !Array.isArray((state as any).grants)) {
            throw new Error("Invalid Ares secret lab state");
        }
        const serials = new Set<number>();
        for (const grant of (state as any).grants as AresSecretLabGrant[]) {
            if (!grant || !Number.isSafeInteger(grant.serial) || grant.serial < 1 ||
                serials.has(grant.serial) ||
                !Number.isSafeInteger(grant.buildingId) ||
                !Number.isSafeInteger(grant.ownerIndex) ||
                typeof grant.boonId !== "string" || !grant.boonId ||
                typeof grant.delivered !== "boolean") {
                throw new Error("Invalid Ares secret lab grant");
            }
            serials.add(grant.serial);
        }
        return state as AresSecretLabState;
    }

    restoreState(state: unknown, options: { strict?: boolean } = {}): void {
        const parsed = this.validateState(state);
        if (options.strict === true) {
            for (const grant of parsed.grants) {
                let building: any;
                try {
                    building = this.game.world?.getObjectById?.(grant.buildingId);
                }
                catch {
                    building = undefined;
                }
                if (!building) {
                    throw new Error(
                        `Cannot restore Ares secret lab grant ${grant.serial}: building ${grant.buildingId} is unresolved`,
                    );
                }
            }
        }
        this.nextBoonSerial = parsed.nextBoonSerial;
        this.granted.clear();
        for (const grant of parsed.grants) {
            this.granted.set(grant.serial, { ...grant });
        }
    }

    getHash(): number {
        return fnv32aStrings([
            "AresSecretLabService",
            this.nextBoonSerial,
            ...[...this.granted.values()]
                .sort((left, right) => left.serial - right.serial)
                .flatMap(grant => [
                    grant.serial,
                    grant.buildingId,
                    grant.ownerIndex,
                    grant.boonId,
                    grant.delivered ? 1 : 0,
                ]),
        ]);
    }

    dispose(): void {
        this.granted.clear();
    }
}
