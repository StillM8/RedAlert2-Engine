import { Screen } from '../../Controller';
import { MainMenuScreenType } from '../../ScreenType';
import { MainMenuController } from '../MainMenuController';
import { Strings } from '../../../../data/Strings';
import { MusicType } from '../../../../engine/sound/Music';
import { MessageBoxApi } from '../../../component/MessageBoxApi';
import { FullScreen } from '../../../FullScreen';
import { getHumanReadableKey } from '@/gui/screen/options/component/getHumanReadableKey';
import { isNativeShell, isTauriDesktopShell } from '@/shell/nativeShell';
interface SidebarButton {
    label: string;
    tooltip?: string;
    disabled?: boolean;
    isBottom?: boolean;
    onClick: () => void | Promise<void>;
}
export class HomeScreen implements Screen {
    private strings: Strings;
    private messageBoxApi: MessageBoxApi;
    private appVersion: string;
    private storageEnabled: boolean;
    private quickMatchEnabled: boolean;
    private fullScreen?: FullScreen;
    private controller?: MainMenuController;
    public title: string;
    public musicType: MusicType;
    constructor(strings: Strings, messageBoxApi: MessageBoxApi, appVersion: string, storageEnabled: boolean = false, quickMatchEnabled: boolean = false, fullScreen?: FullScreen) {
        this.strings = strings;
        this.messageBoxApi = messageBoxApi;
        this.appVersion = appVersion;
        this.storageEnabled = storageEnabled;
        this.quickMatchEnabled = quickMatchEnabled;
        this.fullScreen = fullScreen;
        this.title = this.strings.get("GUI:MainMenu") || "Main Menu";
        this.musicType = MusicType.Intro;
    }
    setController(controller: MainMenuController): void {
        this.controller = controller;
    }
    onEnter(): void {
        console.log('[HomeScreen] Entering home screen');
        // The native (iOS) build ships a focused menu: Skirmish, Load Game,
        // LAN and Options. The other entries stay available in web builds
        // (and their underlying systems remain in the bundle — saves are
        // built on the replay machinery).
        const nativeShell = isNativeShell();
        const buttons: SidebarButton[] = [
            {
                label: 'Skirmish',
                tooltip: 'Play a single-player skirmish against the AI',
                onClick: async () => {
                    console.log('[HomeScreen] Skirmish clicked');
                    try {
                        if (this.controller) {
                            this.controller.goToScreen(MainMenuScreenType.Skirmish);
                        }
                    }
                    catch (error) {
                        console.error('[HomeScreen] Failed to navigate to Skirmish:', error);
                        await this.messageBoxApi.alert('Skirmish - Under Development\n\nThe basic framework is in place, but the following components still need work:\n• Game rules system\n• Map loader\n• AI opponent system\n• Game mode manager', this.strings.get('GUI:OK') || 'OK');
                    }
                }
            },
            {
                label: 'Load Game',
                tooltip: 'Continue a saved skirmish match',
                onClick: () => {
                    console.log('[HomeScreen] Load Game clicked');
                    if (this.controller) {
                        this.controller.pushScreen(MainMenuScreenType.LoadGame);
                    }
                }
            },
            ...(!nativeShell
                ? [
                    {
                        label: 'Live Interaction',
                        tooltip: 'Enter live interaction mode, where viewer events such as joins, likes, and gifts drive both sides to send units into battle',
                        onClick: () => {
                            console.log('[HomeScreen] Live Interaction clicked');
                            window.location.hash = '/liveinteraction';
                        }
                    },
                    {
                        label: 'Replays',
                        tooltip: 'View and play back game replays',
                        onClick: () => {
                            console.log('[HomeScreen] Replays clicked');
                            if (this.controller) {
                                this.controller.pushScreen(MainMenuScreenType.ReplaySelection);
                            }
                        }
                    },
                ]
                : []),
            {
                label: 'LAN Multiplayer',
                tooltip: 'Exchange SDP manually to establish a LAN P2P data channel',
                onClick: () => {
                    console.log('[HomeScreen] LAN Setup clicked');
                    if (this.controller) {
                        this.controller.pushScreen(MainMenuScreenType.LanSetup);
                    }
                }
            },
        ];
        if (this.storageEnabled) {
            buttons.push({
                label: this.strings.get('GUI:Mods') || 'Mods',
                tooltip: this.strings.get('STT:Mods') || 'Manage and play modified versions of the base game',
                onClick: () => {
                    console.log('[HomeScreen] Mods clicked');
                    this.controller?.pushScreen(MainMenuScreenType.ModSelection);
                }
            });
        }
        if (!nativeShell) {
            buttons.push({
                label: this.strings.get('TS:InfoAndCredits') || 'Info & Credits',
                tooltip: this.strings.get('STT:InfoAndCredits') || 'Information and credits',
                onClick: () => {
                    console.log('[HomeScreen] Info & Credits clicked');
                    if (this.controller) {
                        this.controller.pushScreen(MainMenuScreenType.InfoAndCredits);
                    }
                }
            });
        }
        buttons.push({
            label: this.strings.get('GUI:Options') || 'Options',
            tooltip: this.strings.get('STT:MainButtonOptions') || 'Game options and settings',
            onClick: () => {
                console.log('[HomeScreen] Options clicked');
                if (this.controller) {
                    this.controller.pushScreen(MainMenuScreenType.Options);
                }
            }
        });
        if (!nativeShell) {
            buttons.push({
                label: 'Test Tools',
                tooltip: 'Access low-level file system and testing tools',
                onClick: () => {
                    console.log('[HomeScreen] Test Entry clicked');
                    if (this.controller) {
                        this.controller.pushScreen(MainMenuScreenType.TestEntry);
                    }
                }
            }, {
                label: this.strings.get('GUI:Fullscreen', getHumanReadableKey(FullScreen.hotKey)) || 'Fullscreen',
                tooltip: this.strings.get('STT:Fullscreen') || 'Toggle full screen mode',
                isBottom: true,
                disabled: this.fullScreen ? !this.fullScreen.isAvailable() : false,
                onClick: () => {
                    console.log('[HomeScreen] Fullscreen clicked');
                    this.toggleFullscreen();
                }
            });
        }
        if (this.controller) {
            this.controller.setSidebarButtons(buttons);
            this.controller.showSidebarButtons();
            this.controller.toggleMainVideo(true);
            this.controller.showVersion(this.appVersion);
        }
    }
    async onLeave(): Promise<void> {
        console.log('[HomeScreen] Leaving home screen');
        if (this.controller) {
            this.controller.hideVersion();
            await this.controller.hideSidebarButtons();
        }
    }
    async onStack(): Promise<void> {
        await this.onLeave();
    }
    onUnstack(): void {
        this.onEnter();
    }
    update(deltaTime: number): void {
    }
    destroy(): void {
    }
    private async toggleFullscreen(): Promise<void> {
        try {
            if (this.fullScreen?.isAvailable()) {
                await this.fullScreen.toggleAsync();
            }
            else if (document.fullscreenElement) {
                await document.exitFullscreen();
            }
            else {
                await document.documentElement.requestFullscreen();
            }
        }
        catch (err) {
            console.error('Error toggling fullscreen:', err);
            const failureMessage = isTauriDesktopShell()
                ? 'Unable to change the native full screen mode\n\nTry pressing F11 or Alt+F again.'
                : document.fullscreenElement
                    ? 'Unable to exit full screen mode'
                    : 'Unable to enter full screen mode\n\nPlease check your browser permission settings';
            await this.messageBoxApi.alert(document.fullscreenElement
                ? 'Unable to exit full screen mode'
                : failureMessage, this.strings.get('GUI:OK') || 'OK');
        }
    }
}
