import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import {
    buildPrismSupportNetwork,
    composePrismProjectileDamage,
    computePrismFireComposition,
    computePrismNodeThicknessOffset,
    createPrismSupportWeaponProfile,
    parsePrismForwardingRules,
    PrismForwardingMode,
    type PrismForwardingGlobalRules,
    type PrismForwardingRules,
    type PrismNetworkTower,
} from "@/extensions/ares/AresPrismForwarding";
import { PrismRules } from "@/game/rules/general/PrismRules";
import {
    PrismSupportTrait,
    validatePrismSupportTraitState,
} from "@/game/gameobject/trait/PrismSupportTrait";
import { EventType } from "@/game/event/EventType";
import { WeaponType } from "@/game/WeaponType";
import { TechnoRules } from "@/game/rules/TechnoRules";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { Projectile } from "@/game/gameobject/Projectile";
import { PrismSupportFxHandler } from "@/engine/renderable/fx/handler/PrismSupportFxHandler";
import { Vector3 } from "@/game/math/Vector3";
import { FlhCoords } from "@/game/art/FlhCoords";
import { LaserFx } from "@/engine/renderable/fx/LaserFx";
import { WeaponRules } from "@/game/rules/WeaponRules";
import { AttackTrait } from "@/game/gameobject/trait/AttackTrait";

const globals: PrismForwardingGlobalRules = {
    type: "ATESLA",
    supportMax: 2,
    supportModifier: 1.5,
    supportHeight: 512,
    supportDelay: 45,
    supportDuration: 15,
};

function prismRules(overrides: Partial<PrismForwardingRules> = {}): PrismForwardingRules {
    return {
        mode: PrismForwardingMode.Both,
        targets: ["ATESLA"],
        maxFeeds: 2,
        maxChainLength: 1,
        maxNetworkSize: 2,
        supportModifier: 1.5,
        damageAdd: 0,
        myHeight: 512,
        toAllies: false,
        breakSupport: false,
        chargeDelay: 1,
        intensity: -2,
        ...overrides,
    };
}

function networkTower(
    id: number,
    x: number,
    overrides: Partial<PrismNetworkTower> = {},
): PrismNetworkTower {
    return {
        id,
        typeName: "ATESLA",
        ownerId: 1,
        rules: prismRules(),
        operational: true,
        position: { x, y: 0, z: 0 },
        supportRange: 8,
        minimumSupportRange: 0,
        ...overrides,
    };
}

const context = {
    areAllied: (first: number, second: number) => first === second ||
        first === 2 && second === 1 || first === 1 && second === 2,
    distance: (first: { x: number; y: number; z: number }, second: { x: number; y: number; z: number }) =>
        Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z),
};

function makeRuntime(ownerId: number, rules: PrismForwardingRules, weaponMap: Record<string, any> = {}) {
    const events: any[] = [];
    const player = {
        playerListIndex: ownerId,
        color: { asHex: () => 0x00ff00 },
    };
    const tower: any = {
        id: ownerId + 1,
        name: "ATESLA",
        owner: player,
        isBuilding: () => true,
        isSpawned: true,
        isDestroyed: false,
        isCrashing: false,
        isDisposed: false,
        buildStatus: 1,
        position: { worldPosition: { x: ownerId * 256, y: 0, z: 0 } },
        direction: 0,
        attackTrait: { isDisabled: () => false },
        poweredTrait: { isPoweredOn: () => true },
        unitOrderTrait: { getCurrentTask: () => undefined },
        art: {
            fireUp: 0,
            primaryFireFlh: { clone: () => ({ forward: 0, lateral: 0, vertical: 0 }) },
            alternateFireFlh: { clone: () => ({ forward: 1, lateral: 2, vertical: 3 }) },
        },
        rules: {
            ...rules,
            primary: "Prism",
            prismForwarding: rules,
            overpowerable: true,
        },
    };
    const rulesEngine: any = {
        general: {
            prism: {
                type: "ATESLA",
                supportDelay: 45,
                supportDuration: 15,
            },
        },
        getWeapon: (name: string) => {
            if (weaponMap[name]) return weaponMap[name];
            if (name === "Prism") return { name, range: 8 };
            throw new Error(`missing ${name}`);
        },
    };
    const game: any = {
        currentTick: 0,
        rules: rulesEngine,
        world: { getAllObjects: () => [tower] },
        playerList: { getAll: () => [player] },
        alliances: { areAllied: (first: any, second: any) => first === second },
        events: { dispatch: (event: any) => events.push(event) },
        getObjectById: (id: number) => id === tower.id ? tower : undefined,
    };
    tower.prismSupportTrait = new PrismSupportTrait(tower, rulesEngine);
    return { tower, trait: tower.prismSupportTrait, game, events, player, rulesEngine };
}

