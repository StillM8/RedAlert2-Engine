import { describe, expect, test } from "bun:test";
import { DeactivateSuperWeaponAction } from "@/game/action/DeactivateSuperWeaponAction";
import { ActionType } from "@/game/action/ActionType";
import { CombatantUi } from "@/gui/screen/game/CombatantUi";
import { isAresSuperWeaponTargetType } from "@/extensions/ares/AresSuperWeapons";
import { resolveAresSuperWeaponAITargeting } from "@/extensions/ares/AresSuperWeaponAI";
import { setAresPreferredTargetingCell } from "@/extensions/ares/AresSuperWeaponTargetingCell";
import {
    matchesAresSuperWeaponTarget,
    planAresSuperWeaponTarget,
    type AresSuperWeaponPlannerInput,
    type AresSuperWeaponTargetUnit,
} from "@/extensions/ares/AresSuperWeaponTargetPlanner";
import { SuperWeapon, SuperWeaponStatus } from "@/game/SuperWeapon";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";

const customTypes = [
    "Firestorm",
    "GenericWarhead",
    "UnitDelivery",
    "EMPulse",
    "DropPod",
    "HunterSeeker",
    "Battery",
    "SonarPulse",
    "ChronoWarp",
];

function unit(
    id: number,
    x: number,
    y: number,
    over: Partial<AresSuperWeaponTargetUnit> = {},
): AresSuperWeaponTargetUnit {
    return {
        id,
        x,
        y,
        targetKind: "infantry",
        houseRelation: "enemies",
        ...over,
    };
}

function input(over: Partial<AresSuperWeaponPlannerInput> = {}): AresSuperWeaponPlannerInput {
    return {
        profile: resolveAresSuperWeaponAITargeting({
            typeId: "GenericWarhead",
            extensionType: "GenericWarhead",
        }),
        units: [],
        cells: [],
        ...over,
    };
}

describe("Ares custom superweapon launch controls", () => {
    test("accepts every documented string-only custom type for sidebar targeting", () => {
        for (const extensionType of customTypes) {
            expect(isAresSuperWeaponTargetType({ type: undefined, ares: { extensionType } })).toBe(true);
        }
        expect(isAresSuperWeaponTargetType({ type: undefined, ares: { extensionType: "Unknown" } })).toBe(false);
    });

    test("routes a custom ready item through the launch path", () => {
        const calls: any[] = [];
        const rules = { type: undefined, index: 12, ares: { extensionType: "GenericWarhead" } };
        const ui: any = Object.create((CombatantUi as any).prototype);
        ui.worldInteraction = { isEnabled: () => true };
        ui.player = {
            superWeaponsTrait: {
                getAll: () => [{ rules, status: SuperWeaponStatus.Ready }],
            },
        };
        ui.sound = { play: () => undefined };
        ui.pushAction = () => undefined;
        ui.activateSuperWeaponFromSidebar = (value: any) => calls.push(value);
        (CombatantUi as any).prototype.handleSidebarSlotClick.call(ui, {
            target: { type: 1, rules },
            button: 0,
        });
        expect(calls).toEqual([rules]);
    });

    test("routes an active charge-drain item through the deactivation action", () => {
        const calls: any[] = [];
        const rules = { type: undefined, index: 13, ares: { extensionType: "Battery" } };
        const ui: any = Object.create((CombatantUi as any).prototype);
        ui.worldInteraction = { isEnabled: () => true };
        ui.player = {
            superWeaponsTrait: {
                getAll: () => [{ rules, status: SuperWeaponStatus.Draining }],
            },
        };
        ui.sound = { play: () => undefined };
        ui.pushAction = (type: ActionType, configure: (action: any) => void) => {
            const action: any = {};
            configure(action);
            calls.push({ type, action });
        };
        ui.activateSuperWeaponFromSidebar = () => {
            throw new Error("draining weapons must not enter targeting mode");
        };
        (CombatantUi as any).prototype.handleSidebarSlotClick.call(ui, {
            target: { type: 1, rules },
            button: 0,
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].type).toBe(ActionType.DeactivateSuperWeapon);
        expect(calls[0].action.superWeaponType).toBe(13);
    });
});

