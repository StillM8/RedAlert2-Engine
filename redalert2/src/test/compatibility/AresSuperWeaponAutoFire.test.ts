import { describe, expect, test } from "bun:test";
import {
    collectAresAutoFireCandidates,
    createAresSuperWeaponWorldPlannerInput,
    isAresAutoFireAllowed,
    resolveAresSuperWeaponAutoFireProfile,
    selectAresSuperWeaponAutoFireTarget,
    planAresSuperWeaponTarget,
    type AresAutoFireHost,
    type AresAutoFireCandidate,
} from "@/extensions/ares/AresSuperWeaponAutoFire";
import { setAresPreferredTargetingCell } from "@/extensions/ares/AresSuperWeaponTargetingCell";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";
import { SuperWeaponStatus } from "@/game/SuperWeapon";

const permissiveHost = (): AresAutoFireHost => ({
    lightningStormActive: () => false,
    psychicDominatorActive: () => false,
    lowPower: () => false,
    underAttack: () => false,
});

const candidate = (over: Partial<AresAutoFireCandidate> = {}): AresAutoFireCandidate => ({
    x: 1,
    y: 1,
    targetKind: "infantry",
    houseRelation: "enemies",
    ...over,
});

describe("Ares superweapon auto-fire decisions", () => {
    test("profiles exist only for AutoFire weapons with supported modes", () => {
        expect(resolveAresSuperWeaponAutoFireProfile({ ares: {}, typeId: "X" })).toBeUndefined();
        expect(resolveAresSuperWeaponAutoFireProfile({
            ares: { swAutoFire: true, swAITargeting: "NoSuchMode" },
            typeId: "X",
        })).toBeUndefined();
        // Mode "none" is explicitly unsupported, matching the shared resolver.
        expect(resolveAresSuperWeaponAutoFireProfile({
            ares: { swAutoFire: true, swAITargeting: "None" },
            typeId: "X",
        })).toBeUndefined();
        expect(resolveAresSuperWeaponAutoFireProfile({
            ares: { swAutoFire: true, swAITargeting: "Offensive" },
            typeId: "X",
        })).toBeDefined();
    });

    test("documented constraints gate firing conservatively", () => {
        const player = {};
        const attack = resolveAresSuperWeaponAutoFireProfile({
            ares: { swAutoFire: true, swAITargeting: "Attack" },
            typeId: "X",
        })!;
        expect(isAresAutoFireAllowed(attack, player, {
            ...permissiveHost(),
            underAttack: () => true,
        })).toBe(true);
        // Unevaluable/unsatisfied constraints are conservatively refused.
        expect(isAresAutoFireAllowed(attack, player, permissiveHost())).toBe(false);

        const lowPower = resolveAresSuperWeaponAutoFireProfile({
            ares: { swAutoFire: true, swAITargeting: "LowPower" },
            typeId: "X",
        })!;
        expect(isAresAutoFireAllowed(lowPower, player, {
            ...permissiveHost(),
            lowPower: () => true,
        })).toBe(true);
        expect(isAresAutoFireAllowed(lowPower, player, permissiveHost())).toBe(false);

        const storm = resolveAresSuperWeaponAutoFireProfile({
            ares: { swAutoFire: true, swAITargeting: "LightningStorm" },
            typeId: "X",
        })!;
        expect(isAresAutoFireAllowed(storm, player, {
            ...permissiveHost(),
            lightningStormActive: () => true,
        })).toBe(false);
        expect(isAresAutoFireAllowed(storm, player, permissiveHost())).toBe(true);

        const cellSet = resolveAresSuperWeaponAutoFireProfile({
            ares: {
                swAutoFire: true,
                swAITargeting: "Offensive",
                swAITargetingConstraints: "OffensiveCellSet",
            },
            typeId: "X",
        })!;
        expect(isAresAutoFireAllowed(cellSet, player, permissiveHost())).toBe(false);
        setAresPreferredTargetingCell(player, "offensive", { x: 1, y: 2 });
        expect(isAresAutoFireAllowed(cellSet, player, permissiveHost())).toBe(true);
    });

    test("preference overrides selection and AI-required filters match candidates", () => {
        const player = {};
        // Mode Offensive carries requiredTarget/requiredHouse defaults; the
        // documented SW.AIRequires* fields override them.
        const profile = resolveAresSuperWeaponAutoFireProfile({
            ares: {
                swAutoFire: true,
                swAITargeting: "Offensive",
                swAIRequiresTarget: "infantry",
                swAIRequiresHouse: "enemies",
            },
            typeId: "X",
        })!;
        const candidates = [
            candidate({ x: 5, y: 5, targetKind: "buildings", houseRelation: "allies" }),
            candidate({ x: 6, y: 6, targetKind: "infantry", houseRelation: "enemies" }),
        ];
        expect(selectAresSuperWeaponAutoFireTarget(profile, player, candidates))
            .toEqual(candidates[1]);
        expect(selectAresSuperWeaponAutoFireTarget(profile, player, [candidates[0]]))
            .toBeUndefined();

        // SW.AITargetingPreference makes the preferred cell (map actions
        // 135/140) override the ordinary selector.
        const preferredProfile = resolveAresSuperWeaponAutoFireProfile({
            ares: {
                swAutoFire: true,
                swAITargeting: "Offensive",
                swAITargetingPreference: "Offensive",
            },
            typeId: "X",
        })!;
        // Without a set preferred cell the ordinary selector still runs
        // (preference overrides only whenever the cell is known).
        expect(selectAresSuperWeaponAutoFireTarget(preferredProfile, player, candidates))
            .toEqual(candidates[1]);
        setAresPreferredTargetingCell(player, "offensive", { x: 40, y: 41 });
        expect(selectAresSuperWeaponAutoFireTarget(preferredProfile, player, candidates))
            .toEqual({ x: 40, y: 41 });
    });

    test("candidate walk is deterministic and relation-aware", () => {
        const player = {};
        const ally = { isNeutral: false };
        const enemy = { isNeutral: false };
        const world = {
            alliances: { areAllied: (_a: any, b: any) => b === ally },
            world: {
                getAllObjects: () => [
                    { id: 2, owner: enemy, isInfantry: () => true, tile: { rx: 2, ry: 2 } },
                    { id: 1, owner: ally, isBuilding: () => true, tile: { rx: 1, ry: 1 } },
                    { id: 3, owner: player, isInfantry: () => true, tile: { rx: 3, ry: 3 } },
                    { id: 4, owner: enemy, isInfantry: () => true },
                ],
            },
        };

        const collected = collectAresAutoFireCandidates(world, player);
        // Sorted by object id; own objects and tile-less objects are excluded.
        expect(collected.map((entry) => entry.houseRelation)).toEqual(["allies", "enemies"]);
        expect(collected[0]).toMatchObject({ x: 1, y: 1, targetKind: "buildings" });
    });

    test("world targeting skips allied bases and tracks enemy-house existence", () => {
        const player: any = { name: "AI", startLocation: { x: 5, y: 5 } };
        const ally: any = { name: "Ally", isNeutral: false, startLocation: { x: 10, y: 10 } };
        const enemy: any = { name: "Enemy", isNeutral: false, startLocation: { x: 40, y: 41 } };
        const world = {
            getCombatants: () => [player, ally, enemy],
            alliances: { areAllied: (_first: any, second: any) => second === ally },
            map: {},
        };
        const enemyBaseInput = createAresSuperWeaponWorldPlannerInput(world, player, {
            name: "EnemyBaseStrike",
            ares: { swAITargeting: "EnemyBase" },
        });
        expect(enemyBaseInput.enemyBase).toEqual({ x: 40, y: 41 });
        expect(enemyBaseInput.enemyHouseExists).toBe(true);

        const hunterInput = createAresSuperWeaponWorldPlannerInput(world, player, {
            name: "HunterSeeker",
            ares: { swAITargeting: "HunterSeeker" },
        });
        expect(planAresSuperWeaponTarget(hunterInput)).toEqual({ x: 5, y: 5 });
    });

    test("world candidates preserve limbo and airborne state", () => {
        const player = {};
        const enemy = { isNeutral: false };
        const world = {
            alliances: { areAllied: () => false },
            world: {
                getAllObjects: () => [
                    { id: 1, owner: enemy, isInfantry: () => true, tile: { rx: 1, ry: 1 }, limboData: {} },
                    { id: 2, owner: enemy, isInfantry: () => true, tile: { rx: 2, ry: 2 }, isInAir: () => true },
                ],
            },
        };
        const collected = collectAresAutoFireCandidates(world, player);
        expect(collected[0]).toMatchObject({ id: 1, inLimbo: true, isAirborne: false });
        expect(collected[1]).toMatchObject({ id: 2, inLimbo: false, isAirborne: true });
    });
});

