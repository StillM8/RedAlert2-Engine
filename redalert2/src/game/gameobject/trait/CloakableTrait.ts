import { ObjectCloakChangeEvent } from "@/game/event/ObjectCloakChangeEvent";
import { GameSpeed } from "@/game/GameSpeed";
import { NotifyDamage } from "@/game/gameobject/trait/interface/NotifyDamage";
import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
export class CloakableTrait {
    private gameObject: any;
    private cloakDelayMinutes: number;
    private readonly initiallyCloakable: boolean;
    private aresAttachEffectSource = false;
    private isActive: boolean;
    private cooldownTicks: number;
    /**
     * Ares keeps a separate CloakSkipTimer for effects such as SonarPulse.
     * Keep that timer separate from the ordinary cloak cooldown so repeated
     * detection effects cannot accidentally shorten an existing suppression.
     */
    private cloakSkipTicks: number;
    constructor(gameObject: any, cloakDelayMinutes: number, initiallyCloakable = true) {
        this.gameObject = gameObject;
        this.cloakDelayMinutes = cloakDelayMinutes;
        this.initiallyCloakable = initiallyCloakable;
        this.isActive = false;
        this.cloakSkipTicks = 0;
        this.resetCloakCooldown();
    }
    isCloaked(): boolean {
        return this.isActive;
    }
    /** Whether the object currently has any source that grants cloaking. */
    isCloakable(): boolean {
        return this.initiallyCloakable || this.aresAttachEffectSource;
    }
    /**
     * Ares AttachEffect.Cloakable is a temporary capability, not a second
     * permanent Cloakable=yes flag.  Keep it as an independent source so an
     * effect can expire without removing a unit's original or veteran cloak.
     */
    setAresAttachEffectSource(enabled: boolean, context?: any): void {
        const next = enabled === true;
        if (next === this.aresAttachEffectSource) return;
        const wasCloaked = this.isActive;
        this.aresAttachEffectSource = next;
        if (next) {
            this.resetCloakCooldown();
        }
        else if (wasCloaked && !this.isCloakable()) {
            this.uncloak(context);
        }
    }
    uncloak(context: any): void {
        const wasActive = this.isActive;
        this.resetCloakCooldown();
        if (wasActive) {
            this.isActive = false;
            context?.events?.dispatch?.(new ObjectCloakChangeEvent(this.gameObject));
        }
    }
    /**
     * Force detection and prevent recloaking for at least `durationTicks`.
     *
     * This is intentionally generic rather than SonarPulse-specific.  The
     * Antares runtime starts CloakSkipTimer with the maximum of the existing
     * timer and the effect delay, so this method preserves the longest active
     * suppression while retaining the normal cloak cooldown as a second gate.
     */
    forceUncloak(context: any, durationTicks: number): void {
        const duration = Math.max(0, Math.floor(Number.isFinite(durationTicks) ? durationTicks : 0));
        this.cloakSkipTicks = Math.max(this.cloakSkipTicks, duration);
        this.resetCloakCooldown();
        const wasActive = this.isActive;
        if (wasActive) {
            this.isActive = false;
            context.events.dispatch(new ObjectCloakChangeEvent(this.gameObject));
        }
    }
    getCloakSkipTimeLeft(): number {
        return this.cloakSkipTicks;
    }
    resetCloakCooldown(): void {
        this.cooldownTicks = Math.floor(60 * this.cloakDelayMinutes * GameSpeed.BASE_TICKS_PER_SECOND);
    }
    [NotifySpawn.onSpawn](target: any, context: any): void {
        this.cloakSkipTicks = 0;
        this.resetCloakCooldown();
    }
    [NotifyTick.onTick](target: any, context: any): void {
        if (this.cooldownTicks > 0) {
            this.cooldownTicks--;
        }
        if (this.cloakSkipTicks > 0) {
            this.cloakSkipTicks--;
        }
        if (this.cooldownTicks <= 0 &&
            this.cloakSkipTicks <= 0 &&
            this.isCloakable() &&
            !this.isActive &&
            !(target.isVehicle() &&
                target.submergibleTrait &&
                !target.submergibleTrait.isSubmerged()) &&
            !target.temporalTrait.getTarget() &&
            !(target.operatorTrait?.isOffline?.() === true)) {
            this.isActive = true;
            context.events.dispatch(new ObjectCloakChangeEvent(this.gameObject));
        }
    }
    [NotifyDamage.onDamage](target: any, context: any): void {
        this.uncloak(context);
    }
    dispose(): void {
        this.gameObject = undefined;
    }
}
