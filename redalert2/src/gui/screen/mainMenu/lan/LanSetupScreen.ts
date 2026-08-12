import { MainMenuScreen } from '@/gui/screen/mainMenu/MainMenuScreen';
import { HtmlView } from '@/gui/jsx/HtmlView';
import { jsx } from '@/gui/jsx/jsx';
import { LanSetup } from '@/gui/screen/mainMenu/lan/component/LanSetup';
import { MusicType } from '@/engine/sound/Music';
import { LanMatchSession } from '@/network/lan/LanMatchSession';
import { LanMeshSession } from '@/network/lan/LanMeshSession';
import { ChatHistory } from '@/gui/chat/ChatHistory';
import { LanRoomSession } from '@/network/lan/LanRoomSession';
import { PregameController, PregameMapSelectionResult } from '@/gui/screen/mainMenu/lobby/PregameController';
import { MainMenuScreenType, ScreenType } from '@/gui/screen/ScreenType';
import { LobbyType } from '@/gui/screen/mainMenu/lobby/component/viewmodel/lobby';
import { MapPreviewRenderer } from '@/gui/screen/mainMenu/lobby/MapPreviewRenderer';
import { MapFile } from '@/data/MapFile';
import { MainMenuRoute } from '@/gui/screen/mainMenu/MainMenuRoute';
import { StorageKey } from '@/LocalPrefs';
import { uint8ArrayToBase64String } from '@/util/string';
import { LanRecentPlayRecord } from '@/gui/screen/mainMenu/lan/LanRecentPlay';
import { SlotType as NetSlotType } from '@/network/gameopt/SlotInfo';
import { OBS_COUNTRY_ID } from '@/game/gameopts/constants';
import { Engine } from '@/engine/Engine';

interface RootController {
    goToScreen(screenType: number, params?: any): void;
}

interface Rules {
    getMultiplayerCountries(): any[];
    getMultiplayerColors(): Map<number, any>;
    mpDialogSettings: any;
    general?: any;
}

interface GameMode {
    id: number;
    label: string;
    mpDialogSettings: any;
}

interface GameModes {
    getAll(): GameMode[];
    getById(id: number): GameMode;
}

interface MapListEntry {
    fileName: string;
    maxSlots: number;
    getFullMapTitle(strings: any): string;
}

interface MapList {
    getAll(): MapListEntry[];
    getByName(name: string): MapListEntry;
    addFromMapFile(file: any): void;
}

interface MapFileLoader {
    load(mapName: string): Promise<any>;
}

interface LocalPrefs {
    getItem(key: string): string | undefined;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

interface MessageBoxApi {
    show(message: string, buttonText?: string, onClose?: () => void): void;
}

interface MapDirectory {
    containsEntry(entryName: string): Promise<boolean>;
    writeFile(file: any): Promise<void>;
}

const MAX_RECENT_LAN_PLAYS = 8;

export class LanSetupScreen extends MainMenuScreen {
    declare public title: string;
    declare public musicType: MusicType;

    private form?: any;
    private resetNonce = 0;
    private inviteNonce = 0;
    private joinNonce = 0;
    private previewRequestId = 0;

    private readonly meshSession = new LanMeshSession();
    private readonly chatHistory = new ChatHistory();
    private readonly roomSession: LanRoomSession;
    private pregameController: PregameController;
    private activeMatchSession?: LanMatchSession;

    constructor(
        private readonly rootController: RootController,
        private readonly strings: any,
        private readonly jsxRenderer: any,
        private readonly rules: Rules,
        private readonly mapFileLoader: MapFileLoader,
        private readonly mapList: MapList,
        private readonly gameModes: GameModes,
        private readonly localPrefs: LocalPrefs,
        private readonly messageBoxApi: MessageBoxApi,
        private readonly mapDir?: MapDirectory
    ) {
        super();
        this.title = '';
        this.musicType = MusicType.Intro;
        const savedLanPlayerName = this.localPrefs.getItem(StorageKey.LanPlayerName)?.trim();
        if (savedLanPlayerName) {
            this.meshSession.updateSelfName(savedLanPlayerName);
        }
        this.pregameController = this.createPregameController();
        this.roomSession = new LanRoomSession(this.meshSession, this.gameModes, this.mapFileLoader, this.mapDir, this.mapList);
    }

    async onEnter(): Promise<void> {
        await Engine.loadMapList();
        this.controller.toggleMainVideo(false);
        this.initView();
        this.subscribeRoomEvents();
        this.refreshSidebarButtons();
        this.refreshSidebarMpText();
        void this.refreshSidebarPreview();
        this.controller.showSidebarButtons();
    }

