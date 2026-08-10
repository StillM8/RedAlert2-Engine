import { CompositeDisposable } from '../util/disposable/CompositeDisposable';
export class CanvasMetrics {
    public x: number;
    public y: number;
    public width: number;
    public height: number;
    public displayWidth: number;
    public displayHeight: number;
    private canvas: HTMLCanvasElement;
    private window: Window;
    private disposables: CompositeDisposable;
    private updateCanvasBoxMetrics: () => void;
    constructor(canvas: HTMLCanvasElement, window: Window) {
        this.canvas = canvas;
        this.window = window;
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.displayWidth = 0;
        this.displayHeight = 0;
        this.disposables = new CompositeDisposable();
        this.updateCanvasBoxMetrics = () => {
            const rect = this.canvas.getBoundingClientRect();
            this.x = rect.left + this.window.scrollX;
            this.y = rect.top + this.window.scrollY;
            // Logical (CSS) size, NOT canvas.width: with a renderer pixel ratio
            // the backing store is logical x ratio, while scenes, cameras and
            // pointer consumers all work in logical units. clientWidth is 0
            // only before the canvas is attached — then the backing store still
            // equals the logical size (ratio is applied after init).
            this.width = this.canvas.clientWidth || this.canvas.width;
            this.height = this.canvas.clientHeight || this.canvas.height;
            this.displayWidth = rect.width || this.canvas.clientWidth || this.width;
            this.displayHeight = rect.height || this.canvas.clientHeight || this.height;
        };
    }
    init(): void {
        this.updateCanvasBoxMetrics();
        this.window.addEventListener('resize', this.updateCanvasBoxMetrics);
        this.window.visualViewport?.addEventListener('resize', this.updateCanvasBoxMetrics);
        this.disposables.add(() => this.window.removeEventListener('resize', this.updateCanvasBoxMetrics));
        this.disposables.add(() => this.window.visualViewport?.removeEventListener('resize', this.updateCanvasBoxMetrics));
    }
    notifyViewportChange(): void {
        this.updateCanvasBoxMetrics();
    }
    toCanvasPosition(pageX: number, pageY: number): { x: number; y: number; } {
        return this.toCanvasClientPosition(
            pageX - (this.window.scrollX || 0),
            pageY - (this.window.scrollY || 0),
        );
    }
    /**
     * Convert a browser viewport coordinate to the renderer's logical
     * coordinate space. This must be based on the current DOM rect rather than
     * MouseEvent.offsetX: the game root is CSS-scaled on phones and Android
     * WebView may change its side insets after the first frame.
     */
    toCanvasClientPosition(clientX: number, clientY: number): { x: number; y: number; } {
        this.updateCanvasBoxMetrics();
        const scrollX = this.window.scrollX || 0;
        const scrollY = this.window.scrollY || 0;
        return this.scaleDisplayPosition({
            x: clientX - (this.x - scrollX),
            y: clientY - (this.y - scrollY),
        });
    }
    toCanvasOffset(offsetX: number, offsetY: number): { x: number; y: number; } {
        return this.scaleDisplayPosition({ x: offsetX, y: offsetY });
    }
    private scaleDisplayPosition(position: { x: number; y: number; }): { x: number; y: number; } {
        const scaleX = this.displayWidth > 0 ? this.width / this.displayWidth : 1;
        const scaleY = this.displayHeight > 0 ? this.height / this.displayHeight : 1;
        return {
            x: position.x * scaleX,
            y: position.y * scaleY,
        };
    }
    dispose(): void {
        this.disposables.dispose();
    }
}