function connectRuntime(provider: ReturnType<typeof makeRuntime>, master: ReturnType<typeof makeRuntime>) {
    master.tower.owner = provider.player;
    const game = master.game;
    game.rules = provider.rulesEngine;
    const objects = [provider.tower, master.tower];
    game.world.getAllObjects = () => objects;
    game.playerList.getAll = () => [provider.player];
    game.alliances.areAllied = (first: any, second: any) => first === second;
    game.events.dispatch = (event: any) => {
        provider.events.push(event);
        master.events.push(event);
    };
    game.getObjectById = (id: number) => objects.find(tower => tower.id === id);
    return game;
}

describe("Prism Forwarding parser", () => {
    test("parses global percentages and exact retail defaults", () => {
        const general = new IniSection("General");
        general.set("PrismType", "ATESLA");
        general.set("PrismSupportMax", "3");
        general.set("PrismSupportModifier", "150%");
        general.set("PrismSupportHeight", "640");
        general.set("PrismSupportDelay", "30");
        general.set("PrismSupportDuration", "12");
        const prism = new PrismRules().readIni(general);
        expect(prism.supportModifier).toBe(1.5);

        const parsed = parsePrismForwardingRules(new IniSection("ATESLA"), "ATESLA", prism);
        expect(parsed.mode).toBe(PrismForwardingMode.Both);
        expect(parsed.targets).toEqual(["ATESLA"]);
        expect(parsed.maxFeeds).toBe(3);
        expect(parsed.maxNetworkSize).toBe(3);
        expect(parsed.maxChainLength).toBe(1);
        expect(parsed.supportModifier).toBe(1.5);
        expect(parsed.myHeight).toBe(640);
        expect(parsed.damageAdd).toBe(0);
        expect(parsed.chargeDelay).toBe(1);
        expect(parsed.intensity).toBe(-2);
        expect(parsed.toAllies).toBe(false);
        expect(parsed.breakSupport).toBe(false);
    });

    test("parses every documented directed-graph and presentation setting", () => {
        const section = new IniSection("GAHYBRID");
        section.set("PrismForwarding", "YeS");
        section.set("PrismForwarding.Targets", "atesla, GAHYBRID, atesla");
        section.set("PrismForwarding.MaxFeeds", "-1");
        section.set("PrismForwarding.MaxChainLength", "4");
        section.set("PrismForwarding.MaxNetworkSize", "9");
        section.set("PrismForwarding.SupportModifier", "125%");
        section.set("PrismForwarding.DamageAdd", "-7.9");
        section.set("PrismForwarding.MyHeight", "777");
        section.set("PrismForwarding.ToAllies", "yes");
        section.set("PrismForwarding.BreakSupport", "true");
        section.set("PrismForwarding.ChargeDelay", "0");
        section.set("PrismForwarding.Intensity", "2.9");
        section.set("PrismForwarding.SupportWeapon", "PrismBeam");
        const parsed = parsePrismForwardingRules(section, "GAHYBRID", globals);
        expect(parsed).toMatchObject({
            mode: PrismForwardingMode.Both,
            targets: ["atesla", "GAHYBRID"],
            maxFeeds: -1,
            maxChainLength: 4,
            maxNetworkSize: 9,
            supportModifier: 1.25,
            damageAdd: -7,
            myHeight: 777,
            toAllies: true,
            breakSupport: true,
            chargeDelay: 1,
            intensity: 2,
            supportWeapon: "PrismBeam",
            eliteSupportWeapon: "PrismBeam",
        });
    });

    test("routes BuildingType mode and Overpowerable through TechnoRules", () => {
        const section = new IniSection("ATESLA");
        section.set("PrismForwarding", "forward");
        section.set("PrismForwarding.Targets", "GAHYBRID");
        section.set("Overpowerable", "yes");
        const rules = new TechnoRules(
            ObjectType.Building,
            section,
            0,
            { prism: globals },
            new ArmorRegistry(),
        );
        expect(rules.prismForwarding.mode).toBe(PrismForwardingMode.Forward);
        expect(rules.prismForwarding.targets).toEqual(["GAHYBRID"]);
        expect(rules.overpowerable).toBe(true);
    });

    test("uses the support weapon profile only for authored support properties", () => {
        const fallback = createPrismSupportWeaponProfile(undefined, {
            primaryRange: 7,
            supportDelay: 45,
            supportDuration: 15,
        });
        expect(fallback).toMatchObject({
            range: 8,
            minimumRange: 0,
            rof: 45,
            report: [],
            isLaser: true,
            laserDuration: 15,
            isHouseColor: true,
            laserThickness: 3,
            isElectricBolt: false,
            isRadBeam: false,
        });

        const authored = createPrismSupportWeaponProfile({
            range: -2,
            minimumRange: 3,
            rof: 9,
            report: ["Support"],
            isLaser: true,
            laserDuration: 6,
            isHouseColor: false,
            laserInnerColor: [1, 2, 3],
            laserOuterColor: [4, 5, 6],
            laserOuterSpread: 0.5,
            laserThickness: -1,
            isElectricBolt: true,
            isAlternateColor: true,
            isRadBeam: true,
            aresWeaponVisuals: {
                boltColors: [[7, 8, 9], undefined, [10, 11, 12]],
                beamColor: [13, 14, 15],
                beamDuration: 11,
                beamIsHouseColor: false,
                beamAmplitude: 22,
            },
        }, { primaryRange: 7, supportDelay: 45, supportDuration: 15 });
        expect(authored).toMatchObject({
            range: Number.POSITIVE_INFINITY,
            minimumRange: 3,
            rof: 9,
            report: ["Support"],
            laserInnerColor: [1, 2, 3],
            laserOuterColor: [4, 5, 6],
            laserThickness: 3,
            isElectricBolt: true,
            isRadBeam: true,
            beamColor: [13, 14, 15],
            beamDuration: 11,
            beamAmplitude: 22,
        });

        const section = new IniSection("PrismBeam");
        section.set("Range", "-2");
        section.set("MinimumRange", "2");
        section.set("ROF", "8");
        section.set("Report", "PrismReport");
        section.set("IsLaser", "yes");
        section.set("LaserDuration", "5");
        section.set("LaserInnerColor", "(20,30,40)");
        section.set("LaserOuterColor", "(50,60,70)");
        section.set("LaserOuterSpread", "0.25");
        section.set("LaserThickness", "7");
        const parsed = createPrismSupportWeaponProfile(
            new WeaponRules(section),
            { primaryRange: 6, supportDelay: 45, supportDuration: 15 },
        );
        expect(parsed).toMatchObject({
            range: Number.POSITIVE_INFINITY,
            minimumRange: 2,
            rof: 8,
            report: ["PrismReport"],
            laserDuration: 5,
            laserInnerColor: [20, 30, 40],
            laserOuterColor: [50, 60, 70],
            laserOuterSpread: 0.25,
            laserThickness: 7,
        });
    });
});