    async onLeave(): Promise<void> {
        this.previewRequestId += 1;
        this.roomSession.onSnapshotChange.unsubscribe(this.handleRoomSnapshot);
        this.meshSession.onSnapshotChange.unsubscribe(this.handleMeshSnapshot);
        this.roomSession.onLaunch.unsubscribe(this.handleLaunch);
        await this.controller.hideSidebarButtons();
        this.form = undefined;
    }

    async onStack(): Promise<void> {
        await this.onLeave();
    }

    onUnstack(params?: PregameMapSelectionResult): void {
        this.subscribeRoomEvents();
        if (params) {
            this.pregameController.applyMapSelection(params);
            this.pregameController.updateSelfName(this.meshSession.getSelf().name);
            this.roomSession.startHosting(this.createLanHostSnapshot());
        }
        this.refreshSidebarButtons();
        this.refreshSidebarMpText();
        void this.refreshSidebarPreview();
        this.refreshView();
        this.controller.showSidebarButtons();
    }

    private handleMeshSnapshot = () => {
        this.refreshSidebarButtons();
    };

    private handleRoomSnapshot = () => {
        this.refreshSidebarButtons();
        this.refreshSidebarMpText();
        void this.refreshSidebarPreview();
    };

    private handleLaunch = (descriptor: any) => {
        this.activeMatchSession?.dispose();
        this.activeMatchSession = new LanMatchSession(this.meshSession, descriptor);
        this.recordRecentPlay(descriptor);
        const currentCustomMap = this.roomSession.getResolvedCustomMapFile();
        this.rootController.goToScreen(ScreenType.Game, {
            create: true,
            lanLaunch: descriptor,
            lanMatchSession: this.activeMatchSession,
            lanMapDataBase64: currentCustomMap ? uint8ArrayToBase64String(currentCustomMap.getBytes()) : undefined,
            returnTo: new MainMenuRoute(MainMenuScreenType.LanSetup, {}),
        });
    };

    private subscribeRoomEvents(): void {
        this.roomSession.onSnapshotChange.unsubscribe(this.handleRoomSnapshot);
        this.meshSession.onSnapshotChange.unsubscribe(this.handleMeshSnapshot);
        this.roomSession.onLaunch.unsubscribe(this.handleLaunch);
        this.roomSession.onSnapshotChange.subscribe(this.handleRoomSnapshot);
        this.meshSession.onSnapshotChange.subscribe(this.handleMeshSnapshot);
        this.roomSession.onLaunch.subscribe(this.handleLaunch);
    }

    private createPregameController(): PregameController {
        return new PregameController(
            this.strings,
            this.rules,
            this.mapFileLoader,
            this.mapList,
            this.gameModes,
            this.localPrefs,
            this.meshSession.getSelf().name
        );
    }

    private initView(): void {
        const [component] = this.jsxRenderer.render(jsx(HtmlView, {
            innerRef: (ref: any) => (this.form = ref),
            component: LanSetup,
            props: this.buildComponentProps(),
        }));
        this.controller.setMainComponent(component);
    }

    private refreshView(): void {
        if (!this.form) {
            this.initView();
            return;
        }
        this.form.applyOptions((options: any) => {
            Object.assign(options, this.buildComponentProps());
        });
    }

    private buildComponentProps(): any {
        return {
            strings: this.strings,
            meshSession: this.meshSession,
            roomSession: this.roomSession,
            chatHistory: this.chatHistory,
            pregameController: this.pregameController,
            resetNonce: this.resetNonce,
            inviteNonce: this.inviteNonce,
            joinNonce: this.joinNonce,
            recentSessions: this.getRecentPlays(),
            onStartGame: async () => {
                await this.startLanGame();
            },
            onLeaveRoom: async () => {
                await this.handleLeaveRoom();
            },
            onChangeMap: async () => {
                await this.handleChangeMap();
            },
            onToggleReady: async () => {
                const selfMember = this.roomSession.getSnapshot().members.find((member) => member.isSelf);
                if (!selfMember) {
                    return;
                }
                await this.roomSession.setReady(!selfMember.ready);
            },
            onHostPregameChanged: () => {
                this.roomSession.applyHostPregameSnapshot(this.pregameController.getSnapshot());
                this.refreshSidebarMpText();
                void this.refreshSidebarPreview();
            },
            onCommitName: (name: string) => {
                this.persistLanPlayerName(name);
            },
        };
    }

    private async handleCreateRoom(): Promise<void> {
        if (!this.pregameController.isInitialized()) {
            await this.pregameController.initialize();
        }
        this.pregameController.updateSelfName(this.meshSession.getSelf().name);
        await this.controller.pushScreen(MainMenuScreenType.MapSelection, {
            lobbyType: LobbyType.MultiplayerHost,
            gameOpts: this.pregameController.getGameOpts(),
            usedSlots: () => this.pregameController.getUsedSlots(),
        });
    }

