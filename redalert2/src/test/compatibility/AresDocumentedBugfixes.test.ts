import { describe, expect, test } from "bun:test";
import { MoveSoundFxPlugin } from "@/engine/renderable/entity/plugin/MoveSoundFxPlugin";
import { MindControlLinkPlugin } from "@/engine/renderable/entity/plugin/MindControlLinkPlugin";
import { VeteranTrait } from "@/game/gameobject/trait/VeteranTrait";
import { NotifyTargetDestroy } from "@/game/trait/interface/NotifyTargetDestroy";

function makeVeteranSource(): any {
    const source: any = {
        name: "Source",
        owner: {},
        rules: {
            cost: 10,
            trainable: true,
            organic: false,
            veteranAbilities: new Set(),
            eliteAbilities: new Set(),
        },
        veteranLevel: 0,
        isDestroyed: false,
        isCrashing: false,
        isTechno: () => true,
        isInfantry: () => false,
    };
    source.veteranTrait = new VeteranTrait(source, {
        veteranRatio: 100,
        veteranCap: 3,
        veteranSpeed: 1,
        veteranArmor: 1,
        veteranCombat: 1,
        veteranROF: 1,
        veteranSight: 1,
    });
    return source;
}

describe("documented Ares runtime bugfixes", () => {
    test("does not play MoveSound for magnetron movement", () => {
        let plays = 0;
        const gameObject: any = {
            isDestroyed: false,
            isCrashing: false,
            owner: {},
            rules: { balloonHover: false, hoverAttack: true },
            zone: "Air",
            spinVelocity: 1,
            warpedOutTrait: { isActive: () => false },
            magnetizedTrait: { isActive: () => true },
            moveTrait: { isIdle: () => false, isWaiting: () => false },
        };
        const worldSound: any = {
            playEffect: () => {
                plays++;
                return { isLoop: false, stop: () => undefined, isPlaying: () => false };
            },
        };
        new MoveSoundFxPlugin(gameObject, "MOVE", worldSound).update();
        expect(plays).toBe(0);
    });

    test("does not draw mind-control links for a secondary parasite weapon", () => {
        let effects = 0;
        const source: any = {
            isDestroyed: false,
            isCrashing: false,
            primaryWeapon: undefined,
            secondaryWeapon: { warhead: { rules: { parasite: true } } },
        };
        const plugin = new MindControlLinkPlugin(
            source,
            { isSelected: () => true },
            { haveSharedIntel: () => true },
            { value: undefined },
        );
        plugin.onCreate({ addEffect: () => { effects++; } });
        plugin.update();
        expect(effects).toBe(0);
    });

    test("awards enemy temporal kills but suppresses friendly temporal kills", () => {
        const source = makeVeteranSource();
        const target: any = {
            rules: { cost: 10, dontScore: false, insignificant: false },
            veteranLevel: 0,
            isTechno: () => true,
        };
        let friendly = false;
        const manager: any = {
            areFriendly: () => friendly,
            rules: { general: { cloakDelay: 0 } },
            events: { dispatch: () => undefined },
            addObjectTrait: () => undefined,
        };
        const weapon: any = { warhead: { rules: { temporal: true, parasite: false } } };

        (source.veteranTrait as any)[NotifyTargetDestroy.onDestroy](source, target, weapon, manager);
        const enemyXp = source.veteranTrait.captureState().xp;
        source.veteranTrait.restoreState({ level: 0, xp: 0 });
        friendly = true;
        (source.veteranTrait as any)[NotifyTargetDestroy.onDestroy](source, target, weapon, manager);
        expect(enemyXp).toBe(10);
        expect(source.veteranTrait.captureState().xp).toBe(0);
    });
});
