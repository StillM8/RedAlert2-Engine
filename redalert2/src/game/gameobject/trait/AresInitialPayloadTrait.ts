import { ObjectType } from '@/engine/type/ObjectType';
import { getAresPassengerRules } from '@/extensions/ares/AresPassengers';
import { NotifySpawn } from './interface/NotifySpawn';

/**
 * Creates Ares InitialPayload once, when the host Techno first enters the
 * world. Payload objects are created directly in limbo and linked to the
 * carrier/garrison, so no transient map spawn or renderer state is involved.
 */
export class AresInitialPayloadTrait implements NotifySpawn {
    private initialized = false;

    [NotifySpawn.onSpawn](host: any, world: any): void {
        if (this.initialized) return;
        this.initialized = true;

        const extension = getAresPassengerRules(host.rules);
        if (!extension?.initialPayloadTypes.length || host.isInfantry?.()) return;

        const isBuilding = host.isBuilding?.() === true;
        const isTransport = !!host.transportTrait;
        const isGarrison = !!host.garrisonTrait;
        if (!isTransport && !isGarrison) return;

        for (let index = 0; index < extension.initialPayloadTypes.length; index++) {
            const typeName = extension.initialPayloadTypes[index];
            const count = extension.initialPayloadCounts[index] ?? 1;
            for (let n = 0; n < count; n++) {
                const payloadRules = this.resolvePayloadRules(world.rules, typeName, isBuilding);
                if (!payloadRules) break;

                // Ares deliberately does not support recursive InitialPayload
                // types because that could create an unbounded object tree.
                if (getAresPassengerRules(payloadRules)?.initialPayloadTypes.length) break;

                const payload = world.createUnitForPlayer(payloadRules, host.owner);
                world.applyInitialVeteran?.(payload, host.owner);
                payload.limboData = {
                    selected: false,
                    controlGroup: undefined,
                    inTransport: true,
                };

                if (isGarrison) {
                    if (!host.garrisonTrait.addInitialOccupant(payload, world)) {
                        this.discardUnspawned(payload);
                        break;
                    }
                }
                else if (isTransport) {
                    if (!host.transportTrait.unitFitsInside(payload)) {
                        this.discardUnspawned(payload);
                        break;
                    }
                    host.transportTrait.units.push(payload);
                }
            }
        }
        // Operator state is tick-owned. The passengers exist before the first
        // gameplay tick, so the existing trait observes the correct state.
    }

    private resolvePayloadRules(rules: any, typeName: string, buildingHost: boolean): any | undefined {
        const types = buildingHost
            ? [ObjectType.Infantry]
            : [ObjectType.Infantry, ObjectType.Vehicle];
        for (const type of types) {
            if (rules.hasObject?.(typeName, type)) {
                return rules.getObject(typeName, type);
            }
        }
        // BuildingType and AircraftType payloads are invalid in Ares, and a
        // building host may only receive InfantryType payload.
        return undefined;
    }

    private discardUnspawned(payload: any): void {
        payload.owner?.removeOwnedObject?.(payload);
        payload.dispose?.();
    }
}
