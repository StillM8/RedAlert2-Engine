import { EventDispatcher } from '@/util/event';
import {
    decodeLanQrPacket,
    encodeLanQrPacket,
    LanInvitePacket,
    LanJoinResponsePacket,
    LanPeerIdentity,
} from '@/network/lan/LanQrPayload';
import { formatSdpCandidateSummary, getSdpCandidateWarning, summarizeSdpCandidates } from '@/network/lan/SdpCandidateDiagnostics';

type ControlEnvelope =
    | {
        type: 'hello';
        roomId: string;
        self: LanPeerIdentity;
        members: LanPeerIdentity[];
    }
    | {
        type: 'room-sync';
        roomId: string;
        members: LanPeerIdentity[];
    }
    | {
        type: 'member-join';
        roomId: string;
        member: LanPeerIdentity;
    }
    | {
        type: 'member-leave';
        roomId: string;
        peerId: string;
        reason: 'left' | 'disconnect';
    }
    | {
        type: 'mesh-connect-request';
        roomId: string;
        target: LanPeerIdentity;
    }
    | {
        type: 'relay-signal';
        roomId: string;
        source: LanPeerIdentity;
        targetPeerId: string;
        signalType: 'offer' | 'answer';
        description: RTCSessionDescriptionInit;
    }
    | {
        type: 'chat';
        roomId: string;
        from: LanPeerIdentity;
        text: string;
        timestamp: number;
    }
    | {
        type: 'app-message';
        roomId: string;
        from: LanPeerIdentity;
        payload: unknown;
    };

type LinkRole = 'inviter' | 'joiner' | 'mesh-offerer' | 'mesh-answerer';
type LinkStatus = 'connecting' | 'connected' | 'closed';

interface LinkContext {
    key: string;
    peer?: LanPeerIdentity;
    pc: RTCPeerConnection;
    channel?: RTCDataChannel;
    role: LinkRole;
    status: LinkStatus;
}

interface PendingInvite {
    inviteId: string;
    context: LinkContext;
}

interface ActiveQrPayload {
    kind: 'invite' | 'join-response';
    text: string;
    title: string;
    description: string;
}

export interface LanMemberSnapshot extends LanPeerIdentity {
    isSelf: boolean;
    isDirect: boolean;
    status: 'self' | 'known' | 'connected' | 'connecting';
}

export interface LanMeshSnapshot {
    self: LanPeerIdentity;
    roomId?: string;
    isInRoom: boolean;
    roomReady: boolean;
    directPeerCount: number;
    members: LanMemberSnapshot[];
    activeQrPayloadText: string;
    activeQrPayloadKind?: 'invite' | 'join-response';
    activeQrPayloadTitle?: string;
    activeQrPayloadDescription?: string;
}

export interface LanMeshLogEntry {
    level: 'info' | 'warn' | 'error';
    text: string;
    timestamp: number;
}

export interface LanMeshChatEntry {
    from: LanPeerIdentity;
    text: string;
    timestamp: number;
}

export interface LanMeshAppMessage {
    from: LanPeerIdentity;
    payload: unknown;
    timestamp: number;
}

const ICE_GATHER_TIMEOUT_MILLIS = 10000;

function generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const random = (Math.random() * 16) | 0;
        const value = char === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
}

function generateShortCode(): string {
    return generateId().replace(/-/g, '').slice(0, 6).toUpperCase();
}

function createPeerConnection(): RTCPeerConnection {
    if (typeof RTCPeerConnection === 'undefined') {
        throw new Error('This browser does not support WebRTC.');
    }
    // Public STUN servers are safe for LAN: they only help peers discover
    // their public socket addresses for NAT traversal; media/data still flow
    // peer-to-peer. Without them, Android WebView and desktop WebViews often
    // expose only mDNS host candidates, which fail under AP isolation or
    // across subnets. STUN dramatically improves cross-platform connectivity.
    const iceServers: RTCIceServer[] = [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        { urls: ['stun:stun.cloudflare.com:3478'] },
    ];
    return new RTCPeerConnection({
        iceServers,
    });
}

export class LanMeshSession {
    private readonly self: LanPeerIdentity = {
        id: generateId(),
        name: `Player-${generateShortCode()}`,
    };
    private roomId?: string;
    private readonly members = new Map<string, LanPeerIdentity>();
    private readonly linksByKey = new Map<string, LinkContext>();
    private readonly directLinks = new Map<string, LinkContext>();
    private pendingInvite?: PendingInvite;
    private activeQrPayload?: ActiveQrPayload;

