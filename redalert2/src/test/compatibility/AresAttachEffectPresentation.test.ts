import { describe, expect, test } from "bun:test";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import { AresAttachEffectPlugin } from "@/engine/renderable/entity/plugin/AresAttachEffectPlugin";

const definition = {
    animation: "MO_EFFECT_ANIM",
    duration: 10,
    speedMultiplier: 1,
    armorMultiplier: 1,
    firepowerMultiplier: 1,
    rofMultiplier: 1,
    cloakable: false,
    forceDecloak: false,
    discardOnEntry: false,
    penetratesIronCurtain: false,
    delay: 0,
    initialDelay: 0,
    cumulative: false,
    animResetOnReapply: true,
    temporalHidesAnim: true,
    extensionEntries: new Map(),
} as const;

function makeRenderable() {
    const children: any[] = [];
    const parent = {
        add(child: any) { children.push(child); },
        remove(child: any) {
            const index = children.indexOf(child);
            if (index >= 0) children.splice(index, 1);
        },
    };
    return { parent, children };
}

function makeManager(created: any[]) {
    return {
        createAnim(name: string) {
            const object = {};
            const props = { loopCount: 0 };
            const anim = {
                name,
                get3DObject: () => object,
                create3DObject: () => undefined,
                getAnimProps: () => props,
                dispose: () => created.push(`disposed:${name}`),
            };
            created.push(anim);
            return anim;
        },
    };
}

describe("Ares AttachEffect presentation", () => {
    test("attaches authored animation, follows cloak/temporal visibility, and recreates on reapply", () => {
        const trait = new AresAttachEffectTrait({
            definitions: new Map([["MO", definition]]),
        });
        const gameObject: any = {
            aresAttachEffectTrait: trait,
            isDestroyed: false,
            isCrashing: false,
            cloakableTrait: { isCloaked: () => false },
            warpedOutTrait: { isActive: () => false },
        };
        const renderable = makeRenderable();
        const created: any[] = [];
        const plugin = new AresAttachEffectPlugin(gameObject, { get3DObject: () => renderable.parent });
        plugin.onCreate(makeManager(created));

        trait.apply("MO", definition);
        plugin.update();
        expect(renderable.children).toHaveLength(1);
        expect(created[0].name).toBe("MO_EFFECT_ANIM");
        expect(created[0].getAnimProps().loopCount).toBe(-1);

        gameObject.cloakableTrait.isCloaked = () => true;
        plugin.update();
        expect(renderable.children).toHaveLength(0);
        expect(created).toContain("disposed:MO_EFFECT_ANIM");

        gameObject.cloakableTrait.isCloaked = () => false;
        plugin.update();
        expect(renderable.children).toHaveLength(1);

        gameObject.warpedOutTrait.isActive = () => true;
        plugin.update();
        expect(renderable.children).toHaveLength(0);

        gameObject.warpedOutTrait.isActive = () => false;
        trait.apply("MO", definition);
        plugin.update();
        expect(renderable.children).toHaveLength(1);
        expect(created.filter((entry) => entry?.name === "MO_EFFECT_ANIM")).toHaveLength(3);
        plugin.dispose();
        expect(renderable.children).toHaveLength(0);
    });

    test("does not add an animation when the effect has no authored animation", () => {
        const noAnimation = { ...definition, animation: undefined };
        const trait = new AresAttachEffectTrait({
            definitions: new Map([["MO", noAnimation]]),
        });
        const gameObject: any = {
            aresAttachEffectTrait: trait,
            isDestroyed: false,
            isCrashing: false,
            cloakableTrait: { isCloaked: () => false },
            warpedOutTrait: { isActive: () => false },
        };
        const renderable = makeRenderable();
        const plugin = new AresAttachEffectPlugin(gameObject, { get3DObject: () => renderable.parent });
        plugin.onCreate(makeManager([]));
        trait.apply("MO", noAnimation);
        plugin.update();
        expect(renderable.children).toHaveLength(0);
    });
});
