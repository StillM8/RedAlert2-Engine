import { Anim } from './Anim';
export class TransientAnim extends Anim {
    private container: any;
    private onFinished?: () => void;
    private finished = false;
    public forceOneShot = false;
    constructor(e: any, t: any, i: any, r: any, s: any, a: any, n: any, o: any, l: any, c: any, h: any, onFinished?: () => void) {
        super(e, t, i, r, s, a, n, o, l, undefined, h);
        this.container = c;
        this.onFinished = onFinished;
    }
    update(e: number): void {
        if (this.finished) return;
        if (this.isAnimNotStarted()) {
            const report = this.objectArt.report;
            if (report) {
                this.worldSound?.playEffect(report, this.getPosition());
            }
        }
        super.update(e);
        if (this.forceOneShot) {
            this.endAnimationLoop();
        }
        if (this.isAnimFinished()) {
            this.finished = true;
            this.remove();
            this.dispose();
            const onFinished = this.onFinished;
            this.onFinished = undefined;
            onFinished?.();
        }
    }
    remove(): void {
        this.container.remove(this);
    }
}
