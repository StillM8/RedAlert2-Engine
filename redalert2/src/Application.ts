import { BoxedVar } from './util/BoxedVar';
import { EventDispatcher } from './util/event';
import { Routing } from './util/Routing';
import { Config } from './Config';
import { IniFile } from './data/IniFile';
import { IniSection } from './data/IniSection';
import SplashScreenComponent from './gui/component/SplashScreen';
import type { ComponentProps } from 'react';
import { CsfFile, CsfLanguage, csfLocaleMap } from './data/CsfFile';
import { Strings, type StringLayerId } from './data/Strings';
import { VirtualFile } from './data/vfs/VirtualFile';
import { DataStream } from './data/DataStream';
import { version as appVersion } from './version';
import { MixFile } from './data/MixFile';
import { GameRes } from './engine/gameRes/GameRes';
import { GameResConfig } from './engine/gameRes/GameResConfig';
import { GameResSource } from './engine/gameRes/GameResSource';
import { LocalPrefs, StorageKey } from './LocalPrefs';
import type { Viewport, ViewportRect } from './gui/Viewport';
import { Gui } from './Gui';
import { BasicErrorBoxApi } from './gui/component/BasicErrorBoxApi';
import { Engine } from './engine/Engine';
import { EngineType } from './engine/EngineType';
import { ResourceLoader } from './engine/ResourceLoader';
import { ImageContext } from './gui/component/ImageContext';
import { ConsoleVars } from './ConsoleVars';
import { GeneralOptions } from './gui/screen/options/GeneralOptions';
import { FullScreen } from './gui/FullScreen';
import { browserFileSystemAccess } from './engine/gameRes/browserFileSystemAccess';
import type { TestToolRuntimeContext } from './tools/TestToolSupport';
import { attachPerformanceOptions, installPerformanceDebugApi } from './performance/PerformanceRuntime';
import { inGameViewportActive } from './gui/inGameViewport';
import { getNativeShellEngine, getNativeShellProfile, isNativeShell } from './shell/nativeShell';
import { getGameProfile, type GameProfileId } from './engine/GameProfile';
import { ContentRegistry } from './content/ContentRegistry';

const optionalDevModuleImporters: Record<string, () => Promise<any>> = {
    './tools/VxlTester': () => import('./tools/VxlTester'),
    './tools/LobbyFormTester': () => import('./tools/LobbyFormTester'),
    './tools/SoundTester': () => import('./tools/SoundTester'),
    './tools/BuildingTester': () => import('./tools/BuildingTester'),
    './tools/InfantryTester': () => import('./tools/InfantryTester'),
    './tools/AircraftTester': () => import('./tools/AircraftTester'),
    './tools/VehicleTester': () => import('./tools/VehicleTester'),
    './tools/TestToolSupport': () => import('./tools/TestToolSupport'),
    './tools/ShpTester': () => import('./tools/ShpTester'),
    './tools/WorldSceneTester': () => import('./tools/WorldSceneTester'),
    './tools/UnitMovementTester': () => import('./tools/UnitMovementTester'),
    './tools/PerformanceTester': () => import('./tools/PerformanceTester'),
    './tools/LiveInteractionTester': () => import('./tools/LiveInteractionTester'),
    './tools/SceneSandboxTester': () => import('./tools/SceneSandboxTester'),
};

export type SplashScreenUpdateCallback = (props: ComponentProps<typeof SplashScreenComponent> | null) => void;
class MockLocalPrefs extends LocalPrefs {
    constructor(storage: Storage) {
        super(storage);
        console.log('MockLocalPrefs initialized');
    }
}
class MockConsoleVars extends ConsoleVars {
    constructor() {
        super();
        console.log('MockConsoleVars initialized');
    }
}
class MockDevToolsApi {
    static registerCommand(name: string, cmd: Function) { console.log(`MockDevToolsApi: registerCommand ${name}`); }
    static registerVar(name: string, bv: BoxedVar<any>) { console.log(`MockDevToolsApi: registerVar ${name}`); }
    static listCommands(): string[] { return []; }
    static listVars(): string[] { return []; }
}
const mockSentry = {
    captureException: (e: any) => console.error("Sentry Mock: captureException", e),
    configureScope: (cb: Function) => cb({ setTag: () => { }, setExtra: () => { } }),
};

function getImportErrorFileField(error: any): string {
    const directField = [error?.file, error?.fileName, error?.filename]
        .find((value) => typeof value === 'string' && value.trim().length > 0);
    if (directField) {
        return directField;
    }
    const message = typeof error?.message === 'string' ? error.message : '';
    const quotedFile = message.match(/\b(?:file|directory)\s+"([^"]+)"/i)?.[1];
    if (quotedFile) {
        return quotedFile;
    }
    return '';
}

