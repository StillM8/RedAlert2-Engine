export class RadarTrait {
    private disabled: boolean;
    private activeEvents: any[];
    constructor() {
        this.disabled = true;
        this.activeEvents = [];
    }
    isDisabled(): boolean {
        return this.disabled;
    }
    setDisabled(value: boolean): void {
        this.disabled = value;
    }
    captureState(): { version: 1; disabled: boolean } {
        return { version: 1, disabled: this.disabled };
    }
    restoreState(state: unknown): void {
        if (!state || typeof state !== "object" || (state as any).version !== 1 || typeof (state as any).disabled !== "boolean") {
            throw new Error("Invalid player radar state");
        }
        this.disabled = (state as any).disabled;
    }
    getHash(): number {
        return this.disabled ? 1 : 0;
    }
}
