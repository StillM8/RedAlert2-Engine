import { SuperWeaponEffect } from "@/game/superweapon/SuperWeaponEffect";
import { TriggerSoundFxEvent } from "@/game/event/TriggerSoundFxEvent";
import { createAresSuperWeaponTargetFilter } from "@/extensions/ares/AresSuperWeaponFilters";
import type { AresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import {
    isAresSuperWeaponInRange,
    resolveAresSuperWeaponRange,
} from "@/game/superweapon/AresSuperWeaponRange";
import { fnv32aStrings } from "@/util/math";
import type { Game } from "@/game/Game";

function finiteOr(value: number | undefined, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeFrames(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
}

function generalNumber(game: Game, key: string, fallback: number): number {
    const rules = game.rules as any;
    const modeled = rules?.general?.[key];
    if (typeof modeled === "number" && Number.isFinite(modeled)) return modeled;
    const section = rules?.ini?.getSection?.("General");
    const authored = section?.getNumber?.(key, fallback);
    return typeof authored === "number" && Number.isFinite(authored) ? authored : fallback;
}

function soundName(value: string | undefined): string | undefined {
    const sound = value?.trim();
    return sound && !/^(?:none|null)$/i.test(sound) ? sound : undefined;
}

function isTechno(object: any): boolean {
    return object?.isTechno?.() === true ||
        object?.isUnit?.() === true ||
        object?.isBuilding?.() === true;
}

export class ForceShieldEffect extends SuperWeaponEffect {
    private readonly superWeaponRange?: readonly number[];
    private readonly settings?: AresSuperWeaponDefinition;
    private ticksLeft = 0;
    private duration = 0;
    private fadeSoundTime = 0;
    private specialSound?: string;
    private fadeSoundPlayed = false;
    private configured = false;

    constructor(
        type: any,
        owner: any,
        tile: any,
        superWeaponRange?: readonly number[],
        settings?: AresSuperWeaponDefinition,
    ) {
        super(type, owner, tile);
        this.superWeaponRange = (superWeaponRange ?? settings?.swRange)?.slice();
        this.settings = settings;
    }

    getHash(): number {
        return fnv32aStrings([
            "ForceShieldEffect",
            super.getHash(),
            this.ticksLeft,
            this.duration,
            this.fadeSoundTime,
            this.specialSound ?? "",
            this.fadeSoundPlayed ? 1 : 0,
            this.configured ? 1 : 0,
        ]);
    }

    onStart(game: Game): void {
        this.configure(game);
        const range = resolveAresSuperWeaponRange(this.superWeaponRange, {
            widthOrRange: generalNumber(game, "forceShieldRadius", 4),
            height: -1,
        });
        const canAffect = createAresSuperWeaponTargetFilter(
            this.settings?.swAffectsHouse ?? "team",
            this.settings?.swAffectsTarget ?? "buildings",
            this.owner,
            game as any,
        );
        const shielded = new Set<any>();
        for (const object of game.getWorld().getAllObjects()) {
            if (!isTechno(object) ||
                object.isDestroyed ||
                shielded.has(object) ||
                !canAffect(object, object.tile) ||
                !isAresSuperWeaponInRange(this.tile, object, range, game.map.tileOccupation)) {
                continue;
            }
            shielded.add(object);
            object.invulnerableTrait?.setActiveFor(this.duration, game.currentTick, "force-shield");
        }
        const blackout = normalizeFrames(
            finiteOr(
                this.settings?.protectPowerOutage,
                generalNumber(game, "forceShieldBlackoutDuration", 1000),
            ),
        );
        this.owner.powerTrait?.setBlackoutFor(blackout, game);
    }

    onTick(game: Game): boolean {
        this.configure(game);
        if (this.ticksLeft <= 0) return true;
        const elapsed = this.duration - this.ticksLeft;
        if (!this.fadeSoundPlayed &&
            this.specialSound &&
            this.fadeSoundTime > 0 &&
            elapsed >= this.duration - this.fadeSoundTime) {
            this.fadeSoundPlayed = true;
            game.events.dispatch(new TriggerSoundFxEvent(this.specialSound, this.tile));
        }
        this.ticksLeft--;
        return this.ticksLeft <= 0;
    }

    private configure(game: Game): void {
        if (this.configured) return;
        this.configured = true;
        this.duration = normalizeFrames(
            finiteOr(
                this.settings?.protectDuration,
                generalNumber(game, "forceShieldDuration", 500),
            ),
        );
        this.ticksLeft = this.duration;
        this.fadeSoundTime = normalizeFrames(
            finiteOr(
                this.settings?.protectPlayFadeSoundTime,
                generalNumber(game, "forceShieldPlayFadeSoundTime", 0),
            ),
        );
        this.specialSound = soundName(this.settings?.specialSound);
    }
}