    public readonly onSnapshotChange = new EventDispatcher<this, LanMeshSnapshot>();
    public readonly onLog = new EventDispatcher<this, LanMeshLogEntry>();
    public readonly onChat = new EventDispatcher<this, LanMeshChatEntry>();
    public readonly onAppMessage = new EventDispatcher<this, LanMeshAppMessage>();

    constructor() {
        this.members.set(this.self.id, this.self);
    }

    getSnapshot(): LanMeshSnapshot {
        return this.createSnapshot();
    }

    getSelf(): LanPeerIdentity {
        return { ...this.self };
    }

    ensureLocalRoom(): LanMeshSnapshot {
        this.ensureRoom();
        this.dispatchSnapshot();
        return this.createSnapshot();
    }

    updateSelfName(name: string): void {
        const trimmed = name.trim();
        if (!trimmed || trimmed === this.self.name) {
            return;
        }
        this.self.name = trimmed.slice(0, 24);
        this.members.set(this.self.id, { ...this.self });
        if (this.isInRoom()) {
            this.broadcastRoomSync();
        }
        this.dispatchSnapshot();
    }

    async createRoomInvite(): Promise<void> {
        this.ensureRoom();
        this.disposePendingInvite();

        const context = this.createOutgoingLink(undefined, 'inviter');
        const inviteId = generateId();
        this.pendingInvite = {
            inviteId,
            context,
        };

        this.log('info', 'Generating invite QR code...');
        await context.pc.setLocalDescription(await context.pc.createOffer());
        await this.waitForIceGatheringComplete(context.pc);
        this.logLinkDiagnostics(context, 'Invite offer');

        const packet: LanInvitePacket = {
            version: 1,
            kind: 'invite',
            roomId: this.roomId!,
            inviteId,
            inviter: { ...this.self },
            description: context.pc.localDescription!,
        };

        this.activeQrPayload = {
            kind: 'invite',
            text: await encodeLanQrPacket(packet),
            title: 'Invite QR Code',
            description: 'Have the new player scan this QR code to join the room.',
        };
        this.log('info', 'Invite QR code generated. Waiting for the join response.');
        this.dispatchSnapshot();
    }

    async importPayload(payloadText: string): Promise<void> {
        const packet = await decodeLanQrPacket(payloadText);

        if (packet.kind === 'invite') {
            await this.acceptInvite(packet);
            return;
        }

        await this.acceptJoinResponse(packet);
    }

    async sendChat(text: string): Promise<void> {
        const normalizedText = text.trim();
        if (!normalizedText) {
            return;
        }
        if (!this.directLinks.size) {
            throw new Error('No directly connected players yet; room messages cannot be sent.');
        }

        const envelope: ControlEnvelope = {
            type: 'chat',
            roomId: this.roomId!,
            from: { ...this.self },
            text: normalizedText,
            timestamp: Date.now(),
        };
        this.broadcastEnvelope(envelope);
        this.onChat.dispatch(this, {
            from: { ...this.self },
            text: normalizedText,
            timestamp: envelope.timestamp,
        });
    }

    broadcastAppMessage(payload: unknown, excludedPeerId?: string): void {
        if (!this.roomId) {
            throw new Error('There is no LAN room yet.');
        }
        const envelope: ControlEnvelope = {
            type: 'app-message',
            roomId: this.roomId,
            from: { ...this.self },
            payload,
        };
        this.broadcastEnvelope(envelope, excludedPeerId);
    }

    sendAppMessage(peerId: string, payload: unknown): void {
        if (!this.roomId) {
            throw new Error('There is no LAN room yet.');
        }
        this.sendDirectEnvelope(peerId, {
            type: 'app-message',
            roomId: this.roomId,
            from: { ...this.self },
            payload,
        });
    }

    leaveRoom(): void {
        if (this.isInRoom()) {
            this.broadcastEnvelope({
                type: 'member-leave',
                roomId: this.roomId!,
                peerId: this.self.id,
                reason: 'left',
            });
        }
        this.reset();
    }

    reset(): void {
        this.disposePendingInvite();
        Array.from(this.linksByKey.values()).forEach((context) => this.disposeLink(context));
        this.linksByKey.clear();
        this.directLinks.clear();
        this.roomId = undefined;
        this.members.clear();
        this.members.set(this.self.id, { ...this.self });
        this.activeQrPayload = undefined;
        this.dispatchSnapshot();
    }