    private async handleChangeMap(): Promise<void> {
        if (!this.roomSession.getSnapshot().isHost || !this.roomSession.getSnapshot().roomState) {
            return;
        }
        await this.controller.pushScreen(MainMenuScreenType.MapSelection, {
            lobbyType: LobbyType.MultiplayerHost,
            gameOpts: this.pregameController.getGameOpts(),
            usedSlots: () => this.pregameController.getUsedSlots(),
        });
    }

    private async handleLeaveRoom(): Promise<void> {
        this.roomSession.leaveRoom();
        if (this.meshSession.getSnapshot().isInRoom) {
            this.meshSession.leaveRoom();
        }
        else {
            this.meshSession.reset();
        }
        this.chatHistory.reset();
        this.pregameController = this.createPregameController();
        this.resetNonce += 1;
        this.refreshSidebarButtons();
        this.refreshSidebarMpText();
        this.controller.setSidebarPreview();
        this.refreshView();
    }

    private createLanHostSnapshot(): any {
        const snapshot = this.pregameController.getSnapshot();
        const visibleSlots = snapshot.gameOpts.humanPlayers[0]?.countryId === OBS_COUNTRY_ID
            ? snapshot.gameOpts.maxSlots + 1
            : snapshot.gameOpts.maxSlots;
        for (let slotIndex = 1; slotIndex < visibleSlots; slotIndex += 1) {
            if (snapshot.slotsInfo[slotIndex]?.type === NetSlotType.Player) {
                continue;
            }
            snapshot.slotsInfo[slotIndex] = { type: NetSlotType.Open };
            snapshot.gameOpts.aiPlayers[slotIndex] = undefined;
        }
        return snapshot;
    }

    private openInviteDialog(): void {
        const roomSnapshot = this.roomSession.getSnapshot();
        if (!roomSnapshot.canInvite) {
            this.messageBoxApi.show('There are no open player slots. Open a slot before inviting.');
            return;
        }
        this.inviteNonce += 1;
        this.form?.applyOptions?.((options: any) => {
            options.inviteNonce = this.inviteNonce;
        });
    }

    private openJoinDialog(): void {
        this.joinNonce += 1;
        this.form?.applyOptions?.((options: any) => {
            options.joinNonce = this.joinNonce;
        });
    }

    private async startLanGame(): Promise<void> {
        const roomSnapshot = this.roomSession.getSnapshot();
        if (!roomSnapshot.isHost) {
            return;
        }
        if (!roomSnapshot.canStart) {
            this.messageBoxApi.show('Some members have not finished connecting or syncing the map yet.');
            return;
        }
        this.roomSession.startGame({
            screenType: MainMenuScreenType.LanSetup,
            params: {},
        });
    }

    private refreshSidebarButtons(): void {
        const meshSnapshot = this.meshSession.getSnapshot();
        const roomSnapshot = this.roomSession.getSnapshot();
        const inWaitingRoom = roomSnapshot.isRoomActive || meshSnapshot.isInRoom;

        if (!inWaitingRoom) {
            this.controller.setSidebarButtons([
                {
                    label: 'Create Room',
                    tooltip: 'Choose a mode and map first, then enter the waiting room',
                    onClick: () => {
                        void this.handleCreateRoom();
                    },
                },
                {
                    label: 'Join Room',
                    tooltip: 'Scan or paste QR code content to join an existing room',
                    onClick: () => this.openJoinDialog(),
                },
                {
                    label: 'Back',
                    tooltip: 'Return to the main menu',
                    isBottom: true,
                    onClick: () => this.controller.popScreen(),
                },
            ]);
            return;
        }

        const selfMember = roomSnapshot.members.find((member) => member.isSelf);
        const buttons: any[] = [];

        if (meshSnapshot.isInRoom) {
            buttons.push({
                label: 'Invite Player',
                tooltip: roomSnapshot.canInvite
                    ? 'Open the QR code invite dialog'
                    : 'No open player slots available',
                disabled: !roomSnapshot.canInvite,
                onClick: () => this.openInviteDialog(),
            });
        }

        buttons.push({
            label: 'Start Game',
            tooltip: roomSnapshot.isHost
                ? roomSnapshot.canStart
                    ? 'Broadcast the game start to all members'
                    : 'Waiting for connections and map sync to finish'
                : 'Only the host can start the game',
            disabled: !roomSnapshot.isHost || !roomSnapshot.canStart,
            onClick: () => {
                void this.startLanGame();
            },
        });

        if (roomSnapshot.isRoomActive && roomSnapshot.isHost) {
            buttons.push({
                label: 'Change Map',
                tooltip: 'Choose a different mode and map',
                onClick: () => {
                    void this.handleChangeMap();
                },
            });
        }
        else if (roomSnapshot.isRoomActive && selfMember) {
            buttons.push({
                label: selfMember.ready ? 'Cancel Ready' : 'Ready',
                tooltip: 'Toggle your ready state',
                onClick: () => {
                    void this.roomSession.setReady(!selfMember.ready);
                },
            });
        }

        buttons.push({
            label: 'Leave Room',
            tooltip: 'Leave the current LAN room and return to the entry page',
            isBottom: true,
            onClick: () => {
                void this.handleLeaveRoom();
            },
        });

        this.controller.setSidebarButtons(buttons, true);
    }