describe("Ares charge-drain deactivation action", () => {
    function makeGame(weapon: SuperWeapon, owner: any) {
        owner.superWeaponsTrait = { getAll: () => [weapon] };
        const trait = new SuperWeaponsTrait();
        return {
            rules: { getSuperWeaponByIndex: () => weapon.rules },
            traits: { get: () => trait },
        } as any;
    }

    test("stops an owned draining weapon", () => {
        const owner: any = { credits: 0 };
        const weapon = new SuperWeapon("Battery", {
            rechargeTime: 1,
            ares: { useChargeDrain: true, swUnstoppable: false },
        }, owner);
        weapon.rules.index = 21;
        weapon.rechargeTicks = 10;
        weapon.chargeTicks = 4;
        weapon.status = SuperWeaponStatus.Draining;
        const game = makeGame(weapon, owner);
        const action: any = new DeactivateSuperWeaponAction(game);
        action.player = owner;
        action.superWeaponType = 21;
        action.process();
        expect(weapon.status).toBe(SuperWeaponStatus.Charging);
    });

    test("rejects an unstoppable weapon and a different owner", () => {
        const owner: any = { credits: 0 };
        const weapon = new SuperWeapon("Battery", {
            rechargeTime: 1,
            ares: { useChargeDrain: true, swUnstoppable: true },
        }, owner);
        weapon.rules.index = 22;
        weapon.rechargeTicks = 10;
        weapon.chargeTicks = 4;
        weapon.status = SuperWeaponStatus.Draining;
        const game = makeGame(weapon, owner);
        const action: any = new DeactivateSuperWeaponAction(game);
        action.player = owner;
        action.superWeaponType = 22;
        action.process();
        expect(weapon.status).toBe(SuperWeaponStatus.Draining);
        action.player = { superWeaponsTrait: { getAll: () => [weapon] } };
        action.process();
        expect(weapon.status).toBe(SuperWeaponStatus.Draining);
    });
});