describe("Ares superweapon auto-fire pump", () => {
    const pump = (world: any, trait: any) =>
        (SuperWeaponsTrait.prototype as any).updateAresAutoFire.call(trait, world);

    test("fires ready AutoFire weapons through the activation entry point", () => {
        const calls: any[] = [];
        const enemy = { isNeutral: false };
        const player: any = {
            powerTrait: { isLowPower: () => false },
            superWeaponsTrait: {
                getAll: () => [{
                    rules: {
                        index: 7,
                        name: "AutoBlast",
                        typeId: "AutoBlast",
                        ares: {
                            swAutoFire: true,
                            swAITargeting: "Offensive",
                            swAIRequiresTarget: "infantry",
                            swAIRequiresHouse: "enemies",
                        },
                    },
                    status: SuperWeaponStatus.Ready,
                }],
            },
        };
        const world: any = {
            getCombatants: () => [player],
            alliances: { areAllied: () => false },
            world: {
                getAllObjects: () => [
                    { id: 1, owner: enemy, isInfantry: () => true, tile: { rx: 9, ry: 9 } },
                ],
            },
            map: {
                tiles: { getByMapCoords: (x: number, y: number) => ({ rx: x, ry: y }) },
                getTileZone: () => 0,
            },
        };
        const trait: any = {
            hasActiveEffect: () => false,
            activateSuperWeapon: (...args: any[]) => { calls.push(args); return true; },
        };

        pump(world, trait);

        expect(calls).toHaveLength(1);
        // (index, player, world, tile, tile2) — the ActivateSuperWeaponAction form.
        expect(calls[0][0]).toBe(7);
        expect(calls[0][1]).toBe(player);
        expect(calls[0][2]).toBe(world);
        expect(calls[0][3]).toMatchObject({ rx: 9, ry: 9 });
        expect(calls[0][4]).toBeUndefined();
    });

    test("fires every ready AutoFire weapon in deterministic order", () => {
        const calls: any[] = [];
        const enemy = { isNeutral: false };
        const player: any = {
            powerTrait: { isLowPower: () => false },
            superWeaponsTrait: {
                getAll: () => [
                    {
                        rules: {
                            index: 7,
                            name: "AutoBlastA",
                            typeId: "AutoBlastA",
                            ares: {
                                swAutoFire: true,
                                swAITargeting: "Offensive",
                                swAIRequiresTarget: "infantry",
                                swAIRequiresHouse: "enemies",
                            },
                        },
                        status: SuperWeaponStatus.Ready,
                    },
                    {
                        rules: {
                            index: 8,
                            name: "AutoBlastB",
                            typeId: "AutoBlastB",
                            ares: {
                                swAutoFire: true,
                                swAITargeting: "Offensive",
                                swAIRequiresTarget: "infantry",
                                swAIRequiresHouse: "enemies",
                            },
                        },
                        status: SuperWeaponStatus.Ready,
                    },
                ],
            },
        };
        const world: any = {
            getCombatants: () => [player],
            alliances: { areAllied: () => false },
            world: {
                getAllObjects: () => [
                    { id: 1, owner: enemy, isInfantry: () => true, tile: { rx: 9, ry: 9 } },
                ],
            },
            map: {
                tiles: { getByMapCoords: (x: number, y: number) => ({ rx: x, ry: y }) },
                getTileZone: () => 0,
            },
        };
        const trait: any = {
            hasActiveEffect: () => false,
            activateSuperWeapon: (...args: any[]) => { calls.push(args); return true; },
        };

        pump(world, trait);

        expect(calls.map((call) => call[0])).toEqual([7, 8]);
    });

    test("skips charging weapons and non-AutoFire weapons", () => {
        const calls: any[] = [];
        const player: any = {
            superWeaponsTrait: {
                getAll: () => [
                    { rules: { index: 1, name: "A", typeId: "A", ares: { swAutoFire: true, swAITargeting: "Offensive" }, }, status: SuperWeaponStatus.Charging },
                    { rules: { index: 2, name: "B", typeId: "B", ares: {} }, status: SuperWeaponStatus.Ready },
                ],
            },
        };
        const world: any = {
            getCombatants: () => [player],
            world: { getAllObjects: () => [] },
            map: { getTileZone: () => 0 },
        };
        const trait: any = {
            hasActiveEffect: () => false,
            activateSuperWeapon: (...args: any[]) => { calls.push(args); return true; },
        };

        pump(world, trait);
        expect(calls).toHaveLength(0);
    });
});
