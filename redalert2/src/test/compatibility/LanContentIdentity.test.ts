import { describe, expect, test } from "bun:test";
import { LanRoomSession } from "@/network/lan/LanRoomSession";

function createMeshSession() {
    const appMessageHandlers = new Set<(entry: any, source: any) => void>();
    const snapshotHandlers = new Set<(snapshot: any, source: any) => void>();
    return {
        getSelf: () => ({ id: "self", name: "Self" }),
        getSnapshot: () => ({ isInRoom: true, members: [{ id: "self", name: "Self", isSelf: true, status: "connected" }] }),
        ensureLocalRoom: () => ({ isInRoom: true, self: { id: "self", name: "Self" }, members: [{ id: "self", name: "Self", isSelf: true, status: "connected" }] }),
        broadcastAppMessage: (payload: any) => { appMessageHandlers.forEach((handler) => handler({ from: { id: "self", name: "Self" }, payload, timestamp: Date.now() }, {})); },
        sendAppMessage: () => undefined,
        onSnapshotChange: {
            subscribe: (handler: any) => { snapshotHandlers.add(handler); return { dispose: () => snapshotHandlers.delete(handler) }; },
            unsubscribe: (handler: any) => { snapshotHandlers.delete(handler); },
        },
        onAppMessage: {
            subscribe: (handler: any) => { appMessageHandlers.add(handler); return { dispose: () => appMessageHandlers.delete(handler) }; },
            unsubscribe: (handler: any) => { appMessageHandlers.delete(handler); },
        },
        _appMessageHandlers: appMessageHandlers,
        _snapshotHandlers: snapshotHandlers,
    };
}

function createRoomSession(contentIdentity: string) {
    const mesh = createMeshSession();
    const room = new LanRoomSession(
        mesh as any,
        { getById: () => ({ mpDialogSettings: { mustAlly: false } }) } as any,
        { load: async () => { throw new Error("no map"); } } as any,
        contentIdentity,
    );
    return { room, mesh };
}

describe("LAN content identity validation", () => {
    test("host advertises its content identity in the room state", () => {
        const { room, mesh } = createRoomSession("identity-a");
        room.startHosting({
            gameOpts: {
                gameMode: 0,
                gameSpeed: 4,
                credits: 10000,
                unitCount: 0,
                shortGame: false,
                superWeapons: true,
                buildOffAlly: false,
                mcvRepacks: false,
                cratesAppear: false,
                hostTeams: false,
                destroyableBridges: true,
                multiEngineer: false,
                noDogEngiKills: false,
                mapName: "test.map",
                mapTitle: "Test",
                mapDigest: "0",
                mapSizeBytes: 0,
                maxSlots: 2,
                mapOfficial: true,
                humanPlayers: [{ name: "Self", countryId: 0, colorId: 0, startPos: 0, teamId: 0 }],
                aiPlayers: [],
            },
            slotsInfo: [{ type: 0 }, { type: 0 }],
        });
        const snapshot = room.getSnapshot();
        expect(snapshot.roomState?.contentIdentity).toBe("identity-a");
    });

    test("rejects a state sync with mismatched content identity", () => {
        const { room, mesh } = createRoomSession("identity-a");
        room.startHosting({
            gameOpts: {
                gameMode: 0,
                gameSpeed: 4,
                credits: 10000,
                unitCount: 0,
                shortGame: false,
                superWeapons: true,
                buildOffAlly: false,
                mcvRepacks: false,
                cratesAppear: false,
                hostTeams: false,
                destroyableBridges: true,
                multiEngineer: false,
                noDogEngiKills: false,
                mapName: "test.map",
                mapTitle: "Test",
                mapDigest: "0",
                mapSizeBytes: 0,
                maxSlots: 2,
                mapOfficial: true,
                humanPlayers: [{ name: "Self", countryId: 0, colorId: 0, startPos: 0, teamId: 0 }],
                aiPlayers: [],
            },
            slotsInfo: [{ type: 0 }, { type: 0 }],
        });
        // Simulate a mismatched state sync from another peer
        const originalState = room.getSnapshot().roomState!;
        const mismatched = {
            ...originalState,
            contentIdentity: "identity-b",
        };
        (room as any).handleStateSync(
            { id: "peer", name: "Peer" },
            { type: "state-sync", state: mismatched },
        );
        // The room should retain its original identity
        expect(room.getSnapshot().roomState?.contentIdentity).toBe("identity-a");
    });

    test("rejects a start-game descriptor with mismatched content identity", () => {
        const { room } = createRoomSession("identity-a");
        const launches: any[] = [];
        room.onLaunch.subscribe((_source, descriptor) => launches.push(descriptor));
        (room as any).handleStartGame(
            { id: "peer", name: "Peer" },
            {
                type: "start-game",
                descriptor: {
                    contentIdentity: "identity-b",
                    gameId: "g1",
                    timestamp: Date.now(),
                    hostPeerId: "peer",
                    localPeerId: "peer",
                    localPlayerName: "Peer",
                    gameOpts: {},
                    humanAssignments: [],
                    mapTransferStateByPeerId: {},
                    returnRoute: { screenType: 0 },
                },
            },
        );
        expect(launches).toHaveLength(0);
    });

    test("accepts a start-game descriptor with matching content identity", () => {
        const { room } = createRoomSession("identity-a");
        const launches: any[] = [];
        room.onLaunch.subscribe((_source, descriptor) => launches.push(descriptor));
        (room as any).handleStartGame(
            { id: "peer", name: "Peer" },
            {
                type: "start-game",
                descriptor: {
                    contentIdentity: "identity-a",
                    gameId: "g1",
                    timestamp: Date.now(),
                    hostPeerId: "peer",
                    localPeerId: "peer",
                    localPlayerName: "Peer",
                    gameOpts: {},
                    humanAssignments: [],
                    mapTransferStateByPeerId: {},
                    returnRoute: { screenType: 0 },
                },
            },
        );
        expect(launches).toHaveLength(1);
    });
});
