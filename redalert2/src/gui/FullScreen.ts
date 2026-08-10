import { CompositeDisposable } from '../util/disposable/CompositeDisposable';
import { setupFullScreenChangeListener } from '../util/fullScreen';
import { EventDispatcher } from '../util/event';
import { isNativeShell } from '../shell/nativeShell';
export interface HotKey {
    altKey: boolean;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    keyCode: number;
}
export class FullScreen {
    public static readonly hotKey: HotKey = {
        altKey: true,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        keyCode: "F".charCodeAt(0),
    };
    private readonly document: Document;
    private readonly disposables: CompositeDisposable;
    private readonly _onChange: EventDispatcher<FullScreen, boolean>;
    public get onChange() {
        return this._onChange.asEvent();
    }
    constructor(document: Document) {
        this.document = document;
        this.disposables = new CompositeDisposable();
        this._onChange = new EventDispatcher<FullScreen, boolean>();
    }
    public static isFullScreenHotKey(event: KeyboardEvent): boolean {
        return (event.keyCode === this.hotKey.keyCode &&
            event.altKey === this.hotKey.altKey &&
            event.shiftKey === this.hotKey.shiftKey &&
            event.ctrlKey === this.hotKey.ctrlKey &&
            event.metaKey === this.hotKey.metaKey);
    }
    public init(): void {
        const keyDownHandler = (event: KeyboardEvent) => {
            if (FullScreen.isFullScreenHotKey(event)) {
                event.preventDefault();
                event.stopPropagation();
                this.toggle();
            }
        };
        this.document.addEventListener("keydown", keyDownHandler);
        this.disposables.add(() => this.document.removeEventListener("keydown", keyDownHandler));
        const cleanup = setupFullScreenChangeListener(this.document, this.handleFullScreenChange);
        if (cleanup) {
            this.disposables.add(cleanup);
        }
    }
    private handleFullScreenChange = (isFullScreen: boolean): void => {
        this._onChange.dispatch(this, isFullScreen);
    };
    public toggle(): void {
        this.toggleAsync().catch((error) => console.error(error));
    }
    public isFullScreen(): boolean {
        // The native shell owns the entire screen; there is no windowed state.
        if (isNativeShell())
            return true;
        return !!this.document.fullscreenElement;
    }
    public isAvailable(): boolean {
        if (isNativeShell())
            return false;
        return !!(this.document.fullscreenEnabled ||
            (this.document as any).webkitFullscreenEnabled);
    }
    public async toggleAsync(): Promise<void> {
        if (isNativeShell())
            return;
        if (this.document.fullscreenElement) {
            try {
                screen?.orientation?.unlock?.();
            }
            catch (_error) {
            }
            await this.document.exitFullscreen();
        }
        else {
            await this.document.documentElement.requestFullscreen();
            try {
                await (screen?.orientation as any)?.lock?.("landscape");
            }
            catch (error) {
                console.warn("Orientation lock failed", error);
            }
        }
    }
    public dispose(): void {
        this.disposables.dispose();
    }
}
