import { NotifyTick } from './interface/NotifyTick';
export class SuppressionTrait {
    private suppressionTicks: number = 0;
    private enabled: boolean = true;
    disable(): void {
        this.enabled = false;
    }
    isSuppressed(): boolean {
        return this.enabled && this.suppressionTicks > 0;
    }
    suppress(): void {
        if (this.enabled) {
            this.suppressionTicks = 30;
        }
    }
    captureState(): Record<string, unknown> {
        return { version: 1, suppressionTicks: this.suppressionTicks, enabled: this.enabled };
    }
    restoreState(state: unknown): void {
        if (!state || typeof state !== "object" || (state as any).version !== 1 ||
            !Number.isSafeInteger((state as any).suppressionTicks) || (state as any).suppressionTicks < 0 ||
            typeof (state as any).enabled !== "boolean") {
            throw new Error("Invalid suppression state");
        }
        this.suppressionTicks = (state as any).suppressionTicks;
        this.enabled = (state as any).enabled;
    }
    [NotifyTick.onTick](): void {
        if (this.suppressionTicks > 0) {
            this.suppressionTicks--;
        }
    }
}