    private isInRoom(): boolean {
        return Boolean(this.roomId);
    }

    private ensureRoom(): void {
        if (!this.roomId) {
            this.roomId = generateShortCode();
            this.members.set(this.self.id, { ...this.self });
            this.log('info', `Created LAN room ${this.roomId}.`);
        }
    }

    private createSnapshot(): LanMeshSnapshot {
        const members = Array.from(this.members.values())
            .map((member) => {
                const directLink = this.directLinks.get(member.id);
                return {
                    ...member,
                    isSelf: member.id === this.self.id,
                    isDirect: member.id === this.self.id || Boolean(directLink),
                    status: member.id === this.self.id
                        ? 'self'
                        : !directLink
                            ? 'known'
                            : directLink.status === 'connected'
                                ? 'connected'
                                : 'connecting',
                } satisfies LanMemberSnapshot;
            })
            .sort((left, right) => {
                if (left.isSelf) {
                    return -1;
                }
                if (right.isSelf) {
                    return 1;
                }
                return left.name.localeCompare(right.name, 'zh-Hans-CN');
            });

        return {
            self: { ...this.self },
            roomId: this.roomId,
            isInRoom: this.isInRoom(),
            roomReady: this.directLinks.size > 0,
            directPeerCount: Array.from(this.directLinks.values()).filter((context) => context.status === 'connected').length,
            members,
            activeQrPayloadText: this.activeQrPayload?.text ?? '',
            activeQrPayloadKind: this.activeQrPayload?.kind,
            activeQrPayloadTitle: this.activeQrPayload?.title,
            activeQrPayloadDescription: this.activeQrPayload?.description,
        };
    }

    private dispatchSnapshot(): void {
        this.onSnapshotChange.dispatch(this, this.createSnapshot());
    }

    private createOutgoingLink(peer: LanPeerIdentity | undefined, role: LinkRole): LinkContext {
        const context: LinkContext = {
            key: generateId(),
            peer,
            pc: createPeerConnection(),
            role,
            status: 'connecting',
        };
        this.linksByKey.set(context.key, context);
        if (peer) {
            this.directLinks.set(peer.id, context);
        }
        this.bindPeerEvents(context);
        this.attachDataChannel(context, context.pc.createDataChannel('ra2-lan-room', {
            ordered: true,
        }));
        this.dispatchSnapshot();
        return context;
    }

    private createIncomingLink(peer: LanPeerIdentity, role: LinkRole): LinkContext {
        const context: LinkContext = {
            key: generateId(),
            peer,
            pc: createPeerConnection(),
            role,
            status: 'connecting',
        };
        this.linksByKey.set(context.key, context);
        this.directLinks.set(peer.id, context);
        this.bindPeerEvents(context);
        context.pc.ondatachannel = (event) => {
            if (!this.linksByKey.has(context.key)) {
                return;
            }
            this.attachDataChannel(context, event.channel);
        };
        this.dispatchSnapshot();
        return context;
    }