describe("deterministic Prism Forwarding graph", () => {
    test("uses self targets case-insensitively and rejects invalid references", () => {
        const master = networkTower(1, 0, { typeName: "ATESLA" });
        const valid = networkTower(2, 1, { rules: prismRules({ targets: ["atesla"] }) });
        const invalid = networkTower(3, 2, { rules: prismRules({ targets: ["missing"] }) });
        const network = buildPrismSupportNetwork(master, [invalid, valid], context);
        expect(network.nodes.map(node => node.towerId)).toEqual([1, 2]);
    });

    test("enforces directed feed, network size, and master chain limits", () => {
        const master = networkTower(1, 0, {
            rules: prismRules({ maxFeeds: 2, maxNetworkSize: 2, maxChainLength: 2 }),
        });
        const first = networkTower(2, 1);
        const second = networkTower(3, 2);
        const excess = networkTower(4, 3);
        const network = buildPrismSupportNetwork(master, [excess, second, first], context);
        expect(network.providerCount).toBe(2);
        expect(network.nodes.map(node => node.towerId)).toEqual([1, 2, 3]);

        const chainMaster = networkTower(10, 0, {
            rules: prismRules({ maxFeeds: 2, maxNetworkSize: -1, maxChainLength: 1 }),
        });
        const middle = networkTower(11, 1, {
            typeName: "PRISMNODE",
            rules: prismRules({ targets: ["ATESLA"] }),
        });
        const far = networkTower(12, 2, { rules: prismRules({ targets: ["PRISMNODE"] }) });
        expect(buildPrismSupportNetwork(chainMaster, [far, middle], context).providerCount).toBe(1);
    });

    test("builds multiple stages without cycles or duplicate feeds", () => {
        const master = networkTower(1, 0, {
            rules: prismRules({ maxFeeds: 2, maxNetworkSize: -1, maxChainLength: 4 }),
        });
        const middle = networkTower(2, 1, {
            typeName: "PRISMNODE",
            rules: prismRules({ targets: ["ATESLA"], maxFeeds: 1 }),
        });
        const far = networkTower(3, 2, { rules: prismRules({ targets: ["prismnode"] }) });
        const cycle = networkTower(4, 3, { rules: prismRules({ targets: ["PRISMNODE"] }) });
        const network = buildPrismSupportNetwork(master, [cycle, far, middle], context);
        expect(network.edges).toEqual([
            { providerId: 2, targetId: 1, depth: 1, activationDelay: 1 },
            { providerId: 3, targetId: 2, depth: 2, activationDelay: 0 },
        ]);
        expect(new Set(network.nodes.map(node => node.towerId)).size).toBe(network.nodes.length);
    });

    test("enforces support weapon minimum and maximum ranges", () => {
        const master = networkTower(1, 0);
        const outside = networkTower(2, 3, { supportRange: 2, minimumSupportRange: 0 });
        const inside = networkTower(3, 2, { supportRange: 2, minimumSupportRange: 2 });
        expect(buildPrismSupportNetwork(master, [outside, inside], context).providerCount).toBe(1);
        expect(buildPrismSupportNetwork(master, [inside], context).nodes.map(node => node.towerId)).toEqual([1, 3]);
        const infinite = networkTower(4, 100, { supportRange: Number.POSITIVE_INFINITY });
        expect(buildPrismSupportNetwork(master, [infinite], context).providerCount).toBe(1);
    });

    test("requires the provider to be allied to both target and master", () => {
        const master = networkTower(1, 0);
        const provider = networkTower(2, 1, {
            ownerId: 2,
            rules: prismRules({ toAllies: false }),
        });
        expect(buildPrismSupportNetwork(master, [provider], context).providerCount).toBe(0);
        provider.rules = prismRules({ toAllies: true });
        expect(buildPrismSupportNetwork(master, [provider], context).providerCount).toBe(1);
        provider.ownerId = 4;
        expect(buildPrismSupportNetwork(master, [provider], context).providerCount).toBe(0);
    });

    test("sorts equal-distance feeds by object id independent of input order", () => {
        const master = networkTower(1, 0, { rules: prismRules({ maxFeeds: 2 }) });
        const first = networkTower(2, 1);
        const second = networkTower(3, 1);
        const forward = buildPrismSupportNetwork(master, [first, second], context);
        const reverse = buildPrismSupportNetwork(master, [second, first], context);
        expect(forward).toEqual(reverse);
        expect(forward.nodes.map(node => node.towerId)).toEqual([1, 2, 3]);
    });

    test("accumulates charge delay by backward chain and applies intensity linearly", () => {
        const master = networkTower(1, 0, {
            rules: prismRules({ maxFeeds: 1, maxChainLength: 3, maxNetworkSize: -1, chargeDelay: 2, intensity: 1 }),
        });
        const middle = networkTower(2, 1, { rules: prismRules({ maxFeeds: 1, chargeDelay: 2, intensity: 1 }) });
        const far = networkTower(3, 2, { rules: prismRules({ chargeDelay: 2, intensity: 1 }) });
        const network = buildPrismSupportNetwork(master, [middle, far], context);
        expect(network.nodes.map(node => node.activationDelay)).toEqual([4, 2, 0]);
        expect(network.nodes.map(node => computePrismNodeThicknessOffset(node, network.longestChain))).toEqual([2, 1, 0]);
    });

    test("adds provider modifiers linearly, keeps the base multiplier, and applies DamageAdd", () => {
        const master = networkTower(1, 0, {
            rules: prismRules({ maxFeeds: 2, supportModifier: 9, damageAdd: 10, intensity: -2 }),
        });
        const first = networkTower(2, 1, { rules: prismRules({ supportModifier: 1.5, damageAdd: 5 }) });
        const second = networkTower(3, 2, { rules: prismRules({ supportModifier: 1.5, damageAdd: 7 }) });
        const network = buildPrismSupportNetwork(master, [first, second], context);
        expect(computePrismFireComposition(network)).toEqual({
            damageMultiplier: 4,
            damageBonus: 22,
            providerCount: 2,
            networkSize: 2,
            longestChain: 1,
            beamThicknessOffset: 2,
        });
        expect(composePrismProjectileDamage(100, 22, 4)).toBe(488);
    });
});

