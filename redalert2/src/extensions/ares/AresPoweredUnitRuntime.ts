/**
 * Pure state decisions for Ares PoweredBy units.
 *
 * Provider discovery and online checks live in AresTechnoRuntimeAdapters.
 * This file only translates the resulting provider state and the unit's
 * current deactivation context into a transition intent; it never mutates a
 * unit, applies EMP, cancels orders, or destroys an object.
 */

export type AresPoweredUnitTransition = "hold" | "power-up" | "power-down";

export interface AresPoweredUnitStateInput {
    providerOnline: boolean;
    deactivated: boolean;
    /** Antares only avoids power-down for a unit currently inside a building. */
    isUnit?: boolean;
    insideBuilding?: boolean;
    underEMP?: boolean;
    operated?: boolean;
}

export interface AresPoweredUnitStateDecision {
    powered: boolean;
    transition: AresPoweredUnitTransition;
    /** PowerUp may clear an EMP effect only when these Antares gates allow it. */
    mayClearEmp: boolean;
}

export function resolveAresPoweredUnitState(
    input: AresPoweredUnitStateInput,
): AresPoweredUnitStateDecision {
    const powered = input.providerOnline === true;
    const mayClearEmp = powered && input.underEMP !== true && input.operated !== false;

    if (powered) {
        return {
            powered,
            transition: input.deactivated ? "power-up" : "hold",
            mayClearEmp,
        };
    }

    const heldInsideBuilding = input.isUnit === true && input.insideBuilding === true;
    return {
        powered,
        transition: !input.deactivated && !heldInsideBuilding ? "power-down" : "hold",
        mayClearEmp: false,
    };
}
