import { Coords } from "@/game/Coords";
import { fnv32aStrings } from "@/util/math";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
import { Warhead } from "@/game/Warhead";
import { SuperWeaponEffect } from "@/game/superweapon/SuperWeaponEffect";
import type { Game } from "@/game/Game";
import type { AresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { createAresSuperWeaponTargetFilter } from "@/extensions/ares/AresSuperWeaponFilters";
import {
    isAresSuperWeaponInRange,
    resolveAresSuperWeaponRange,
} from "@/game/superweapon/AresSuperWeaponRange";

const DEFERMENT_TICKS = 45;
const BLAST_SHIELD_TICKS = 30;
const DEFAULT_FIRE_PERCENTAGE = 20;

function normalizeDeferment(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
}

function finiteOr(value: number | undefined, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function generalNumber(game: Game, key: string, fallback: number): number {
    const rules = game.rules as any;
    const modeled = rules?.general?.[key];
    if (typeof modeled === "number" && Number.isFinite(modeled)) return modeled;
    const section = rules?.ini?.getSection?.("General");
    const authored = section?.getNumber?.(key, fallback);
    return typeof authored === "number" && Number.isFinite(authored) ? authored : fallback;
}

function generalString(game: Game, key: string, fallback: string): string {
    const rules = game.rules as any;
    const modeled = rules?.general?.[key];
    if (typeof modeled === "string" && modeled.trim()) return modeled;
    const section = rules?.ini?.getSection?.("General");
    const authored = section?.getString?.(key, "");
    return typeof authored === "string" && authored.trim() ? authored : fallback;
}

function combatDamageString(game: Game, key: string): string {
    const rules = game.rules as any;
    const modeled = rules?.combatDamage?.[key];
    if (typeof modeled === "string" && modeled.trim()) return modeled;
    const section = rules?.ini?.getSection?.("CombatDamage");
    const authored = section?.getString?.(key, "");
    return typeof authored === "string" ? authored : "";
}

function animationName(authored: string | undefined, fallback: string): string | undefined {
    const value = authored === undefined ? fallback : authored.trim();
    if (!value || /^(?:none|null)$/i.test(value)) return undefined;
    return value;
}

function isTechno(object: any): boolean {
    return object?.isTechno?.() === true ||
        object?.isUnit?.() === true ||
        object?.isBuilding?.() === true;
}

export function resolvePsychicDominatorFireDelay(
    game: Game,
    settings?: AresSuperWeaponDefinition,
): number {
    const percentage = finiteOr(
        settings?.dominatorFireAtPercentage,
        generalNumber(game, "dominatorFireAtPercentage", DEFAULT_FIRE_PERCENTAGE),
    );
    return normalizeDeferment(Math.round(DEFERMENT_TICKS * percentage / DEFAULT_FIRE_PERCENTAGE));
}

export class PsychicDominatorEffect extends SuperWeaponEffect {
    private ticksLeft = DEFERMENT_TICKS;
    private initialDeferment: number;
    private readonly superWeaponRange?: readonly number[];
    private readonly settings?: AresSuperWeaponDefinition;
    private configured = false;
    private firstAnim?: string;
    private firstAnimHeight = 750;
    private secondAnim?: string;
    private secondAnimHeight = 0;
    private controlAnim?: string;
    private capture = true;
    private ripple = true;
    private captureMindControlled = true;
    private capturePermaMindControlled = true;
    private captureImmuneToPsionics = false;
    private permanentCapture = true;

    getHash(): number {
        return fnv32aStrings([
            "PsychicDominatorEffect",
            super.getHash(),
            this.initialDeferment,
            this.ticksLeft,
            this.configured ? 1 : 0,
            this.firstAnim ?? "",
            this.firstAnimHeight,
            this.secondAnim ?? "",
            this.secondAnimHeight,
            this.controlAnim ?? "",
            this.capture ? 1 : 0,
            this.ripple ? 1 : 0,
            this.captureMindControlled ? 1 : 0,
            this.capturePermaMindControlled ? 1 : 0,
            this.captureImmuneToPsionics ? 1 : 0,
            this.permanentCapture ? 1 : 0,
        ]);
    }

    constructor(
        type: any,
        owner: any,
        tile: any,
        superWeaponDeferment?: number,
        superWeaponRange?: readonly number[],
        settings?: AresSuperWeaponDefinition,
    ) {
        super(type, owner, tile);
        this.initialDeferment = normalizeDeferment(superWeaponDeferment);
        this.superWeaponRange = (superWeaponRange ?? settings?.swRange)?.slice();
        this.settings = settings;
    }

    onStart(game: Game): void {
        this.configure(game);
        if (this.initialDeferment <= 0) {
            this.playFirstAnimation(game);
        }
    }

    onTick(game: Game): boolean {
        this.configure(game);
        if (this.initialDeferment > 0) {
            this.initialDeferment--;
            if (this.initialDeferment > 0) {
                return false;
            }
            this.playFirstAnimation(game);
        }
        if (this.ticksLeft-- > 0) {
            return false;
        }
        this.playSecondAnimation(game);
        if (this.ripple) {
            this.playAnimation(game, "IONRING", 0);
        }
        const captured = this.captureUnits(game);
        for (const object of captured) {
            object.invulnerableTrait?.setActiveFor(BLAST_SHIELD_TICKS, game.currentTick);
        }
        this.detonate(game);
        return true;
    }

    private configure(game: Game): void {
        if (this.configured) return;
        this.configured = true;
        this.firstAnim = animationName(
            this.settings?.dominatorFirstAnim,
            generalString(game, "dominatorFirstAnim", "PDFXCLD"),
        );
        this.firstAnimHeight = finiteOr(
            this.settings?.dominatorFirstAnimHeight,
            750,
        );
        this.secondAnim = animationName(
            this.settings?.dominatorSecondAnim,
            generalString(game, "dominatorSecondAnim", "PDFXLOC"),
        );
        this.secondAnimHeight = finiteOr(
            this.settings?.dominatorSecondAnimHeight,
            0,
        );
        this.controlAnim = animationName(
            this.settings?.dominatorControlAnim,
            combatDamageString(game, "permaControlledAnimationType"),
        );
        this.capture = this.settings?.dominatorCapture ?? true;
        this.ripple = this.settings?.dominatorRipple ?? true;
        this.captureMindControlled = this.settings?.dominatorCaptureMindControlled ?? true;
        this.capturePermaMindControlled = this.settings?.dominatorCapturePermaMindControlled ?? true;
        this.captureImmuneToPsionics = this.settings?.dominatorCaptureImmuneToPsionics ?? false;
        this.permanentCapture = this.settings?.dominatorPermanentCapture ?? true;
        this.ticksLeft = this.firstAnim
            ? resolvePsychicDominatorFireDelay(game, this.settings)
            : 0;
    }

    private playFirstAnimation(game: Game): void {
        if (this.firstAnim) {
            this.playAnimation(game, this.firstAnim, this.firstAnimHeight);
        }
    }

    private playSecondAnimation(game: Game): void {
        if (this.secondAnim) {
            this.playAnimation(game, this.secondAnim, this.secondAnimHeight);
        }
    }

    private playAnimation(game: Game, name: string, height: number): void {
        const bridge = game.map?.tileOccupation?.getBridgeOnTile?.(this.tile);
        const elevation = bridge?.tileElevation ?? 0;
        const position = Coords.tile3dToWorld(
            this.tile.rx + 0.5,
            this.tile.ry + 0.5,
            (this.tile.z ?? 0) + elevation + height,
        );
        game.events.dispatch(new TriggerAnimEvent(name, this.tile, position, this.owner));
    }

    private detonate(game: Game): void {
        const damage = finiteOr(
            this.settings?.swDamage,
            generalNumber(game, "dominatorDamage", 1000),
        );
        if (damage <= 0) return;
        const warheadName = animationName(
            this.settings?.swWarhead,
            generalString(game, "dominatorWarhead", "DominatorWH"),
        );
        if (!warheadName) return;
        let warheadRules;
        try {
            warheadRules = game.rules.getWarhead(warheadName);
        }
        catch (error) {
            console.warn(`Dominator warhead "${warheadName}" not found, skipping blast.`);
            return;
        }
        const warhead = new Warhead(warheadRules);
        const tile = this.tile;
        const bridge = game.map.tileOccupation.getBridgeOnTile(tile);
        const elevation = bridge?.tileElevation ?? 0;
        const zone = game.map.getTileZone(tile);
        warhead.detonate(game as any, damage, tile, elevation, Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, tile.z + elevation), zone, bridge ? CollisionType.OnBridge : CollisionType.None, game.createTarget(bridge, tile), { player: this.owner, weapon: undefined } as any, false, undefined, undefined, true);
    }

    private captureUnits(game: Game): any[] {
        if (!this.capture) return [];
        const captureRange = generalNumber(game, "dominatorCaptureRange", 1);
        const range = resolveAresSuperWeaponRange(this.superWeaponRange, {
            widthOrRange: captureRange,
            height: -1,
        });
        const canAffect = createAresSuperWeaponTargetFilter(
            this.settings?.swAffectsHouse ?? "all",
            this.settings?.swAffectsTarget ?? "infantry,units",
            this.owner,
            game as any,
        );
        const captured: any[] = [];
        for (const object of game.getWorld().getAllObjects()) {
            if (!isTechno(object) ||
                object.isDestroyed ||
                object.rules.immuneToPsionics && !this.captureImmuneToPsionics ||
                object.rules.slaved ||
                object.rules.missileSpawn ||
                !canAffect(object, object.tile) ||
                !isAresSuperWeaponInRange(this.tile, object, range, game.map.tileOccupation)) {
                continue;
            }
            const controllable = object.mindControllableTrait;
            if (controllable?.isPermanent?.()) {
                if (!this.capturePermaMindControlled) continue;
            }
            else if (controllable?.isActive?.() && !this.captureMindControlled) {
                continue;
            }
            this.captureUnit(game, object, captured);
        }
        return captured;
    }

    private captureUnit(game: Game, object: any, captured: any[]): void {
        const controllable = object.mindControllableTrait;
        if (controllable?.isActive()) {
            controllable.getController()?.mindControllerTrait?.cleanTarget(object);
        }
        controllable?.makePermanent(this.permanentCapture);
        game.changeObjectOwner(object, this.owner);
        object.dominatorControlAnimation = this.permanentCapture ? this.controlAnim : undefined;
        captured.push(object);
    }
}
