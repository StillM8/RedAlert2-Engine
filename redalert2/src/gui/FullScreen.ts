import { CompositeDisposable } from '../util/disposable/CompositeDisposable';
import { setupFullScreenChangeListener } from '../util/fullScreen';
import { EventDispatcher } from '../util/event';
import { isNativeShell, isTauriDesktopShell } from '../shell/nativeShell';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
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
    private tauriWindow?: TauriWindow;
    private tauriWindowPromise?: Promise<TauriWindow>;
    private tauriUnlistenResize?: () => void;
    private tauriFullscreenState?: boolean;
    private disposed = false;
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
            const isTauriF11 = isTauriDesktopShell() && event.key === 'F11';
            if (FullScreen.isFullScreenHotKey(event) || isTauriF11) {
                event.preventDefault();
                event.stopPropagation();
                this.toggle();
            }
        };
        this.document.addEventListener("keydown", keyDownHandler);
        this.disposables.add(() => this.document.removeEventListener("keydown", keyDownHandler));
        // Tauri owns the native window state. Do not also register the
        // browser Fullscreen API here: its F11 keyup handler can race the
        // native toggle and leave the WebView in a second fullscreen mode.
        if (!isTauriDesktopShell()) {
            const cleanup = setupFullScreenChangeListener(this.document, this.handleFullScreenChange);
            if (cleanup) {
                this.disposables.add(cleanup);
            }
        }
        if (isTauriDesktopShell()) {
            void this.initTauriWindow();
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
        if (isTauriDesktopShell()) {
            // The Tauri window is configured fullscreen at startup. Use the
            // display bounds until the asynchronous window API has reported
            // its exact state, so the first layout is correct as well.
            return this.tauriFullscreenState ?? this.isTauriWindowSizedToDisplay();
        }
        return !!this.document.fullscreenElement;
    }
    public isAvailable(): boolean {
        if (isNativeShell())
            return false;
        if (isTauriDesktopShell())
            return true;
        return !!(this.document.fullscreenEnabled ||
            (this.document as any).webkitFullscreenEnabled);
    }
    public async toggleAsync(): Promise<void> {
        if (isNativeShell())
            return;
        if (isTauriDesktopShell()) {
            const tauriWindow = await this.getTauriWindow();
            const nextState = !(await tauriWindow.isFullscreen());
            await tauriWindow.setFullscreen(nextState);
            this.updateTauriFullscreenState(nextState);
            return;
        }
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
        this.disposed = true;
        this.tauriUnlistenResize?.();
        this.tauriUnlistenResize = undefined;
        this.disposables.dispose();
    }

    private async getTauriWindow(): Promise<TauriWindow> {
        if (this.tauriWindow) {
            return this.tauriWindow;
        }
        if (!this.tauriWindowPromise) {
            this.tauriWindowPromise = import('@tauri-apps/api/window')
                .then(({ getCurrentWindow }) => {
                    this.tauriWindow = getCurrentWindow();
                    return this.tauriWindow;
                });
        }
        return this.tauriWindowPromise;
    }

    private async initTauriWindow(): Promise<void> {
        try {
            const tauriWindow = await this.getTauriWindow();
            await this.syncTauriFullscreenState(tauriWindow);
            const unlisten = await tauriWindow.onResized(() => {
                void this.syncTauriFullscreenState(tauriWindow);
            });
            if (this.disposed) {
                unlisten();
            }
            else {
                this.tauriUnlistenResize = unlisten;
            }
        }
        catch (error) {
            console.warn('Tauri fullscreen API unavailable:', error);
        }
    }

    private async syncTauriFullscreenState(tauriWindow: TauriWindow): Promise<void> {
        try {
            this.updateTauriFullscreenState(await tauriWindow.isFullscreen());
        }
        catch (error) {
            console.warn('Could not read Tauri fullscreen state:', error);
        }
    }

    private updateTauriFullscreenState(isFullScreen: boolean): void {
        if (this.tauriFullscreenState === isFullScreen) {
            return;
        }
        this.tauriFullscreenState = isFullScreen;
        this._onChange.dispatch(this, isFullScreen);
    }

    private isTauriWindowSizedToDisplay(): boolean {
        return typeof window !== 'undefined'
            && typeof screen !== 'undefined'
            && window.innerWidth >= screen.width
            && window.innerHeight >= screen.height;
    }
}
