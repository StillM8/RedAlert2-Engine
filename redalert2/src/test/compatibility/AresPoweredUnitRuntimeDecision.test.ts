import { describe, expect, test } from "bun:test";
import { resolveAresPoweredUnitState } from "@/extensions/ares/AresPoweredUnitRuntime";

describe("Ares PoweredBy unit state decision", () => {
    test("requests power-up when an online provider finds a deactivated unit", () => {
        expect(resolveAresPoweredUnitState({
            providerOnline: true,
            deactivated: true,
            operated: true,
        })).toEqual({
            powered: true,
            transition: "power-up",
            mayClearEmp: true,
        });
    });

    test("requests power-down when an unpowered live unit is not inside a building", () => {
        expect(resolveAresPoweredUnitState({
            providerOnline: false,
            deactivated: false,
            isUnit: true,
            insideBuilding: false,
        })).toEqual({
            powered: false,
            transition: "power-down",
            mayClearEmp: false,
        });
    });

    test("holds an unpowered unit inside a building instead of powering it down", () => {
        expect(resolveAresPoweredUnitState({
            providerOnline: false,
            deactivated: false,
            isUnit: true,
            insideBuilding: true,
        })).toEqual({
            powered: false,
            transition: "hold",
            mayClearEmp: false,
        });
    });

    test("holds already-deactivated units and does not clear EMP when gates fail", () => {
        expect(resolveAresPoweredUnitState({
            providerOnline: false,
            deactivated: true,
        })).toEqual({
            powered: false,
            transition: "hold",
            mayClearEmp: false,
        });
        expect(resolveAresPoweredUnitState({
            providerOnline: true,
            deactivated: true,
            underEMP: true,
            operated: false,
        })).toEqual({
            powered: true,
            transition: "power-up",
            mayClearEmp: false,
        });
    });
});