describe("Prism Support runtime and state", () => {
    test("applies DamageAdd before the support multiplier on the shared projectile damage path", () => {
        const projectile = Object.create(Projectile.prototype) as any;
        projectile.fromWeapon = {
            type: WeaponType.Primary,
            rules: { damage: 100 },
            warhead: { rules: { ivanBomb: false } },
        };
        projectile.baseDamageBonus = 22;
        projectile.baseDamageMultiplier = 4;
        projectile.veteranDamageMult = 1;
        expect(projectile.computeBaseDamage({})).toBe(488);
    });

    test("charges deterministically and applies only a live provider at fire time", () => {
        const provider = makeRuntime(0, prismRules({ supportModifier: 0.5, damageAdd: 6, breakSupport: true }));
        const master = makeRuntime(1, prismRules({ maxChainLength: 1 }));
        provider.tower.overpoweredTrait = { isOverpowered: () => true };
        const game = connectRuntime(provider, master);
        const target = { obj: { id: 99 } };
        const plan = master.trait.prepareAttack(game, target);
        expect(plan.ready).toBe(false);
        expect(plan.providerCount).toBe(1);
        expect(provider.events).toHaveLength(1);
        expect(provider.events[0].type).toBe(EventType.PrismSupportBeam);
        expect(provider.trait.captureState().supportCooldownTicks).toBe(45);
        game.currentTick = 1;
        expect(master.trait.completeAttack(game, target)).toMatchObject({
            damageMultiplier: 1.5,
            damageBonus: 6,
            providerCount: 1,
        });
    });

    test("drops constructing, selling, unpowered, and stale providers", () => {
        for (const invalidate of [
            (tower: any) => tower.buildStatus = 0,
            (tower: any) => tower.buildStatus = 2,
            (tower: any) => tower.poweredTrait.isPoweredOn = () => false,
            (tower: any) => tower.isDestroyed = true,
        ]) {
            const provider = makeRuntime(0, prismRules());
            const master = makeRuntime(1, prismRules());
            const game = connectRuntime(provider, master);
            const target = { obj: { id: 99 } };
            master.trait.prepareAttack(game, target);
            invalidate(provider.tower);
            game.currentTick = 2;
            expect(master.trait.completeAttack(game, target).providerCount).toBe(0);
        }
    });

    test("honors BreakSupport without leaving the old feed attached", () => {
        const heldProvider = makeRuntime(0, prismRules({ breakSupport: false }));
        const heldMaster = makeRuntime(1, prismRules());
        const heldGame = connectRuntime(heldProvider, heldMaster);
        heldMaster.trait.prepareAttack(heldGame, { obj: { id: 98 } });
        expect(heldProvider.trait.prepareAttack(heldGame, { obj: { id: 99 } }).blocked).toBe(true);
        heldMaster.trait.cancelAttack();

        const first = makeRuntime(0, prismRules({ breakSupport: true }));
        const second = makeRuntime(1, prismRules());
        const game = connectRuntime(first, second);
        second.trait.prepareAttack(game, { obj: { id: 99 } });
        expect(first.trait.captureState().supportMasterId).toBe(second.tower.id);
        first.trait.prepareAttack(game, { obj: { id: 100 } });
        expect(first.trait.captureState().supportMasterId).not.toBe(second.tower.id);
        expect(first.trait.captureState().sequence?.nodes).toHaveLength(1);
    });

    test("composes support with normal primary and overpowered secondary weapons", () => {
        const runtime = makeRuntime(0, prismRules());
        const primary = { type: WeaponType.Primary, rules: { neverUse: false } };
        const secondary = { type: WeaponType.Secondary, rules: { neverUse: false } };
        const attackTrait = new AttackTrait({}, {});
        runtime.tower.isInfantry = () => false;
        runtime.tower.isVehicle = () => false;
        runtime.tower.primaryWeapon = primary;
        runtime.tower.secondaryWeapon = secondary;
        expect(PrismSupportTrait.isPrismAttackWeapon(runtime.tower, primary)).toBe(true);
        expect(PrismSupportTrait.isPrismAttackWeapon(runtime.tower, secondary)).toBe(true);
        expect(PrismSupportTrait.isPrismAttackWeapon(runtime.tower, { type: WeaponType.DeathWeapon })).toBe(false);
        expect(attackTrait.getAvailableWeapons(runtime.tower, false, false)).toEqual([primary]);
        runtime.tower.overpoweredTrait = { getWeapon: () => secondary };
        expect(attackTrait.getAvailableWeapons(runtime.tower, false, false)).toEqual([secondary]);
    });

    test("uses authored support weapons without replacing normal weapons", () => {
        const support = {
            range: 5,
            minimumRange: 1,
            rof: 12,
            report: ["SupportReport"],
            isLaser: true,
            laserDuration: 4,
            isHouseColor: false,
            laserThickness: 6,
            isElectricBolt: true,
            isRadBeam: true,
        };
        const provider = makeRuntime(0, prismRules({ supportWeapon: "Beam", eliteSupportWeapon: "EliteBeam" }), {
            Beam: support,
            EliteBeam: { ...support, range: 9 },
        });
        const master = makeRuntime(1, prismRules());
        const game = connectRuntime(provider, master);
        master.trait.prepareAttack(game, { obj: { id: 99 } });
        expect(provider.events[0].profile).toMatchObject({
            range: 5,
            minimumRange: 1,
            rof: 12,
            report: ["SupportReport"],
            laserThickness: 6,
        });
        expect(provider.tower.rules.primary).toBe("Prism");
    });

    test("renders support presentation from the authored support profile", () => {
        let subscriber: ((event: any) => void) | undefined;
        const effects: any[] = [];
        const game = {
            speed: { value: 1 },
            events: {
                subscribe: (_type: EventType, callback: (event: any) => void) => {
                    subscriber = callback;
                    return { dispose: () => undefined };
                },
            },
        };
        const handler = new PrismSupportFxHandler(game, { addEffect: (effect: any) => effects.push(effect) }, {});
        handler.init();
        const event = {
            source: {
                position: { worldPosition: new Vector3(0, 0, 0) },
                direction: 0,
                owner: { color: { asHex: () => 0x00ff00 } },
                rules: { prismForwarding: { intensity: -2 } },
            },
            target: {
                position: { worldPosition: new Vector3(256, 0, 0) },
                rules: { prismForwarding: { myHeight: 512 } },
            },
            profile: {
                range: 8,
                minimumRange: 0,
                rof: 1,
                report: [],
                isLaser: true,
                laserDuration: 15,
                isHouseColor: true,
                laserOuterSpread: 0,
                laserThickness: 3,
                isElectricBolt: false,
                isAlternateColor: false,
                boltColors: [undefined, undefined, undefined],
                isRadBeam: false,
                beamDuration: 15,
                beamIsHouseColor: false,
                beamAmplitude: 40,
            },
            sourceFlh: new FlhCoords(),
            downstreamCount: 2,
        };
        subscriber?.(event);
        expect(effects).toHaveLength(1);
        expect(effects[0]).toBeInstanceOf(LaserFx);
    });

    test("round-trips versioned network and charge state and hashes every mutable field", () => {
        const provider = makeRuntime(0, prismRules());
        const master = makeRuntime(1, prismRules());
        const game = connectRuntime(provider, master);
        master.trait.prepareAttack(game, { obj: { id: 99 } });
        const state = JSON.parse(JSON.stringify(master.trait.captureState()));
        const objects = [provider.tower, master.tower];
        const attackTarget = { id: 99 };
        const hash = master.trait.getHash();
        master.trait.cancelAttack();
        expect(master.trait.getHash()).not.toBe(hash);
        master.trait.restoreState(state, {
            strict: true,
            resolveObjectById: id => objects.find(tower => tower.id === id) ?? (id === attackTarget.id ? attackTarget : undefined),
        });
        expect(master.trait.getHash()).toBe(hash);
        expect(() => validatePrismSupportTraitState({ ...state, version: 2 }, master.tower.id)).toThrow(/version/i);
        const cyclic = JSON.parse(JSON.stringify(state));
        cyclic.sequence.nodes[0].targetId = cyclic.sequence.nodes[1].towerId;
        expect(() => validatePrismSupportTraitState(cyclic, master.tower.id)).toThrow(/root|cyclic|feed/i);
    });
});