    private refreshSidebarMpText(): void {
        const roomSnapshot = this.roomSession.getSnapshot();
        if (roomSnapshot.roomState) {
            const gameOpts = roomSnapshot.roomState.gameOpts;
            this.controller.setSidebarMpContent({
                text: this.strings.get(this.gameModes.getById(gameOpts.gameMode).label) + '\n\n' + gameOpts.mapTitle,
                icon: gameOpts.mapOfficial ? 'gt18.pcx' : 'settings.png',
                tooltip: gameOpts.mapOfficial ? 'This room uses an official map' : 'This room uses a custom map',
            });
            return;
        }
        this.controller.setSidebarMpContent({
            text: '',
        });
    }

    private async refreshSidebarPreview(): Promise<void> {
        const roomSnapshot = this.roomSession.getSnapshot();
        const roomState = roomSnapshot.roomState;
        if (!roomState) {
            this.controller.toggleSidebarPreview(false);
            this.controller.setSidebarPreview();
            return;
        }

        const requestId = ++this.previewRequestId;
        try {
            let mapFile = this.roomSession.getResolvedCustomMapFile() ?? this.pregameController.getCurrentMapFile();
            if (!mapFile) {
                mapFile = await this.mapFileLoader.load(roomState.gameOpts.mapName);
            }
            if (requestId !== this.previewRequestId) {
                return;
            }
            const preview = new MapPreviewRenderer(this.strings).render(
                new MapFile(mapFile),
                roomSnapshot.isHost ? LobbyType.MultiplayerHost : LobbyType.MultiplayerGuest,
                this.controller.getSidebarPreviewSize()
            );
            this.controller.toggleSidebarPreview(true);
            this.controller.setSidebarPreview(preview);
        }
        catch (error) {
            if (requestId !== this.previewRequestId) {
                return;
            }
            console.warn('[LanSetupScreen] Failed to refresh sidebar preview', error);
            this.controller.setSidebarPreview();
        }
    }

    private persistLanPlayerName(name: string): void {
        const trimmed = name.trim();
        if (!trimmed) {
            this.localPrefs.removeItem(StorageKey.LanPlayerName);
            return;
        }
        this.localPrefs.setItem(StorageKey.LanPlayerName, trimmed.slice(0, 24));
    }

    private getRecentPlays(): LanRecentPlayRecord[] {
        const raw = this.localPrefs.getItem(StorageKey.LanRecentPlays);
        if (!raw) {
            return [];
        }
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed
                .filter((entry): entry is LanRecentPlayRecord => Boolean(
                    entry &&
                    typeof entry.gameId === 'string' &&
                    typeof entry.roomId === 'string' &&
                    (entry.role === 'host' || entry.role === 'guest') &&
                    typeof entry.modeLabel === 'string' &&
                    typeof entry.mapTitle === 'string' &&
                    typeof entry.timestamp === 'number' &&
                    Array.isArray(entry.memberNames)
                ))
                .sort((left, right) => right.timestamp - left.timestamp)
                .slice(0, MAX_RECENT_LAN_PLAYS);
        }
        catch (error) {
            console.warn('[LanSetupScreen] Failed to read recent LAN plays', error);
            return [];
        }
    }

    private saveRecentPlays(records: LanRecentPlayRecord[]): void {
        this.localPrefs.setItem(
            StorageKey.LanRecentPlays,
            JSON.stringify(records.slice(0, MAX_RECENT_LAN_PLAYS))
        );
    }

    private recordRecentPlay(descriptor: any): void {
        const roomSnapshot = this.roomSession.getSnapshot();
        const recentRecord: LanRecentPlayRecord = {
            gameId: descriptor.gameId,
            roomId: descriptor.roomId,
            role: descriptor.hostPeerId === descriptor.localPeerId ? 'host' : 'guest',
            modeLabel: this.strings.get(this.gameModes.getById(descriptor.gameOpts.gameMode).label),
            mapTitle: descriptor.gameOpts.mapTitle,
            mapOfficial: descriptor.gameOpts.mapOfficial,
            memberNames: roomSnapshot.members.map((member) => member.name),
            memberCount: roomSnapshot.members.length || descriptor.humanAssignments.length,
            timestamp: descriptor.timestamp,
        };
        const nextRecentPlays = [
            recentRecord,
            ...this.getRecentPlays().filter((entry) => entry.gameId !== recentRecord.gameId),
        ];
        this.saveRecentPlays(nextRecentPlays);
    }
}