function formatImportFileNotFound(template: string, error: any): string {
    const fileField = getImportErrorFileField(error);
    if (fileField) {
        return template.indexOf("%s") >= 0
            ? template.replace(/%s/g, fileField)
            : `${template} ${fileField}`;
    }
    return error?.message ? `${template}\n\n${error.message}` : template;
}
class ViewportAdapter implements Viewport {
    constructor(private boxedVar: BoxedVar<ViewportRect>) { }
    get value(): ViewportRect {
        return this.boxedVar.value;
    }
    getValue(): ViewportRect {
        return this.boxedVar.value;
    }
    rootElement?: HTMLElement;
}
export class Application {
    private static readonly MOBILE_BASE_VIEWPORT = { width: 800, height: 600 };
    // In-game the HUD scales fine below the menus' 600px design height, so a
    // smaller logical resolution buys a much larger (more readable) UI on phones.
    private static readonly MOBILE_GAME_VIEWPORT = { width: 800, height: 480 };
    private static readonly MIN_DESKTOP_VIEWPORT = { width: 800, height: 600 };
    private async importOptionalDevModule<T = any>(path: string): Promise<T> {
        const importer = optionalDevModuleImporters[path];
        if (!importer) {
            throw new Error(`Unknown optional dev module: ${path}`);
        }
        return importer();
    }
    private formatString(template: string, ...args: any[]): string {
        if (!args || args.length === 0)
            return template;
        let result = template;
        for (let i = 0; i < args.length; i++) {
            const placeholder = new RegExp(`%s|%d`, 'i');
            result = result.replace(placeholder, String(args[i]));
        }
        return result;
    }
    public viewport: BoxedVar<ViewportRect>;
    private viewportAdapter: ViewportAdapter;
    public config!: Config;
    private strings!: Strings;
    private localPrefs: LocalPrefs;
    private rootEl: HTMLElement | null = null;
    private runtimeVars: MockConsoleVars;
    private fullScreen: FullScreen;
    private generalOptions: GeneralOptions;
    public routing: Routing;
    private sentry: typeof mockSentry | undefined = mockSentry;
    private currentLocale: string = 'en-US';
    private fsAccessLib: any;
    private gameResConfig: GameResConfig | undefined;
    private cdnResourceLoader: any;
    private gpuTier: any;
    private splashScreenUpdateCallback?: SplashScreenUpdateCallback;
    private gui?: Gui;
    private preferredViewportSize?: {
        width: number;
        height: number;
    } | null;
    private hasLoadedGeneralOptionsFromStorage: boolean = false;
    private readonly handleViewportEnvironmentChange = () => this.updateViewportSize();
    private readonly handlePreferredResolutionChange = (resolution?: {
        width: number;
        height: number;
    }) => this.setPreferredViewportSize(resolution);
    private readonly handleForceResolutionChange = (value?: string) => {
        if (!value?.match(/^\d+x\d+$/)) {
            return;
        }
        const [width, height] = value.split('x').map(Number);
        this.setPreferredViewportSize({ width, height });
    };
    constructor(splashScreenUpdateCallback?: SplashScreenUpdateCallback) {
        this.viewport = new BoxedVar({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
        this.viewportAdapter = new ViewportAdapter(this.viewport);
        this.routing = new Routing();
        this.splashScreenUpdateCallback = splashScreenUpdateCallback;
        this.localPrefs = new MockLocalPrefs(localStorage);
        this.runtimeVars = new MockConsoleVars();
        this.generalOptions = new GeneralOptions();
        this.loadGeneralOptions();
        this.bindPerformanceRuntimeVars();
        this.fullScreen = new FullScreen(document);
        inGameViewportActive.onChange.subscribe(() => this.updateViewportSize());
        this.updateViewportSize();
        console.log('Application constructor finished.');
    }
    public getVersion(): string {
        return appVersion;
    }
    private async loadConfig(): Promise<void> {
        console.log('[Application] Attempting to load config.ini...');
        try {
            const response = await fetch('/config.ini');
            if (!response.ok) {
                throw new Error(`Failed to fetch config.ini: ${response.status} ${response.statusText}`);
            }
            const iniString = await response.text();
            const iniFileInstance = new IniFile(iniString);
            this.config = new Config();
            this.config.load(iniFileInstance);
            const shellEngine = isNativeShell() ? getNativeShellEngine() : undefined;
            const persistedEngine = isNativeShell() ? localStorage.getItem('_ra2_native_engine') : null;
            const nativeEngine = shellEngine ?? (persistedEngine === 'yr' ? 'yr' : persistedEngine === 'ra2' ? 'ra2' : undefined);
            if (nativeEngine === 'ra2' || nativeEngine === 'yr') {
                this.config.getGeneralData().set('engine', nativeEngine);
                console.log(`[Application] Native shell selected ${nativeEngine} engine${shellEngine ? ' from the Android app variant' : ' from imported archives'}.`);
            }
            console.log('[Application] config.ini loaded and parsed successfully.');
            console.log('[Application] Config object dump:', this.config);
            console.log('[Application] Verification: Default Locale from config:', this.config.defaultLocale);
            console.log('[Application] Verification: Viewport Width from config:', this.config.viewport.width);
            console.log('[Application] Verification: Dev Mode from config:', this.config.devMode);
            console.log('[Application] Verification: Servers URL from config:', this.config.serversUrl);
        }
        catch (error) {
            console.error('[Application] Failed to parse config:', error);
            console.error('[Application] Config parsing failed. Using minimal defaults.');
            this.config = new Config();
            console.error("Failed to load application configuration (config.ini). Using minimal defaults. Some features may not work.");
        }
    }
    private async loadTranslations(): Promise<void> {
        const currentConfig = this.config;
        if (!currentConfig) {
            console.error("[Application] Config not loaded before loadTranslations. Skipping.");
            this.strings = new Strings();
            this.currentLocale = 'en-US';
            return;
        }
        let csfFileValue = currentConfig.getGeneralData().get('csfFile') || 'ra2/general.csf';
        const csfFileName = Array.isArray(csfFileValue) ? csfFileValue[0] : csfFileValue;
        console.log(`[Application] Attempting to load CSF file: ${csfFileName}`);
        try {
            const csfResponse = await fetch(`/${csfFileName}`);
            if (!csfResponse.ok) {
                throw new Error(`Failed to fetch CSF file ${csfFileName}: ${csfResponse.status} ${csfResponse.statusText}`);
            }
            const arrayBuffer = await csfResponse.arrayBuffer();
            const dataStream = new DataStream(arrayBuffer, 0, DataStream.LITTLE_ENDIAN);
            dataStream.dynamicSize = false;
            const virtualFile = new VirtualFile(dataStream, csfFileName);
            const csfFileInstance = new CsfFile(virtualFile);
            this.strings = new Strings();
            this.strings.fromCsf(csfFileInstance, 'application-fallback', { file: csfFileName });
            this.currentLocale = csfFileInstance.getIsoLocale() || currentConfig.defaultLocale;
            console.log(`[Application] CSF file "${csfFileName}" loaded. Detected/Set Locale: ${this.currentLocale}. Loaded ${Object.keys(this.strings.getKeys()).length} keys from CSF.`);
        }
        catch (error) {
            console.error(`[Application] Failed to load or parse CSF file "${csfFileName}":`, error);
            console.warn('[Application] Falling back to empty Strings object for CSF part.');
            this.strings = new Strings();
            this.currentLocale = currentConfig.defaultLocale;
        }
        const jsonLocaleFile = `res/locale/${this.currentLocale}.json?v=${this.getVersion()}`;
        console.log(`[Application] Attempting to load JSON locale file: ${jsonLocaleFile}`);
        try {
            const jsonResponse = await fetch(`/${jsonLocaleFile}`);
            if (!jsonResponse.ok) {
                throw new Error(`Failed to fetch JSON locale ${jsonLocaleFile}: ${jsonResponse.status} ${jsonResponse.statusText}`);
            }
            const jsonData = await jsonResponse.json();
            if (jsonData) {
                this.strings.fromJson(jsonData, 'application-fallback', { file: jsonLocaleFile });
                console.log(`[Application] JSON locale file "${jsonLocaleFile}" loaded and merged. Total keys now: ${Object.keys(this.strings.getKeys()).length}.`);
            }
            else {
                console.warn(`[Application] JSON locale file "${jsonLocaleFile}" parsed to null or undefined data.`);
            }
        }
        catch (error) {
            console.error(`[Application] Failed to load or parse JSON locale file "${jsonLocaleFile}":`, error);
            console.warn(`[Application] Continuing without strings from ${jsonLocaleFile}.`);
        }
        console.log('[Application] Translations loading finished. Final locale: ', this.currentLocale);
        console.log('[Application] Sample string GUI:OKAY ->', this.strings.get('GUI:OKAY'));
        console.log('[Application] Sample string GUI:Cancel ->', this.strings.get('GUI:Cancel'));
        console.log('[Application] Sample string GUI:LoadingEx ->', this.strings.get('GUI:LoadingEx'));
        console.log('[Application] First 20 keys in Strings:', this.strings.getKeys().slice(0, 20));
    }
    /**
     * On the native shell the retail CSF is inside language.mix/langmd.mix,
     * so it cannot be fetched as /generalmd.csf before GameRes has initialized
     * the VFS. Merge that CSF now, before Gui is constructed. JSON translations
     * remain authoritative for keys that the web UI already provides.
     */
    private loadGameStringsFromVfs(): void {
        const vfs = Engine.vfs;
        if (!vfs || !this.strings) {
            return;
        }
        const profile = Engine.getActiveProfile();
        const isYuri = Engine.getActiveEngine() === EngineType.YurisRevenge;
        const candidates: Array<{ fileName: string; layer: StringLayerId }> = [
            { fileName: 'ra2.csf', layer: 'retail-base' },
            { fileName: 'general.csf', layer: 'retail-base' },
            ...(isYuri ? [
                { fileName: 'ra2md.csf', layer: 'retail-expansion' as StringLayerId },
                { fileName: 'generalmd.csf', layer: 'retail-expansion' as StringLayerId },
                { fileName: 'stringtable00.csf', layer: 'retail-expansion' as StringLayerId },
                { fileName: 'stringtable01.csf', layer: 'retail-expansion' as StringLayerId },
            ] : []),
            ...(profile.stringFileCandidates ?? []).map((fileName) => ({
                fileName,
                layer: 'profile' as StringLayerId,
            })),
        ];
        let loadedCsf = false;
        for (const { fileName, layer } of candidates) {
            if (!vfs.fileExists(fileName)) {
                continue;
            }
            try {
                const csf = new CsfFile(vfs.openFile(fileName));
                const resolution = vfs.explain(fileName);
                const before = this.strings.getKeys().length;
                this.strings.fromCsf(csf, layer, {
                    file: fileName,
                    archive: resolution.winner?.archive,
                });
                const added = this.strings.getKeys().length - before;
                console.log(`[Application] Merged ${Object.keys(csf.data).length} ${layer} strings from VFS CSF "${fileName}" (${added} new keys).`);
                loadedCsf = true;
            }
            catch (error) {
                console.warn(`[Application] Failed to parse VFS CSF "${fileName}":`, error);
            }
        }
        // Keep the most visible native labels readable even when a custom
        // resource set omits its language archive.
        for (const [key, value] of Object.entries({
            'GUI:Options': 'Options',
            'GUI:Optionss': 'Options',
            'TXT_READY': 'Ready',
            'TXT_HOLD': 'Hold',
            'TXT_PRIMARY': 'Primary',
        })) {
            if (!this.strings.has(key)) {
                this.strings.setLayerValue(key, value, 'application-fallback', { file: 'built-in-fallbacks' });
            }
        }
        if (!loadedCsf) {
            console.warn('[Application] No readable retail CSF found in the VFS; using built-in label fallbacks.');
        }
    }
    private checkGlobalLibs(): void {
        console.log('[MVP] Skipping Application.checkGlobalLibs().');
    }
    private async initLogging(): Promise<void> {
        console.log('[MVP] Skipping Application.initLogging().');
    }
    private loadGeneralOptions(): void {
        const optionsData = this.localPrefs.getItem(StorageKey.Options);
        if (optionsData) {
            try {
                this.generalOptions.unserialize(optionsData);
                this.hasLoadedGeneralOptionsFromStorage = true;
                console.log('[Application] Loaded general options from local storage');
            }
            catch (error) {
                console.warn('[Application] Failed to read general options from local storage', error);
            }
        }
    }
    private initializePreferredViewportSize(): void {
        if (!this.hasLoadedGeneralOptionsFromStorage && this.generalOptions.graphics.resolution.value === undefined) {
            const defaultViewportSize = {
                width: this.config?.viewport?.width ?? 1024,
                height: this.config?.viewport?.height ?? 768,
            };
            this.generalOptions.graphics.resolution.value = defaultViewportSize;
            this.preferredViewportSize = defaultViewportSize;
            console.log('[Application] Initialized preferred viewport size from config defaults', defaultViewportSize);
            return;
        }
        this.preferredViewportSize = this.generalOptions.graphics.resolution.value
            ? { ...this.generalOptions.graphics.resolution.value }
            : null;
        console.log('[Application] Initialized preferred viewport size from options', this.preferredViewportSize);
    }
    private bindPerformanceRuntimeVars(): void {
        const performanceOptions = this.generalOptions.performance;
        this.runtimeVars.perfRaycastHelperReuse = performanceOptions.raycastHelperReuse;
        this.runtimeVars.perfEntityIntersectTraversal = performanceOptions.entityIntersectTraversal;
        this.runtimeVars.perfMapTileHitTest = performanceOptions.mapTileHitTest;
        this.runtimeVars.perfWorldViewportCache = performanceOptions.worldViewportCache;
        this.runtimeVars.perfWorldSoundLoopCache = performanceOptions.worldSoundLoopCache;
        this.runtimeVars.perfTelemetry = performanceOptions.telemetry;
        attachPerformanceOptions(performanceOptions);
        const debugRoot = ((window as any).__ra2debug ??= {});
        debugRoot.generalOptions = this.generalOptions;
        debugRoot.runtimeVars = this.runtimeVars;
        installPerformanceDebugApi(debugRoot);
    }
    private setPreferredViewportSize(resolution?: {
        width: number;
        height: number;
    }): void {
        this.preferredViewportSize = resolution ? { ...resolution } : null;
        console.log('[Application] setPreferredViewportSize', this.preferredViewportSize ?? 'fit-window');
        this.updateViewportSize(this.fullScreen.isFullScreen());
    }
    private getRequestedResolution(): { width: number; height: number; } | undefined {
        if (this.preferredViewportSize === undefined) {
            return this.generalOptions.graphics.resolution.value;
        }
        return this.preferredViewportSize ?? undefined;
    }
    private isMobileLayout(): boolean {
        return !!window.matchMedia?.('(pointer: coarse)')?.matches;
    }
    private getAvailableDisplaySize(): { width: number; height: number; } {
        const viewport = window.visualViewport;
        let width = Math.floor(viewport?.width ?? window.innerWidth ?? document.documentElement.clientWidth ?? Application.MOBILE_BASE_VIEWPORT.width);
        let height = Math.floor(viewport?.height ?? window.innerHeight ?? document.documentElement.clientHeight ?? Application.MOBILE_BASE_VIEWPORT.height);
        // The root element is centred inside <body>, whose safe-area padding
        // shrinks the box it actually gets. Scaling to the full visual viewport
        // therefore made the root taller than its container and, because the
        // transform is about the centre, the overflow split evenly and clipped
        // both ends — measured on iPad: 12.4px cut off the top of the menus with
        // a matching dead strip below. Fit to the content box instead.
        const bodyStyle = document.body && window.getComputedStyle?.(document.body);
        if (bodyStyle) {
            const pad = (value: string) => {
                const n = Number.parseFloat(value);
                return Number.isFinite(n) ? n : 0;
            };
            width -= pad(bodyStyle.paddingLeft) + pad(bodyStyle.paddingRight);
            height -= pad(bodyStyle.paddingTop) + pad(bodyStyle.paddingBottom);
        }
        return {
            width: Math.max(1, Math.floor(width)),
            height: Math.max(1, Math.floor(height)),
        };
    }
    private normalizeViewportDimension(value: number, minimum: number): number {
        const normalized = Math.max(minimum, Math.floor(value));
        return normalized - (normalized % 2);
    }
    private computeDesktopViewportSize(availableSize: {
        width: number;
        height: number;
    }): {
        width: number;
        height: number;
    } {
        if (this.preferredViewportSize === null) {
            return {
                width: this.normalizeViewportDimension(availableSize.width, Application.MIN_DESKTOP_VIEWPORT.width),
                height: this.normalizeViewportDimension(availableSize.height, Application.MIN_DESKTOP_VIEWPORT.height),
            };
        }
        const requestedResolution = this.getRequestedResolution();
        const defaultWidth = this.config?.viewport?.width ?? 1024;
        const defaultHeight = this.config?.viewport?.height ?? 768;
        const targetWidth = requestedResolution?.width ?? defaultWidth;
        const targetHeight = requestedResolution?.height ?? defaultHeight;
        return {
            width: this.normalizeViewportDimension(Math.min(availableSize.width, targetWidth), Application.MIN_DESKTOP_VIEWPORT.width),
            height: this.normalizeViewportDimension(Math.min(availableSize.height, targetHeight), Application.MIN_DESKTOP_VIEWPORT.height),
        };
    }
    private computeViewportSize(isFullScreen: boolean, availableSize: { width: number; height: number; }, mobileLayout: boolean): {
        width: number;
        height: number;
    } {
        if (isFullScreen) {
            if (mobileLayout) {
                // Aspect-fill from the design base: one axis pinned to the base
                // (so UI elements have a consistent physical size), the other
                // extended to match the screen's aspect ratio. The display scale
                // may exceed 1 (upscale) — essential on tablets, where the raw
                // resolution would otherwise render the 800px-design UI tiny.
                const mobileBase = inGameViewportActive.value
                    ? Application.MOBILE_GAME_VIEWPORT
                    : Application.MOBILE_BASE_VIEWPORT;
                const availableAspect = availableSize.width / availableSize.height;
                const mobileAspect = mobileBase.width / mobileBase.height;
                let width: number;
                let height: number;
                if (availableAspect > mobileAspect) {
                    height = mobileBase.height;
                    width = Math.round(height * availableAspect);
                } else {
                    width = mobileBase.width;
                    height = Math.round(width / availableAspect);
                }
                return {
                    width: this.normalizeViewportDimension(width, mobileBase.width),
                    height: this.normalizeViewportDimension(height, mobileBase.height),
                };
            }
            return {
                width: this.normalizeViewportDimension(availableSize.width, 2),
                height: this.normalizeViewportDimension(availableSize.height, 2),
            };
        }
        if (mobileLayout) {
            const mobileBase = inGameViewportActive.value
                ? Application.MOBILE_GAME_VIEWPORT
                : Application.MOBILE_BASE_VIEWPORT;
            return {
                width: this.normalizeViewportDimension(mobileBase.width, mobileBase.width),
                height: this.normalizeViewportDimension(mobileBase.height, mobileBase.height),
            };
        }
        return this.computeDesktopViewportSize(availableSize);
    }
    private computeViewportLayout(isFullScreen: boolean): ViewportRect {
        const availableSize = this.getAvailableDisplaySize();
        const mobileLayout = this.isMobileLayout();
        const logicalSize = this.computeViewportSize(isFullScreen, availableSize, mobileLayout);
        const rawScale = Math.min(availableSize.width / logicalSize.width, availableSize.height / logicalSize.height);
        // Mobile layouts may upscale (tablets); desktop windows never do.
        const scale = mobileLayout ? rawScale : Math.min(1, rawScale);
        return {
            x: 0,
            y: 0,
            width: logicalSize.width,
            height: logicalSize.height,
            displayWidth: Math.max(1, Math.round(logicalSize.width * scale)),
            displayHeight: Math.max(1, Math.round(logicalSize.height * scale)),
            scale,
            isMobileLayout: mobileLayout,
            isPortrait: availableSize.height > availableSize.width,
        };
    }
    private applyRootLayout(viewport: ViewportRect): void {
        if (!this.rootEl) {
            return;
        }
        this.rootEl.style.width = `${viewport.width}px`;
        this.rootEl.style.height = `${viewport.height}px`;
        this.rootEl.style.transform = viewport.scale && viewport.scale !== 1 ? `scale(${viewport.scale})` : '';
        this.rootEl.style.transformOrigin = 'center center';
        this.rootEl.style.willChange = 'transform';
        this.rootEl.dataset.mobileLayout = String(Boolean(viewport.isMobileLayout));
        this.rootEl.dataset.orientation = viewport.isPortrait ? 'portrait' : 'landscape';
        this.rootEl.dataset.compactLayout = String(viewport.height <= 640 || viewport.width <= 800);
    }
    private isNativeFullScreen(): boolean {
        const width = window.innerWidth ?? 0;
        const height = window.innerHeight ?? 0;
        return width >= screen.width && height >= screen.height;
    }
    private updateViewportSize(isFullScreen: boolean = this.fullScreen.isFullScreen() || this.isNativeFullScreen()): void {
        const nextViewport = this.computeViewportLayout(isFullScreen);
        // Apply the DOM layout (size + scale transform) BEFORE announcing the
        // change: viewport subscribers (Gui) re-measure the canvas rect for
        // input mapping, and measuring against the old transform leaves every
        // pointer/touch position mapped through a stale scale.
        this.applyRootLayout(nextViewport);
        this.viewport.value = nextViewport;
        console.log('[Application] updateViewportSize', {
            viewport: `${nextViewport.width}x${nextViewport.height}`,
            display: `${nextViewport.displayWidth}x${nextViewport.displayHeight}`,
            scale: nextViewport.scale,
            fullScreen: isFullScreen,
            mobileLayout: nextViewport.isMobileLayout,
            portrait: nextViewport.isPortrait,
        });
    }
    private onFullScreenChange(isFullScreen: boolean): void {
        console.log(`[Application] onFullScreenChange: ${isFullScreen}`);
        this.updateViewportSize(isFullScreen);
    }
    private async loadGpuBenchmarkData(): Promise<any> {
        console.log('[MVP] Skipping Application.loadGpuBenchmarkData()');
        return { tier: 1, type: 'MOCK_GPU' };
    }
    public async main(): Promise<void> {
        console.log('Application.main() called');
        this.rootEl = document.getElementById("ra2web-root");
        if (!this.rootEl) {
            console.error("CRITICAL: Missing root element #ra2web-root in HTML.");
            const errorMsg = "CRITICAL: Missing root element #ra2web-root for the application.";
            if (document.body) {
                document.body.innerHTML = `<h1>Error</h1><p>${errorMsg}</p>`;
            }
            else {
                alert(errorMsg);
            }
            return;
        }
        this.viewportAdapter.rootElement = this.rootEl;
        this.applyRootLayout(this.viewport.value);
        if (this.splashScreenUpdateCallback) {
            this.splashScreenUpdateCallback({
                width: this.viewport.value.width,
                height: this.viewport.value.height,
                parentElement: this.rootEl,
                loadingText: 'Initializing...'
            });
        }
        try {
            await this.loadConfig();
            Engine.setActiveEngine(this.config.engine === "yr" ? EngineType.YurisRevenge : EngineType.RedAlert2);
            this.initializePreferredViewportSize();
            this.updateViewportSize();
        }
        catch (e) {
            console.error("CRITICAL: Application.loadConfig() failed. See previous errors.", e);
            if (this.rootEl)
                this.rootEl.innerHTML = "<h1>Error</h1><p>Failed to load critical application configuration. Please check console.</p>";
            return;
        }
        const locale = this.config.defaultLocale;
        if (this.splashScreenUpdateCallback) {
            this.splashScreenUpdateCallback({
                width: this.viewport.value.width,
                height: this.viewport.value.height,
                parentElement: this.rootEl,
                loadingText: 'Loading translations...'
            });
        }
        try {
            await this.loadTranslations();
        }
        catch (e) {
            console.error(`Missing translation ${locale}.`, e);
            return;
        }
        if (this.splashScreenUpdateCallback) {
            this.splashScreenUpdateCallback({
                width: this.viewport.value.width,
                height: this.viewport.value.height,
                parentElement: this.rootEl,
                loadingText: this.strings.get("gui:loadingex"),
                copyrightText: this.strings.get("txt_copyright") + "\n" + this.strings.get("gui:wwbrand"),
                disclaimerText: this.strings.get("ts:disclaimer")
            });
        }
        try {
            this.checkGlobalLibs();
        }
        catch (e: any) {
            console.error("Global library check failed:", e);
            const errorMsg = this.strings.get("TS:DownloadFailed");
            const errorBox = new BasicErrorBoxApi(this.viewport, this.strings, this.rootEl!);
            await errorBox.show(errorMsg, true);
            return;
        }
        this.runtimeVars = new MockConsoleVars();
        this.bindPerformanceRuntimeVars();
        MockDevToolsApi.registerVar("freecamera", this.runtimeVars.freeCamera);
        await this.initLogging();
        this.fullScreen.init();
        this.fullScreen.onChange.subscribe((isFS: boolean) => {
            this.onFullScreenChange(isFS);
        });
        this.runtimeVars.forceResolution.onChange.subscribe(this.handleForceResolutionChange);
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.handleViewportEnvironmentChange);
            window.addEventListener('orientationchange', this.handleViewportEnvironmentChange);
            window.visualViewport?.addEventListener('resize', this.handleViewportEnvironmentChange);
            this.generalOptions.graphics.resolution.onChange.subscribe(this.handlePreferredResolutionChange);
            this.updateViewportSize();
        }
        this.loadGpuBenchmarkData()
            .then(gpuData => this.gpuTier = gpuData)
            .catch(e => this.sentry?.captureException(e));
        this.fsAccessLib = browserFileSystemAccess;
        const nativeShellProfile = isNativeShell() ? getNativeShellProfile() : undefined;
        const fallbackProfile: GameProfileId = nativeShellProfile ?? (this.config.engine === 'yr' ? 'yr' : 'ra2');
        const contentRegistry = new ContentRegistry(localStorage);
        const contentSelection = await contentRegistry.resolveSelection({
            location: window.location,
            fallbackProfile,
        });
        const profile = contentSelection.profileId;
        const modName = contentSelection.kind === 'mod' ? contentSelection.modId : undefined;
        let gameResConfig = this.loadGameResConfig(this.localPrefs);
        try {
            const gameRes = new GameRes(this.getVersion(), modName || undefined, this.fsAccessLib, this.localPrefs, this.strings, this.rootEl, this.createSplashScreenInterface(), this.viewportAdapter, this.config, "res/", this.sentry, profile);
            const { configToPersist, cdnResLoader } = await gameRes.init(gameResConfig, (error, strings) => this.handleGameResLoadError(error, strings), (error, strings) => this.handleGameResImportError(error, strings));
            this.loadGameStringsFromVfs();
            try {
                const vfsAny: any = (Engine as any).vfs;
                const debugRoot = ((window as any).__ra2debug ??= {});
                debugRoot.profile = getGameProfile(profile);
                debugRoot.contentSelection = contentSelection;
                debugRoot.vfs = {
                    explain: (filename: string) => vfsAny?.explain?.(filename),
                    resolve: (filename: string) => vfsAny?.resolve?.(filename),
                    listArchives: () => vfsAny?.listArchives?.() ?? [],
                    listFiles: () => vfsAny?.listFiles?.() ?? [],
                };
                const iniSourceLoader = (Engine as any).getIniSourceLoader?.();
                debugRoot.ini = {
                    graph: (fileName: string) => iniSourceLoader?.graph?.(fileName),
                    explain: (fileName: string, section: string, key: string) => iniSourceLoader?.explain?.(fileName, section, key),
                };
                debugRoot.strings = {
                    get: (key: string, ...args: any[]) => this.strings.get(key, ...args),
                    has: (key: string) => this.strings.has(key),
                    keys: () => this.strings.getKeys(),
                    explain: (key: string) => this.strings.explain(key),
                };
                const getRuntimeRules = (): any => {
                    const currentDebugRoot = (window as any).__ra2debug ?? {};
                    return currentDebugRoot.game?.rules ?? currentDebugRoot.gameScreen?.game?.rules;
                };
                debugRoot.sides = () => getRuntimeRules()?.sideRegistry?.list?.() ?? [];
                debugRoot.countries = () => getRuntimeRules()?.countryRegistry?.list?.() ?? [];
            }
            catch (e) {
                console.warn('[Diag] VFS ownership diagnostics failed:', e);
            }
            if (configToPersist) {
                if (configToPersist.isCdn()) {
                    this.localPrefs.removeItem(StorageKey.GameRes);
                }
                else {
                    this.localPrefs.setItem(StorageKey.GameRes, configToPersist.serialize());
                }
                gameResConfig = configToPersist;
            }
            this.gameResConfig = gameResConfig;
            this.cdnResourceLoader = cdnResLoader;
            ImageContext.cdnBaseUrl = this.gameResConfig?.isCdn()
                ? this.gameResConfig.getCdnBaseUrl()
                : undefined;
            ImageContext.vfs = Engine.vfs;
            try {
                Engine.loadRules();
            }
            catch (err) {
                console.error('[Application] Engine.loadRules() failed:', err);
                // Rules, art, and AI are mandatory for the engine and for the
                // menu's shared data model. Continuing here leaves routing
                // alive with an uninitialized engine, which presents as blank
                // Options/Score/HUD screens and hides the actual import or
                // Ares-compatibility failure from the user.
                throw err;
            }
            if (typeof window.gtag === 'function') {
                window.gtag('event', 'app_init', {
                    res: this.gameResConfig?.source || 'unknown',
                    modName: modName || '<none>'
                });
            }
            this.sentry?.configureScope((scope: any) => {
                scope.setTag('content', contentSelection.id);
                scope.setExtra('contentSelection', contentSelection);
                scope.setTag('mod', modName || '<none>');
                scope.setExtra('mod', modName || '<none>');
                let modHash: string | number = 'unknown';
                try {
                    modHash = Engine.getModHash();
                }
                catch { }
                scope.setExtra('modHash', modHash);
            });
        }
        catch (e) {
            console.error("Failed to initialize GameRes:", e);
            await this.handleGameResLoadError(e as Error, this.strings, true);
            return;
        }
        this.initRouting();
        if (this.splashScreenUpdateCallback) {
            this.splashScreenUpdateCallback(null);
        }
    }
    private loadGameResConfig(prefs: LocalPrefs): GameResConfig | undefined {
        const serializedConfig = prefs.getItem(StorageKey.GameRes);
        if (serializedConfig) {
            try {
                const config = new GameResConfig(this.config.gameresBaseUrl || "");
                config.unserialize(serializedConfig);
                if (config.isCdn() && !config.getCdnBaseUrl()) {
                    return undefined;
                }
                return config;
            }
            catch (e) {
                console.error("Failed to load GameResConfig from preferences:", e);
            }
        }
        return undefined;
    }
    private createTestToolContext(): TestToolRuntimeContext {
        return {
            cdnResourceLoader: this.cdnResourceLoader,
            mapResourceLoader: new ResourceLoader(this.config.mapsBaseUrl ?? ''),
            rootElement: this.rootEl ?? undefined,
        };
    }
    private initRouting(): void {
        let currentHandler: any = null;
        this.routing.addRoute("*", async () => {
            if (currentHandler && currentHandler.destroy) {
                console.log('[Application] Destroying current handler');
                await currentHandler.destroy();
                currentHandler = null;
            }
        });
        this.routing.addRoute("/", async () => {
            console.log('[Application] Initializing main page');
            this.applyRootLayout(this.viewport.value);
            this.gui = new Gui(this.getVersion(), this.strings, this.config, this.viewport, this.rootEl!, this.cdnResourceLoader, this.gameResConfig, this.runtimeVars, this.generalOptions, this.fullScreen);
            await this.gui.init();
            currentHandler = this;
        });
        this.routing.addRoute("/vxltest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing VxlTester');
            const { VxlTester } = await this.importOptionalDevModule('./tools/VxlTester');
            await VxlTester.main(Engine.vfs, this.runtimeVars, this.createTestToolContext());
            currentHandler = VxlTester;
        });
        this.routing.addRoute("/lobbytest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing LobbyFormTester');
            const { LobbyFormTester } = await this.importOptionalDevModule('./tools/LobbyFormTester');
            await LobbyFormTester.main(this.rootEl!, this.strings, this.createTestToolContext());
            currentHandler = LobbyFormTester;
        });
        this.routing.addRoute("/soundtest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing SoundTester');
            const { SoundTester } = await this.importOptionalDevModule('./tools/SoundTester');
            await SoundTester.main(Engine.vfs, this.rootEl!, this.createTestToolContext());
            currentHandler = SoundTester;
        });
        this.routing.addRoute("/buildtest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing BuildingTester');
            const { BuildingTester } = await this.importOptionalDevModule('./tools/BuildingTester');
            await BuildingTester.main([], this.createTestToolContext());
            currentHandler = BuildingTester;
        });
        this.routing.addRoute("/inftest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing InfantryTester');
            const { InfantryTester } = await this.importOptionalDevModule('./tools/InfantryTester');
            await InfantryTester.main(this.runtimeVars, this.createTestToolContext());
            currentHandler = InfantryTester;
        });
        this.routing.addRoute("/airtest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing AircraftTester');
            const { AircraftTester } = await this.importOptionalDevModule('./tools/AircraftTester');
            await AircraftTester.main(this.runtimeVars, this.createTestToolContext());
            currentHandler = AircraftTester;
        });
        this.routing.addRoute("/vehicletest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing VehicleTester');
            const { VehicleTester } = await this.importOptionalDevModule('./tools/VehicleTester');
            await VehicleTester.main(this.runtimeVars, this.createTestToolContext());
            currentHandler = VehicleTester;
        });
        this.routing.addRoute("/shptest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing ShpTester');
            const { TestToolSupport } = await this.importOptionalDevModule('./tools/TestToolSupport');
            const gameMap = await TestToolSupport.loadMap(this.createTestToolContext().mapResourceLoader!, "mp03t4.map");
            const { ShpTester } = await this.importOptionalDevModule('./tools/ShpTester');
            await ShpTester.main(Engine.vfs, gameMap, this.rootEl!, this.strings, this.createTestToolContext());
            currentHandler = ShpTester;
        });
        this.routing.addRoute("/worldscenetest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing WorldSceneTester');
            const { TestToolSupport } = await this.importOptionalDevModule('./tools/TestToolSupport');
            const gameMap = await TestToolSupport.loadMap(this.createTestToolContext().mapResourceLoader!, "mp03t4.map");
            const { WorldSceneTester } = await this.importOptionalDevModule('./tools/WorldSceneTester');
            await WorldSceneTester.main(Engine.vfs, gameMap, this.rootEl!, this.strings, this.createTestToolContext());
            currentHandler = WorldSceneTester;
        });
        this.routing.addRoute("/unitmovementtest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing UnitMovementTester');
            const { TestToolSupport } = await this.importOptionalDevModule('./tools/TestToolSupport');
            const gameMap = await TestToolSupport.loadMap(this.createTestToolContext().mapResourceLoader!, "mp03t4.map");
            const { UnitMovementTester } = await this.importOptionalDevModule('./tools/UnitMovementTester');
            await UnitMovementTester.main(Engine.vfs, gameMap, this.rootEl!, this.strings, this.createTestToolContext());
            currentHandler = UnitMovementTester;
        });
        this.routing.addRoute("/perftest", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing PerformanceTester');
            const { PerformanceTester } = await this.importOptionalDevModule('./tools/PerformanceTester');
            await PerformanceTester.main(this.rootEl!, this.strings, this.runtimeVars, this.generalOptions, this.createTestToolContext());
            currentHandler = PerformanceTester;
        });
        this.routing.addRoute("/scenesandbox", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing SceneSandboxTester');
            const { TestToolSupport } = await this.importOptionalDevModule('./tools/TestToolSupport');
            const mapCandidates = ["mp18s3.map", "mp03t4.map"];
            let loadedMap: any;
            let loadedMapName = "";
            for (const mapName of mapCandidates) {
                try {
                    loadedMap = await TestToolSupport.loadMap(this.createTestToolContext().mapResourceLoader!, mapName);
                    loadedMapName = mapName;
                    break;
                }
                catch (error) {
                    console.warn(`[Application] Failed to load sandbox map "${mapName}"`, error);
                }
            }
            if (!loadedMap) {
                throw new Error("Failed to load a scene sandbox map.");
            }
            const { SceneSandboxTester } = await this.importOptionalDevModule('./tools/SceneSandboxTester');
            await SceneSandboxTester.main(Engine.vfs, loadedMap, this.rootEl!, this.strings, this.createTestToolContext(), {
                mapName: loadedMapName,
            });
            currentHandler = SceneSandboxTester;
        });
        this.routing.addRoute("/liveinteraction", async () => {
            if (!Engine.vfs) {
                throw new Error("Original game files must be provided.");
            }
            console.log('[Application] Initializing LiveInteractionTester');
            const { TestToolSupport } = await this.importOptionalDevModule('./tools/TestToolSupport');
            const gameMap = await TestToolSupport.loadMap(this.createTestToolContext().mapResourceLoader!, "2_reconcile.map");
            const { LiveInteractionTester } = await this.importOptionalDevModule('./tools/LiveInteractionTester');
            await LiveInteractionTester.main(Engine.vfs, gameMap, this.rootEl!, this.strings, this.createTestToolContext(), {
                generalOptions: this.generalOptions,
                runtimeVars: this.runtimeVars,
            });
            currentHandler = LiveInteractionTester;
        });
        this.routing.init();
    }
    async destroy(): Promise<void> {
        console.log('[Application] Destroying Application');
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.handleViewportEnvironmentChange);
            window.removeEventListener('orientationchange', this.handleViewportEnvironmentChange);
            window.visualViewport?.removeEventListener('resize', this.handleViewportEnvironmentChange);
        }
        this.generalOptions.graphics.resolution.onChange.unsubscribe(this.handlePreferredResolutionChange);
        this.runtimeVars.forceResolution.onChange.unsubscribe(this.handleForceResolutionChange);
        this.fullScreen.dispose();
        if (this.gui) {
            if (this.gui.destroy) {
                await this.gui.destroy();
            }
            this.gui = undefined;
        }
    }
    private createSplashScreenInterface() {
        return {
            setLoadingText: (text: string) => {
                console.log(`[Application] Splash Loading: "${text}"`);
                if (this.splashScreenUpdateCallback) {
                    this.splashScreenUpdateCallback({
                        width: this.viewport.value.width,
                        height: this.viewport.value.height,
                        parentElement: this.rootEl,
                        loadingText: text
                    });
                }
            },
            setBackgroundImage: (url: string) => {
                console.log(`[Application] Splash Background: ${url}`);
                if (this.splashScreenUpdateCallback) {
                    this.splashScreenUpdateCallback({
                        width: this.viewport.value.width,
                        height: this.viewport.value.height,
                        parentElement: this.rootEl,
                        backgroundImage: url
                    });
                }
            },
            setCopyrightText: (text: string) => {
                console.log(`[Application] Splash Copyright: ${text}`);
                if (this.splashScreenUpdateCallback) {
                    this.splashScreenUpdateCallback({
                        width: this.viewport.value.width,
                        height: this.viewport.value.height,
                        parentElement: this.rootEl,
                        copyrightText: text
                    });
                }
            },
            setDisclaimerText: (text: string) => {
                console.log(`[Application] Splash Disclaimer: ${text}`);
                if (this.splashScreenUpdateCallback) {
                    this.splashScreenUpdateCallback({
                        width: this.viewport.value.width,
                        height: this.viewport.value.height,
                        parentElement: this.rootEl,
                        disclaimerText: text
                    });
                }
            },
            destroy: () => {
                console.log('[Application] Splash screen destroyed');
                if (this.splashScreenUpdateCallback) {
                    this.splashScreenUpdateCallback(null);
                }
            },
            element: { style: { display: 'none' } }
        };
    }
    private async handleGameResLoadError(error: Error, strings: Strings, fatal: boolean = false): Promise<void> {
        let errorMessage = strings.get("ts:import_load_files_failed");
        if (error.name === "ChecksumError") {
            const fileField = (error as any).file || '';
            const template = strings.get("ts:import_checksum_mismatch");
            const replaced = template.indexOf("%s") >= 0 ?
                template.replace(/%s/g, fileField) :
                template + " " + fileField;
            errorMessage += "\n\n" + replaced;
        }
        else if (error.name === "FileNotFoundError" || error.name === "GameResFileNotFoundError") {
            const template = strings.get("ts:import_file_not_found");
            errorMessage += "\n\n" + formatImportFileNotFound(template, error);
        }
        else if (error.name === "DownloadError" || error.message?.match(/XHR error|Failed to fetch/i)) {
            errorMessage += "\n\n" + strings.get("ts:downloadfailed");
        }
        else if (error.name === "NoStorageError") {
            errorMessage += "\n\n" + strings.get("ts:import_no_storage");
        }
        else if (error.message?.match(/out of memory|allocation/i)) {
            errorMessage += "\n\n" + strings.get("ts:gameinitoom");
        }
        else if (error.name === "QuotaExceededError" || error.name === "StorageQuotaError") {
            errorMessage += "\n\n" + strings.get("ts:storage_quota_exceeded");
        }
        else if (error.name === "IOError") {
            errorMessage += "\n\n" + strings.get("ts:storage_io_error");
            fatal = true;
        }
        else {
            console.error("Unrecognized GameRes error:", error);
            const wrappedError = new Error(`Game res load failed (${error.message ?? error.name})`);
            (wrappedError as any).cause = error;
            this.sentry?.captureException(wrappedError);
        }
        if (this.gui && this.gui.getRootController()) {
            try {
                const messageBoxApi = this.gui.getMessageBoxApi();
                await messageBoxApi.alert(errorMessage, strings.get("GUI:OK"));
            }
            catch (e) {
                console.error("Failed to show error dialog:", e);
                const errorBox = new BasicErrorBoxApi(this.viewport, strings, this.rootEl!);
                await errorBox.show(errorMessage, fatal);
            }
        }
        else {
            const errorBox = new BasicErrorBoxApi(this.viewport, strings, this.rootEl!);
            await errorBox.show(errorMessage, fatal);
        }
    }
    private async handleGameResImportError(error: Error, strings: Strings): Promise<void> {
        let errorMessage = strings.get("ts:import_failed");
        if (error.name === "FileNotFoundError" || error.name === "GameResFileNotFoundError") {
            const template = strings.get("ts:import_file_not_found");
            errorMessage += "\n\n" + formatImportFileNotFound(template, error);
        }
        else if (error.name === "InvalidArchiveError") {
            errorMessage += "\n\n" + strings.get("ts:import_invalid_archive");
        }
        else if (error.name === "ArchiveExtractionError") {
            if ((error as any).cause?.message?.match(/out of memory|allocation/i)) {
                errorMessage += "\n\n" + strings.get("ts:import_out_of_memory");
            }
            else {
                errorMessage += "\n\n" + strings.get("ts:import_archive_extract_failed");
                const wrappedError = new Error(`Game res import failed (${error.message ?? error.name})`);
                (wrappedError as any).cause = error;
                this.sentry?.captureException(wrappedError);
            }
        }
        else if (error.name === "NoWebAssemblyError") {
            errorMessage += "\n\n" + strings.get("ts:import_no_web_assembly");
        }
        else if (error.name === "ChecksumError") {
            const fileField = (error as any).file || '';
            const template = strings.get("ts:import_checksum_mismatch");
            const replaced = template.indexOf("%s") >= 0 ?
                template.replace(/%s/g, fileField) :
                template + " " + fileField;
            errorMessage += "\n\n" + replaced;
        }
        else if (error.name === "DownloadError" || error.message?.match(/XHR error|Failed to fetch|CompileError: WebAssembly|SystemJS|NetworkError|Load failed/i)) {
            errorMessage += "\n\n" + strings.get("ts:downloadfailed");
        }
        else if (error.name === "ArchiveDownloadError") {
            const urlField = (error as any).url || '';
            const template = strings.get("ts:import_archive_download_failed");
            const replaced = template.indexOf("%s") >= 0 ?
                template.replace(/%s/g, urlField) :
                template + " " + urlField;
            errorMessage = replaced;
        }
        else if (error.name === "NoStorageError") {
            errorMessage += "\n\n" + strings.get("ts:import_no_storage");
        }
        else if (error.message?.match(/out of memory|allocation/i) || error.name.match(/NS_ERROR_FAILURE|NS_ERROR_OUT_OF_MEMORY/)) {
            errorMessage += "\n\n" + strings.get("ts:import_out_of_memory");
        }
        else if (error.name === "QuotaExceededError" || error.name === "StorageQuotaError") {
            errorMessage += "\n\n" + strings.get("ts:storage_quota_exceeded");
        }
        else if (error.name !== "IOError" && error.name !== "FileNotFoundError" && error.name !== "AbortError") {
            const wrappedError = new Error("Game res import failed " + (error.message ?? error.name));
            (wrappedError as any).cause = error;
            this.sentry?.captureException(wrappedError);
        }
        if (this.gui && this.gui.getRootController()) {
            try {
                const messageBoxApi = this.gui.getMessageBoxApi();
                await messageBoxApi.alert(errorMessage, strings.get("GUI:OK"));
            }
            catch (e) {
                console.error("Failed to show error dialog:", e);
                const errorBox = new BasicErrorBoxApi(this.viewport, strings, this.rootEl!);
                await errorBox.show(errorMessage, false);
            }
        }
        else {
            const errorBox = new BasicErrorBoxApi(this.viewport, strings, this.rootEl!);
            await errorBox.show(errorMessage, false);
        }
    }
}
declare global {
    interface Window {
        gtag?: (...args: any[]) => void;
    }
}