    private bindPeerEvents(context: LinkContext): void {
        const { pc } = context;

        pc.addEventListener('connectionstatechange', () => {
            if (!this.linksByKey.has(context.key)) {
                return;
            }
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
                this.handleLinkClosed(context, pc.connectionState === 'closed' ? 'left' : 'disconnect');
                return;
            }
            this.dispatchSnapshot();
        });
        pc.addEventListener('icecandidateerror', (event) => {
            if (!this.linksByKey.has(context.key)) {
                return;
            }
            const address = 'address' in event && typeof event.address === 'string' ? ` ${event.address}` : '';
            this.log('warn', `ICE candidate gathering error for ${context.peer?.name ?? 'unknown player'}${address}: ${event.errorText || 'unknown error'}.`);
        });
    }

    private attachDataChannel(context: LinkContext, channel: RTCDataChannel): void {
        context.channel = channel;
        channel.binaryType = 'arraybuffer';

        channel.addEventListener('open', () => {
            if (!this.linksByKey.has(context.key)) {
                return;
            }
            context.status = 'connected';
            if (context.peer) {
                this.members.set(context.peer.id, { ...context.peer });
            }
            this.handleLinkOpened(context);
            this.dispatchSnapshot();
        });

        channel.addEventListener('close', () => {
            if (!this.linksByKey.has(context.key)) {
                return;
            }
            this.handleLinkClosed(context, 'disconnect');
        });

        channel.addEventListener('error', () => {
            if (!this.linksByKey.has(context.key)) {
                return;
            }
            this.log('error', `Data channel error for ${context.peer?.name ?? 'unknown player'}.`);
        });

        channel.addEventListener('message', (event) => {
            if (!this.linksByKey.has(context.key)) {
                return;
            }
            this.handleChannelMessage(context, event.data);
        });
    }

    private async acceptInvite(packet: LanInvitePacket): Promise<void> {
        if (this.roomId && this.members.size > 1) {
            throw new Error('You are already in a LAN room and cannot scan an invite code for another room.');
        }

        this.reset();
        this.roomId = packet.roomId;
        this.members.set(this.self.id, { ...this.self });
        this.members.set(packet.inviter.id, packet.inviter);

        const context = this.createIncomingLink(packet.inviter, 'joiner');
        this.log('info', `Joining room ${packet.roomId}, generating the response QR code...`);

        await context.pc.setRemoteDescription(packet.description);
        await context.pc.setLocalDescription(await context.pc.createAnswer());
        await this.waitForIceGatheringComplete(context.pc);
        this.logLinkDiagnostics(context, 'Join answer');

        const response: LanJoinResponsePacket = {
            version: 1,
            kind: 'join-response',
            roomId: packet.roomId,
            inviteId: packet.inviteId,
            inviterPeerId: packet.inviter.id,
            joiner: { ...this.self },
            description: context.pc.localDescription!,
        };

        this.activeQrPayload = {
            kind: 'join-response',
            text: await encodeLanQrPacket(response),
            title: 'Join Response QR Code',
            description: `Have ${packet.inviter.name} scan this QR code to finish joining the room.`,
        };
        this.dispatchSnapshot();
    }

    private async acceptJoinResponse(packet: LanJoinResponsePacket): Promise<void> {
        if (!this.pendingInvite) {
            throw new Error('There is no pending invite QR code.');
        }
        if (packet.inviterPeerId !== this.self.id || packet.inviteId !== this.pendingInvite.inviteId) {
            throw new Error('This join response does not match the current invite QR code.');
        }

        const { context } = this.pendingInvite;
        context.peer = packet.joiner;
        this.directLinks.set(packet.joiner.id, context);
        this.members.set(packet.joiner.id, packet.joiner);
        this.log('info', `Connecting to ${packet.joiner.name}...`);
        await context.pc.setRemoteDescription(packet.description);
        this.pendingInvite = undefined;
        this.activeQrPayload = undefined;
        this.dispatchSnapshot();
    }

    private handleLinkOpened(context: LinkContext): void {
        if (!context.peer || !this.roomId) {
            return;
        }

        this.sendDirectEnvelope(context.peer.id, {
            type: 'hello',
            roomId: this.roomId,
            self: { ...this.self },
            members: this.getMemberList(),
        });

        if (context.role === 'inviter') {
            this.log('info', `${context.peer.name} joined the room; establishing direct links with the other members.`);
            this.broadcastRoomSync();
            Array.from(this.directLinks.values())
                .filter((link) => link.peer && link.peer.id !== context.peer!.id && link.status === 'connected')
                .forEach((link) => {
                    this.sendDirectEnvelope(link.peer!.id, {
                        type: 'member-join',
                        roomId: this.roomId!,
                        member: context.peer!,
                    });
                    this.sendDirectEnvelope(link.peer!.id, {
                        type: 'mesh-connect-request',
                        roomId: this.roomId!,
                        target: context.peer!,
                    });
                });
        }

        if (context.role === 'joiner') {
            this.activeQrPayload = undefined;
            this.log('info', 'Joined the room. Waiting for direct links with the other members to be set up automatically.');
        }

        if (context.role === 'mesh-offerer' || context.role === 'mesh-answerer') {
            this.log('info', `Direct link established with ${context.peer.name}.`);
            this.broadcastRoomSync();
        }
    }

    private handleLinkClosed(context: LinkContext, reason: 'left' | 'disconnect'): void {
        if (!this.linksByKey.has(context.key)) {
            return;
        }

        this.linksByKey.delete(context.key);
        context.status = 'closed';

        if (context.peer) {
            this.directLinks.delete(context.peer.id);
            if (this.members.delete(context.peer.id)) {
                this.log(reason === 'left' ? 'info' : 'warn', `${context.peer.name} left the room.`);
            }
        }

        this.disposeLink(context);
        this.broadcastRoomSync();
        this.dispatchSnapshot();
    }

    private handleChannelMessage(context: LinkContext, data: string | ArrayBuffer | Blob): void {
        if (typeof data === 'string') {
            this.handleEnvelopeText(context, data);
            return;
        }
        if (data instanceof ArrayBuffer) {
            this.handleEnvelopeText(context, new TextDecoder().decode(new Uint8Array(data)));
            return;
        }
        if (typeof Blob !== 'undefined' && data instanceof Blob) {
            data.text().then((text) => this.handleEnvelopeText(context, text)).catch((error) => {
                this.log('warn', `Failed to read network message: ${(error as Error).message}`);
            });
        }
    }

    private handleEnvelopeText(context: LinkContext, text: string): void {
        let payload: ControlEnvelope | undefined;
        try {
            payload = JSON.parse(text) as ControlEnvelope;
        }
        catch {
            payload = undefined;
        }

        if (!payload || typeof payload !== 'object') {
            this.log('warn', 'Received an unrecognized room message.');
            return;
        }

        switch (payload.type) {
            case 'hello':
                this.mergeMembers(payload.self, ...payload.members);
                this.dispatchSnapshot();
                return;
            case 'room-sync':
                this.mergeMembers(...payload.members);
                this.dispatchSnapshot();
                return;
            case 'member-join':
                this.members.set(payload.member.id, payload.member);
                this.log('info', `${payload.member.name} entered the room.`);
                this.dispatchSnapshot();
                return;
            case 'member-leave':
                if (payload.peerId !== this.self.id) {
                    this.removePeer(payload.peerId, payload.reason);
                }
                return;
            case 'mesh-connect-request':
                this.handleMeshConnectRequest(context, payload.target).catch((error) => {
                    this.log('warn', `Failed to initiate a direct link to ${payload.target.name}: ${(error as Error).message}`);
                });
                return;
            case 'relay-signal':
                this.handleRelaySignal(context, payload).catch((error) => {
                    this.log('warn', `Failed to handle relayed signal: ${(error as Error).message}`);
                });
                return;
            case 'chat':
                this.onChat.dispatch(this, {
                    from: payload.from,
                    text: payload.text,
                    timestamp: payload.timestamp,
                });
                return;
            case 'app-message':
                this.onAppMessage.dispatch(this, {
                    from: payload.from,
                    payload: payload.payload,
                    timestamp: Date.now(),
                });
                return;
            default:
                this.log('warn', 'Received a network control message of unknown type.');
        }
    }

    private async handleMeshConnectRequest(relayContext: LinkContext, target: LanPeerIdentity): Promise<void> {
        if (!relayContext.peer || target.id === this.self.id || this.directLinks.has(target.id)) {
            return;
        }

        this.members.set(target.id, target);
        const context = this.createOutgoingLink(target, 'mesh-offerer');
        await context.pc.setLocalDescription(await context.pc.createOffer());
        await this.waitForIceGatheringComplete(context.pc);
        this.logLinkDiagnostics(context, `Mesh offer to ${target.name}`);

        this.sendDirectEnvelope(relayContext.peer.id, {
            type: 'relay-signal',
            roomId: this.roomId!,
            source: { ...this.self },
            targetPeerId: target.id,
            signalType: 'offer',
            description: context.pc.localDescription!,
        });
    }

    private async handleRelaySignal(relayContext: LinkContext, payload: Extract<ControlEnvelope, { type: 'relay-signal' }>): Promise<void> {
        if (!relayContext.peer) {
            return;
        }

        if (payload.targetPeerId !== this.self.id) {
            this.sendDirectEnvelope(payload.targetPeerId, payload);
            return;
        }

        this.members.set(payload.source.id, payload.source);

        if (payload.signalType === 'offer') {
            if (this.directLinks.has(payload.source.id)) {
                return;
            }
            const context = this.createIncomingLink(payload.source, 'mesh-answerer');
            await context.pc.setRemoteDescription(payload.description);
            await context.pc.setLocalDescription(await context.pc.createAnswer());
            await this.waitForIceGatheringComplete(context.pc);
            this.logLinkDiagnostics(context, `Mesh answer to ${payload.source.name}`);

            this.sendDirectEnvelope(relayContext.peer.id, {
                type: 'relay-signal',
                roomId: this.roomId!,
                source: { ...this.self },
                targetPeerId: payload.source.id,
                signalType: 'answer',
                description: context.pc.localDescription!,
            });
            return;
        }

        const existingLink = this.directLinks.get(payload.source.id);
        if (!existingLink) {
            throw new Error(`No pending direct link found for ${payload.source.name}.`);
        }
        await existingLink.pc.setRemoteDescription(payload.description);
    }

    private mergeMembers(...members: LanPeerIdentity[]): void {
        members.forEach((member) => {
            this.members.set(member.id, member);
        });
    }

    private removePeer(peerId: string, reason: 'left' | 'disconnect'): void {
        const member = this.members.get(peerId);
        this.members.delete(peerId);
        const link = this.directLinks.get(peerId);
        if (link) {
            this.linksByKey.delete(link.key);
            this.directLinks.delete(peerId);
            this.disposeLink(link);
        }
        if (member) {
            this.log(reason === 'left' ? 'info' : 'warn', `${member.name} left the room.`);
        }
        this.dispatchSnapshot();
    }

    private getMemberList(): LanPeerIdentity[] {
        return Array.from(this.members.values()).map((member) => ({ ...member }));
    }

    private broadcastRoomSync(): void {
        if (!this.roomId || !this.directLinks.size) {
            this.dispatchSnapshot();
            return;
        }
        this.broadcastEnvelope({
            type: 'room-sync',
            roomId: this.roomId,
            members: this.getMemberList(),
        });
    }

    private broadcastEnvelope(envelope: ControlEnvelope, excludedPeerId?: string): void {
        Array.from(this.directLinks.values())
            .filter((context) => context.peer && context.peer.id !== excludedPeerId && context.status === 'connected')
            .forEach((context) => {
                try {
                    this.safeSend(context, envelope);
                }
                catch (error) {
                    this.log('warn', `Failed to send network message to ${context.peer?.name ?? 'unknown player'}: ${(error as Error).message}`);
                    this.handleLinkClosed(context, 'disconnect');
                }
            });
    }

    private sendDirectEnvelope(peerId: string, envelope: ControlEnvelope): void {
        const context = this.directLinks.get(peerId);
        if (!context) {
            throw new Error(`No direct channel to ${peerId}.`);
        }
        try {
            this.safeSend(context, envelope);
        }
        catch (error) {
            this.log('warn', `Failed to send network message to ${context.peer?.name ?? peerId}: ${(error as Error).message}`);
            this.handleLinkClosed(context, 'disconnect');
            throw error;
        }
    }

    private safeSend(context: LinkContext, envelope: ControlEnvelope): void {
        if (!context.channel || context.channel.readyState !== 'open') {
            throw new Error(`Data channel with ${context.peer?.name ?? 'unknown player'} is not open yet.`);
        }
        context.channel.send(JSON.stringify(envelope));
    }

    private async waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
        if (pc.iceGatheringState === 'complete') {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                cleanup();
                reject(new Error('ICE candidate gathering timed out. Please try again later.'));
            }, ICE_GATHER_TIMEOUT_MILLIS);

            const handleChange = () => {
                if (pc.iceGatheringState === 'complete') {
                    cleanup();
                    resolve();
                }
            };

            const cleanup = () => {
                clearTimeout(timeoutId);
                pc.removeEventListener('icegatheringstatechange', handleChange);
            };

            pc.addEventListener('icegatheringstatechange', handleChange);
        });
    }

    private disposePendingInvite(): void {
        if (!this.pendingInvite) {
            return;
        }
        this.disposeLink(this.pendingInvite.context);
        this.linksByKey.delete(this.pendingInvite.context.key);
        this.pendingInvite = undefined;
    }

    private disposeLink(context: LinkContext): void {
        try {
            context.channel?.close();
        }
        catch {
        }
        try {
            context.pc.close();
        }
        catch {
        }
    }

    private log(level: LanMeshLogEntry['level'], text: string): void {
        this.onLog.dispatch(this, {
            level,
            text,
            timestamp: Date.now(),
        });
    }

    private logLinkDiagnostics(context: LinkContext, label: string): void {
        const summary = summarizeSdpCandidates(context.pc.localDescription);
        this.log('info', `${label} candidates: ${formatSdpCandidateSummary(summary)}.`);
        const warning = getSdpCandidateWarning(summary);
        if (warning) {
            this.log('warn', warning);
        }
    }
}