describe("canonical Ares superweapon target planner", () => {
    test("selects deterministic threat, stealth, and offensive clusters", () => {
        const units = [
            unit(4, 30, 30, { targetKind: "buildings", value: 5, threat: 5 }),
            unit(2, 10, 10, { targetKind: "units", value: 50, threat: 50 }),
            unit(3, 11, 10, { targetKind: "infantry", value: 1, threat: 1, isCloaked: true }),
            unit(1, 40, 40, { targetKind: "buildings", value: 10, threat: 10 }),
        ];
        const cells = units.map((entry) => ({ x: entry.x, y: entry.y, zone: ZoneType.Ground }));
        const offensive = input({ units: [...units].reverse(), cells });
        expect(planAresSuperWeaponTarget(offensive)).toEqual({ x: 10, y: 10 });

        const stealth = input({
            profile: resolveAresSuperWeaponAITargeting({ swAITargeting: "Stealth" }),
            units: [...units].reverse(),
            cells,
        });
        expect(planAresSuperWeaponTarget(stealth)).toEqual({ x: 11, y: 10 });

        const threat = input({
            profile: resolveAresSuperWeaponAITargeting({
                swAITargeting: "MultiMissile",
                swAIRequiresTarget: "units",
            }),
            units: [...units].reverse(),
            cells,
        });
        expect(planAresSuperWeaponTarget(threat)).toEqual({ x: 10, y: 10 });
    });

    test("supports own, base, self, no-target, random, and empty-cell modes", () => {
        const own = unit(1, 3, 4, { houseRelation: "owner", targetKind: "buildings", value: 10 });
        const base = input({
            profile: resolveAresSuperWeaponAITargeting({ swAITargeting: "Base" }),
            units: [own],
        });
        expect(planAresSuperWeaponTarget(base)).toEqual({ x: 3, y: 4 });

        const self = input({
            profile: resolveAresSuperWeaponAITargeting({ swAITargeting: "Self" }),
            selfTargets: [{ x: 8, y: 9 }],
        });
        expect(planAresSuperWeaponTarget(self)).toEqual({ x: 8, y: 9 });

        const noTarget = input({
            profile: resolveAresSuperWeaponAITargeting({ swAITargeting: "NoTarget" }),
            startLocation: { x: 6, y: 7 },
        });
        expect(planAresSuperWeaponTarget(noTarget)).toEqual({ x: 6, y: 7 });

        const cells = [
            { x: 1, y: 1, zone: ZoneType.Ground },
            { x: 2, y: 2, zone: ZoneType.Water },
        ];
        const empty = input({
            profile: resolveAresSuperWeaponAITargeting({ swAITargeting: "NoTarget" }),
            cells,
        });
        expect(planAresSuperWeaponTarget(empty)).toEqual({ x: 1, y: 1 });

        const random = input({
            profile: resolveAresSuperWeaponAITargeting({ swAITargeting: "LightningRandom" }),
            cells,
            randomCell: () => ({ x: 2, y: 2 }),
        });
        expect(planAresSuperWeaponTarget(random)).toEqual({ x: 2, y: 2 });
    });

    test("allows Hunter Seeker with an enemy house but no visible unit", () => {
        const profile = resolveAresSuperWeaponAITargeting({ swAITargeting: "HunterSeeker" });
        const hunter = input({
            profile,
            startLocation: { x: 5, y: 6 },
            enemyBase: { x: 40, y: 41 },
            units: [],
        });
        expect(planAresSuperWeaponTarget(hunter)).toEqual({ x: 5, y: 6 });
        expect(planAresSuperWeaponTarget({
            ...hunter,
            enemyBase: undefined,
            enemyHouseExists: false,
        })).toBeUndefined();
    });

    test("applies constraints, preferences, and final target gates in order", () => {
        const profile = resolveAresSuperWeaponAITargeting({
            typeId: "GenericWarhead",
            extensionType: "GenericWarhead",
            swAITargeting: "Offensive",
            swAITargetingPreference: "Offensive",
            swAITargetingConstraints: "LowPower,Attacked,LightningStormInactive,OffensiveCellSet",
        });
        const player = {};
        const units = [unit(1, 2, 3), unit(2, 20, 21)];
        const base = input({ profile, units, cells: units.map((entry) => ({ x: entry.x, y: entry.y, zone: ZoneType.Ground })) });
        expect(planAresSuperWeaponTarget(base)).toBeUndefined();
        setAresPreferredTargetingCell(player, "offensive", { x: 2, y: 3 });
        const preferred = input({
            profile,
            units,
            cells: units.map((entry) => ({ x: entry.x, y: entry.y, zone: ZoneType.Ground })),
            preferredCells: { offensive: { x: 2, y: 3 } },
            lowPower: true,
            underAttack: true,
        });
        expect(planAresSuperWeaponTarget(preferred)).toEqual({ x: 2, y: 3 });
        const blocked = input({
            ...preferred,
            launchAllowed: (target) => target.x !== 2,
            activationAllowed: (target) => target.x === 20,
        });
        expect(planAresSuperWeaponTarget(blocked)).toBeUndefined();

        const gates = input({
            profile: resolveAresSuperWeaponAITargeting({ swAITargeting: "Offensive" }),
            units: [
                unit(1, 1, 1, { targetKind: "buildings" }),
                unit(2, 2, 2, { targetKind: "infantry" }),
            ],
            cells: [
                { x: 1, y: 1, zone: ZoneType.Ground },
                { x: 2, y: 2, zone: ZoneType.Ground },
            ],
            requiresTarget: "infantry",
            requiresHouse: "enemies",
        });
        expect(planAresSuperWeaponTarget(gates)).toEqual({ x: 2, y: 2 });

        const water = input({
            profile: resolveAresSuperWeaponAITargeting({
                swAITargeting: "Offensive",
                swAIRequiresTarget: "water",
            }),
            units: [
                unit(1, 1, 1, { targetKind: "units" }),
                unit(2, 2, 2, { targetKind: "units" }),
            ],
            cells: [
                { x: 1, y: 1, zone: ZoneType.Ground },
                { x: 2, y: 2, zone: ZoneType.Water },
            ],
        });
        expect(planAresSuperWeaponTarget(water)).toEqual({ x: 2, y: 2 });

        const active = input({
            profile: resolveAresSuperWeaponAITargeting({
                swAITargeting: "Offensive",
                swAITargetingConstraints: "LightningStormInactive",
            }),
            units: [unit(1, 1, 1)],
            cells: [{ x: 1, y: 1, zone: ZoneType.Ground }],
            lightningStormActive: true,
        });
        expect(planAresSuperWeaponTarget(active)).toBeUndefined();
    });

    test("does not run the simulation auto-fire pump for AI owners", () => {
        const calls: any[] = [];
        const player: any = {
            isAi: true,
            superWeaponsTrait: {
                getAll: () => [{
                    rules: {
                        index: 1,
                        ares: { swAutoFire: true, swAITargeting: "Offensive" },
                    },
                    status: SuperWeaponStatus.Ready,
                }],
            },
        };
        const world = { getCombatants: () => [player] };
        const trait: any = {
            hasActiveEffect: () => false,
            activateSuperWeapon: (...args: any[]) => calls.push(args),
        };
        (SuperWeaponsTrait.prototype as any).updateAresAutoFire.call(trait, world);
        expect(calls).toHaveLength(0);
    });

    test("keeps ordering stable for equal candidates and respects visibility", () => {
        const profile = resolveAresSuperWeaponAITargeting({ swAITargeting: "Offensive" });
        const first = unit(1, 9, 9, { value: 10 });
        const second = unit(2, 1, 1, { value: 10 });
        const selected = planAresSuperWeaponTarget(input({
            profile,
            units: [second, first],
            cells: [first, second].map((entry) => ({ x: entry.x, y: entry.y, zone: ZoneType.Ground })),
        }));
        expect(selected).toEqual({ x: 1, y: 1 });
        const hidden = unit(3, 4, 4, { visible: false });
        expect(planAresSuperWeaponTarget(input({
            profile,
            units: [hidden],
            cells: [{ x: 4, y: 4, zone: ZoneType.Ground, visible: false }],
        }))).toBeUndefined();
    });

    test("allows occupied cells for cell-only land and water masks", () => {
        const ground = unit(1, 4, 4, { targetKind: "units" });
        const water = unit(2, 5, 5, { targetKind: "units" });
        const groundCell = { x: 4, y: 4, zone: ZoneType.Ground };
        const waterCell = { x: 5, y: 5, zone: ZoneType.Water };

        expect(matchesAresSuperWeaponTarget("land", ground, groundCell, [ground])).toBe(true);
        expect(matchesAresSuperWeaponTarget("water", water, waterCell, [water])).toBe(true);
        expect(matchesAresSuperWeaponTarget("land,water", ground, groundCell, [ground])).toBe(true);
        expect(matchesAresSuperWeaponTarget("water", ground, groundCell, [ground])).toBe(false);
    });

    test("uses the local capturable cluster for Psychic Dominator", () => {
        const profile = resolveAresSuperWeaponAITargeting({ swAITargeting: "PsychicDominator" });
        const units = [
            unit(1, 10, 10, { targetKind: "units" }),
            unit(2, 11, 10, { targetKind: "infantry" }),
            unit(3, 10, 11, { targetKind: "units" }),
            unit(4, 20, 20, { targetKind: "units", isCloaked: true, value: 100 }),
            unit(5, 21, 20, { targetKind: "units", canBePermaMindControlled: false, value: 100 }),
        ];

        expect(planAresSuperWeaponTarget(input({
            profile,
            units,
            cells: units.map((entry) => ({ x: entry.x, y: entry.y, zone: ZoneType.Ground })),
        }))).toEqual({ x: 10, y: 10 });
    });

    test("keeps Dominator and Mutator selectors hostile with all-house defaults", () => {
        for (const mode of ["PsychicDominator", "GeneticMutator"]) {
            const units = [
                unit(1, 1, 1, { houseRelation: "allies" }),
                unit(2, 10, 10, { houseRelation: "enemies" }),
            ];
            expect(planAresSuperWeaponTarget(input({
                profile: resolveAresSuperWeaponAITargeting({ swAITargeting: mode }),
                units,
            }))).toEqual({ x: 10, y: 10 });
        }
    });

    test("excludes limbo and airborne Dominator and Mutator scoring candidates", () => {
        for (const mode of ["PsychicDominator", "GeneticMutator"]) {
            const profile = resolveAresSuperWeaponAITargeting({ swAITargeting: mode });
            const units = [
                unit(1, 10, 10, { inLimbo: true }),
                unit(2, 20, 20, { isAirborne: true }),
            ];
            expect(planAresSuperWeaponTarget(input({ profile, units }))).toBeUndefined();
            expect(planAresSuperWeaponTarget(input({
                profile,
                units: [unit(3, 30, 30, { zone: ZoneType.Air })],
            }))).toBeUndefined();
        }
    });

    test("uses the 3x3 genetic area without requiring three infantry", () => {
        const profile = resolveAresSuperWeaponAITargeting({ swAITargeting: "GeneticMutator" });
        const units = [unit(1, 10, 10), unit(2, 11, 10), unit(3, 30, 30)];

        expect(planAresSuperWeaponTarget(input({
            profile,
            units,
            cells: units.map((entry) => ({ x: entry.x, y: entry.y, zone: ZoneType.Ground })),
        }))).toEqual({ x: 10, y: 10 });
    });

    test("selects the least-defended free ParaDrop area near the enemy base", () => {
        const profile = resolveAresSuperWeaponAITargeting({ swAITargeting: "ParaDrop" });
        const units = [
            unit(1, 10, 10, { value: 10 }),
            unit(2, 11, 10, { value: 10 }),
            unit(3, 10, 11, { value: 10 }),
            unit(4, 10, 13, { value: 10 }),
        ];
        const cells = Array.from({ length: 10 }, (_, y) =>
            Array.from({ length: 10 }, (_, x) => ({
                x: x + 7,
                y: y + 7,
                zone: ZoneType.Ground,
            }))).flat();

        expect(planAresSuperWeaponTarget(input({
            profile,
            units,
            cells,
            enemyBase: { x: 10, y: 10 },
            attackTargets: [{ x: 10, y: 10 }],
        }))).toEqual({ x: 14, y: 10 });
    });

    test("uses the owning base center when ParaDrop has no enemy base", () => {
        const profile = resolveAresSuperWeaponAITargeting({ swAITargeting: "ParaDrop" });
        const cells = Array.from({ length: 10 }, (_, y) =>
            Array.from({ length: 10 }, (_, x) => ({
                x: x + 7,
                y: y + 7,
                zone: ZoneType.Ground,
            }))).flat();

        expect(planAresSuperWeaponTarget(input({
            profile,
            cells,
            ownBaseCenter: { x: 10, y: 10 },
            startLocation: { x: 50, y: 50 },
        }))).toEqual({ x: 10, y: 10 });
    });

    test("does not fall back to a water cell for ParaDrop", () => {
        const profile = resolveAresSuperWeaponAITargeting({ swAITargeting: "ParaDrop" });
        expect(planAresSuperWeaponTarget(input({
            profile,
            cells: [{ x: 1, y: 1, zone: ZoneType.Water }],
            enemyBase: { x: 1, y: 1 },
        }))).toBeUndefined();
    });

    test("keeps cloaked MultiMissile candidates in the random threat branch", () => {
        const profile = resolveAresSuperWeaponAITargeting({
            swAITargeting: "MultiMissile",
            swAIRequiresTarget: "units",
        });
        const units = [
            unit(1, 1, 1, { targetKind: "units", threat: 1 }),
            unit(2, 20, 20, { targetKind: "units", threat: 1, isCloaked: true }),
        ];

        expect(planAresSuperWeaponTarget(input({
            profile,
            units,
            cells: units.map((entry) => ({ x: entry.x, y: entry.y, zone: ZoneType.Ground })),
            randomInt: () => 100,
        }))).toEqual({ x: 20, y: 20 });
    });

    test("applies AI land and water requirements to non-unit selectors", () => {
        const profile = resolveAresSuperWeaponAITargeting({
            swAITargeting: "EnemyBase",
            swAIRequiresTarget: "land",
        });
        expect(planAresSuperWeaponTarget(input({
            profile,
            enemyBase: { x: 10, y: 10 },
            cells: [{ x: 10, y: 10, zone: ZoneType.Water }],
        }))).toBeUndefined();
    });

    test("does not accept an invalid enemy-base point as a favorite enemy", () => {
        const profile = resolveAresSuperWeaponAITargeting({ swAITargeting: "EnemyBase" });
        expect(planAresSuperWeaponTarget(input({
            profile,
            enemyBase: { x: Number.NaN, y: 10 },
        }))).toBeUndefined();
    });
});
