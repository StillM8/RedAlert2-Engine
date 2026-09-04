import { Task } from "./Task";
export class WaitTicksTask extends Task {
    public readonly deterministicType = "wait-ticks";
    private ticks: number;
    constructor(ticks: number) {
        super();
        this.ticks = ticks;
    }
    onTick(): boolean {
        return this.isCancelling() || !(this.ticks-- > 0);
    }

    getDeterministicState(): Record<string, unknown> {
        return { ...super.getDeterministicState(), type: this.deterministicType, ticks: this.ticks };
    }
}
