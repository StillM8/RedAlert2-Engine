import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { WeaponType } from "@/game/WeaponType";
import { RangeHelper } from "@/game/gameobject/unit/RangeHelper";
import { Coords } from "@/game/Coords";
import { FlhCoords } from "@/game/art/FlhCoords";
import { PrismSupportBeamEvent } from "@/game/event/PrismSupportBeamEvent";
import { scalarStateHash } from "@/util/stateHash";
import {
    buildPrismSupportNetwork,
    canPrismAttack,
    computePrismFireComposition,
    createPrismSupportWeaponProfile,
    normalizePrismTypeName,
    type PrismFireComposition,
    type PrismNetwork,
    type PrismNetworkNode,
    type PrismNetworkTower,
    type PrismSupportWeaponProfile,
} from "@/extensions/ares/AresPrismForwarding";
import type { DeterministicStateOwner } from "@/game/gameobject/trait/DeterministicStateOwner";

export const PRISM_SUPPORT_TRAIT_STATE_VERSION = 1 as const;

export interface PrismSupportSequenceNodeState {
    towerId: number;
    targetId: number | null;
    providerIds: number[];
    depth: number;
    chargeDelay: number;
    activationDelay: number;
    activationTick: number;
    activated: boolean;
    supportModifier: number;
    damageAdd: number;
    intensity: number;
}

export interface PrismSupportSequenceState {
    sequenceId: number;
    masterId: number;
    targetId: number | null;
    startedTick: number;
    readyTick: number;
    fireDelayHandled: boolean;
    nodes: PrismSupportSequenceNodeState[];
}

export interface PrismSupportTraitStateV1 {
    version: typeof PRISM_SUPPORT_TRAIT_STATE_VERSION;
    supportCooldownTicks: number;
    supportMasterId: number | null;
    supportTargetId: number | null;
    supportSequenceId: number | null;
    sequenceIdCounter: number;
    sequence: PrismSupportSequenceState | null;
}

export interface PrismSupportTraitRestoreContext {
    strict?: boolean;
    resolveObjectById?(id: number): any;
}

export interface PrismAttackPlan extends PrismFireComposition {
    ready: boolean;
    blocked: boolean;
    handlesFireUp: boolean;
}

function canonicalId(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function canonicalTick(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function canonicalInteger(value: unknown): value is number {
    return Number.isSafeInteger(value);
}

function canonicalNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function validateStateInternal(
    state: unknown,
    selfId: number | undefined,
    context: PrismSupportTraitRestoreContext,
): PrismSupportTraitStateV1 {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        throw new Error("Invalid PrismSupportTrait state");
    }
    const candidate = state as Record<string, unknown>;
    if (candidate.version !== PRISM_SUPPORT_TRAIT_STATE_VERSION) {
        throw new Error("Unsupported PrismSupportTrait state version");
    }
    if (!canonicalTick(candidate.supportCooldownTicks) ||
        !(candidate.supportMasterId === null || canonicalId(candidate.supportMasterId)) ||
        !(candidate.supportTargetId === null || canonicalId(candidate.supportTargetId)) ||
        !(candidate.supportSequenceId === null || canonicalId(candidate.supportSequenceId)) ||
        !canonicalId(candidate.sequenceIdCounter)) {
        throw new Error("Invalid PrismSupportTrait state fields");
    }
    const hasAssignment = candidate.supportMasterId !== null;
    if (hasAssignment !== (candidate.supportTargetId !== null) ||
        hasAssignment !== (candidate.supportSequenceId !== null)) {
        throw new Error("Invalid PrismSupportTrait assignment");
    }
    let sequence: PrismSupportSequenceState | null = null;
    if (candidate.sequence !== null) {
        const raw = candidate.sequence;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error("Invalid PrismSupportTrait sequence");
        }
        const sequenceCandidate = raw as Record<string, unknown>;
        if (!canonicalId(sequenceCandidate.sequenceId) ||
            sequenceCandidate.sequenceId === 0 ||
            !canonicalId(sequenceCandidate.masterId) ||
            !(sequenceCandidate.targetId === null || canonicalId(sequenceCandidate.targetId)) ||
            !canonicalTick(sequenceCandidate.startedTick) ||
            !canonicalTick(sequenceCandidate.readyTick) ||
            typeof sequenceCandidate.fireDelayHandled !== "boolean" ||
            !Array.isArray(sequenceCandidate.nodes) ||
            sequenceCandidate.nodes.length === 0) {
            throw new Error("Invalid PrismSupportTrait sequence fields");
        }
        if (selfId !== undefined && sequenceCandidate.masterId !== selfId) {
            throw new Error("PrismSupportTrait sequence master mismatch");
        }
        const ids = new Set<number>();
        const nodes: PrismSupportSequenceNodeState[] = sequenceCandidate.nodes.map((entry: unknown) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                throw new Error("Invalid PrismSupportTrait sequence node");
            }
            const node = entry as Record<string, unknown>;
            if (!canonicalId(node.towerId) ||
                !(node.targetId === null || canonicalId(node.targetId)) ||
                !Array.isArray(node.providerIds) ||
                node.providerIds.some(id => !canonicalId(id)) ||
                new Set(node.providerIds).size !== node.providerIds.length ||
                !canonicalTick(node.depth) ||
                !canonicalTick(node.chargeDelay) ||
                !canonicalTick(node.activationDelay) ||
                !canonicalTick(node.activationTick) ||
                typeof node.activated !== "boolean" ||
                !canonicalNumber(node.supportModifier) ||
                !canonicalInteger(node.damageAdd) ||
                !canonicalInteger(node.intensity)) {
                throw new Error("Invalid PrismSupportTrait sequence node fields");
            }
            if (ids.has(node.towerId)) {
                throw new Error("Duplicate PrismSupportTrait sequence tower");
            }
            ids.add(node.towerId);
            return {
                towerId: node.towerId as number,
                targetId: node.targetId as number | null,
                providerIds: [...node.providerIds] as number[],
                depth: node.depth as number,
                chargeDelay: node.chargeDelay as number,
                activationDelay: node.activationDelay as number,
                activationTick: node.activationTick as number,
                activated: node.activated as boolean,
                supportModifier: node.supportModifier as number,
                damageAdd: node.damageAdd as number,
                intensity: node.intensity as number,
            };
        });
        const root = nodes[0];
        if (root.towerId !== sequenceCandidate.masterId || root.targetId !== null || root.depth !== 0 ||
            root.activationTick !== sequenceCandidate.readyTick ||
            (sequenceCandidate.readyTick as number) < (sequenceCandidate.startedTick as number)) {
            throw new Error("Invalid PrismSupportTrait sequence root");
        }
        for (const node of nodes) {
            if (node.activationTick !== (sequenceCandidate.startedTick as number) + node.activationDelay ||
                node.activationTick > (sequenceCandidate.readyTick as number)) {
                throw new Error("Invalid PrismSupportTrait sequence timing");
            }
            if (node.towerId === root.towerId) continue;
            if (node.targetId === null || !ids.has(node.targetId)) {
                throw new Error("Unresolved PrismSupportTrait sequence feed");
            }
        }
        const byId = new Map(nodes.map(node => [node.towerId, node]));
        const fedProviders = new Set<number>();
        for (const node of nodes) {
            for (const providerId of node.providerIds) {
                const provider = byId.get(providerId);
                if (!provider || provider.targetId !== node.towerId || fedProviders.has(providerId)) {
                    throw new Error("Invalid PrismSupportTrait feed");
                }
                fedProviders.add(providerId);
            }
        }
        if (fedProviders.size !== nodes.length - 1) {
            throw new Error("Invalid PrismSupportTrait feed count");
        }
        for (const node of nodes) {
            const visited = new Set<number>([node.towerId]);
            let target = node.targetId;
            while (target !== null) {
                if (visited.has(target)) {
                    throw new Error("Cyclic PrismSupportTrait sequence");
                }
                visited.add(target);
                const next = byId.get(target);
                if (!next) throw new Error("Unresolved PrismSupportTrait sequence feed");
                target = next.targetId;
            }
            if (!visited.has(root.towerId)) {
                throw new Error("Disconnected PrismSupportTrait sequence");
            }
        }
        if (sequenceCandidate.sequenceId > candidate.sequenceIdCounter) {
            throw new Error("Invalid PrismSupportTrait sequence counter");
        }
        sequence = {
            sequenceId: sequenceCandidate.sequenceId as number,
            masterId: sequenceCandidate.masterId as number,
            targetId: sequenceCandidate.targetId as number | null,
            startedTick: sequenceCandidate.startedTick as number,
            readyTick: sequenceCandidate.readyTick as number,
            fireDelayHandled: sequenceCandidate.fireDelayHandled as boolean,
            nodes,
        };
    }
    const normalized: PrismSupportTraitStateV1 = {
        version: PRISM_SUPPORT_TRAIT_STATE_VERSION,
        supportCooldownTicks: candidate.supportCooldownTicks as number,
        supportMasterId: candidate.supportMasterId as number | null,
        supportTargetId: candidate.supportTargetId as number | null,
        supportSequenceId: candidate.supportSequenceId as number | null,
        sequenceIdCounter: candidate.sequenceIdCounter as number,
        sequence,
    };
    if (context.strict) {
        const resolve = context.resolveObjectById;
        if (typeof resolve !== "function") {
            throw new Error("PrismSupportTrait restore context is unavailable");
        }
        const checkObject = (id: number, label: string): any => {
            const object = resolve(id);
            if (!object || object.id !== id) {
                throw new Error(`Unresolved PrismSupportTrait ${label} ${id}`);
            }
            return object;
        };
        if (normalized.supportMasterId !== null) checkObject(normalized.supportMasterId, "master");
        if (normalized.supportTargetId !== null) checkObject(normalized.supportTargetId, "target");
        if (normalized.sequence) {
            if (normalized.sequence.targetId !== null) checkObject(normalized.sequence.targetId, "attack target");
            for (const node of normalized.sequence.nodes) {
                checkObject(node.towerId, "tower");
                if (node.targetId !== null) checkObject(node.targetId, "target");
            }
        }
    }
    return normalized;
}

export function validatePrismSupportTraitState(
    state: unknown,
    selfId?: number,
    context: PrismSupportTraitRestoreContext = {},
): PrismSupportTraitStateV1 {
    return validateStateInternal(state, selfId, context);
}

function ownerId(owner: any, game: any): number {
    if (Number.isSafeInteger(owner?.playerListIndex) && owner.playerListIndex >= 0) {
        return owner.playerListIndex;
    }
    const index = game?.playerList?.getAll?.()?.indexOf(owner) ?? -1;
    return index;
}

function positiveInteger(value: unknown): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
}

function emptyComposition(): PrismFireComposition {
    return {
        damageMultiplier: 1,
        damageBonus: 0,
        providerCount: 0,
        networkSize: 0,
        longestChain: 0,
        beamThicknessOffset: 0,
    };
}

function isOperationalPrismTower(tower: any): boolean {
    if (!tower?.isBuilding?.() || tower.isDestroyed || tower.isCrashing || tower.isDisposed || !tower.isSpawned) return false;
    if ((tower.buildStatus ?? 1) !== 1) return false;
    if (tower.attackTrait?.isDisabled?.()) return false;
    if (tower.poweredTrait && !tower.poweredTrait.isPoweredOn()) return false;
    if (tower.empTrait?.isUnderEMP?.()) return false;
    if (tower.warpedOutTrait?.isInvulnerable?.()) return false;
    return true;
}

function isBusyPrismTower(tower: any): boolean {
    const current = tower?.unitOrderTrait?.getCurrentTask?.();
    return !!current && current[Symbol.for("ra2.isAttackTask")] === true;
}

export class PrismSupportTrait implements NotifyTick, DeterministicStateOwner<PrismSupportTraitStateV1> {
    private readonly host: any;
    private readonly rulesEngine: any;
    private supportCooldownTicks = 0;
    private supportMasterId: number | null = null;
    private supportTargetId: number | null = null;
    private supportSequenceId: number | null = null;
    private sequenceIdCounter = 0;
    private sequence: PrismSupportSequenceState | null = null;

    constructor(host: any, rulesEngine: any) {
        this.host = host;
        this.rulesEngine = rulesEngine;
    }

    static isPrismAttackWeapon(tower: any, weapon: any): boolean {
        return canPrismAttack(tower?.rules?.prismForwarding) &&
            (weapon?.type === WeaponType.Primary || weapon?.type === WeaponType.Secondary);
    }

    getSupportProfile(tower: any = this.host, game: any = this.rulesEngine): PrismSupportWeaponProfile {
        const rules = tower?.rules?.prismForwarding;
        const elite = tower?.veteranTrait?.isElite?.() === true;
        const supportName = elite
            ? rules?.eliteSupportWeapon ?? rules?.supportWeapon
            : rules?.supportWeapon;
        const ruleSet = game?.rules ?? game ?? this.rulesEngine;
        let weapon: any;
        if (supportName) {
            try {
                weapon = ruleSet?.getWeapon?.(supportName);
            }
            catch {
                weapon = undefined;
            }
        }
        let primaryRange = 0;
        const primaryName = elite
            ? tower?.rules?.elitePrimary ?? tower?.rules?.primary
            : tower?.rules?.primary;
        if (primaryName) {
            try {
                primaryRange = ruleSet?.getWeapon?.(primaryName)?.range ?? 0;
            }
            catch {
                primaryRange = 0;
            }
        }
        const prism = ruleSet?.general?.prism;
        return createPrismSupportWeaponProfile(weapon, {
            primaryRange,
            supportDelay: prism?.supportDelay ?? 0,
            supportDuration: prism?.supportDuration ?? 0,
        });
    }

    private createNetworkTower(tower: any, game: any, root: boolean): PrismNetworkTower {
        const profile = this.getSupportProfile(tower, game);
        const position = tower.position.worldPosition;
        return {
            id: tower.id,
            typeName: tower.name,
            ownerId: ownerId(tower.owner, game),
            rules: tower.rules.prismForwarding,
            operational: isOperationalPrismTower(tower),
            position: {
                x: position.x / Coords.LEPTONS_PER_TILE,
                y: position.y / Coords.LEPTONS_PER_TILE,
                z: position.z / Coords.LEPTONS_PER_TILE,
            },
            supportRange: profile.range,
            minimumSupportRange: profile.minimumRange,
            supportCooldownTicks: tower.prismSupportTrait?.supportCooldownTicks ?? 0,
            busy: !root && isBusyPrismTower(tower),
            supportTargetId: tower.prismSupportTrait?.supportTargetId ?? undefined,
            fireDelay: positiveInteger(tower.art?.fireUp),
        };
    }

    private distance(first: any, second: any, game: any): number {
        if (game?.map?.tileOccupation) {
            return new RangeHelper(game.map.tileOccupation).distance3(first, second);
        }
        return Math.hypot(
            first.position.worldPosition.x - second.position.worldPosition.x,
            first.position.worldPosition.y - second.position.worldPosition.y,
            first.position.worldPosition.z - second.position.worldPosition.z,
        ) / Coords.LEPTONS_PER_TILE;
    }

    private buildNetwork(game: any): PrismNetwork {
        const buildings = (game?.world?.getAllObjects?.() ?? [])
            .filter((tower: any) => tower?.isBuilding?.() && tower.rules?.prismForwarding)
            .sort((first: any, second: any) => first.id - second.id);
        const master = buildings.find((tower: any) => tower === this.host) ?? this.host;
        const masterTower = this.createNetworkTower(master, game, true);
        const candidates = buildings.map((tower: any) => this.createNetworkTower(tower, game, tower === master));
        const alliances = game?.alliances;
        return buildPrismSupportNetwork(masterTower, candidates, {
            areAllied: (firstOwnerId, secondOwnerId) => {
                const players = game?.playerList?.getAll?.() ?? [];
                const first = players[firstOwnerId];
                const second = players[secondOwnerId];
                return !!first && !!second && !!alliances?.areAllied?.(first, second);
            },
            distance: (first, second) => Math.hypot(
                first.x - second.x,
                first.y - second.y,
                first.z - second.z,
            ),
        });
    }

    prepareAttack(game: any, target?: any): PrismAttackPlan {
        this.lastGame = game;
        if (!canPrismAttack(this.host?.rules?.prismForwarding)) {
            return { ...emptyComposition(), ready: true, blocked: false, handlesFireUp: false };
        }
        if (this.supportMasterId !== null) {
            if (!this.host.rules.prismForwarding.breakSupport) {
                return { ...emptyComposition(), ready: false, blocked: true, handlesFireUp: false };
            }
            const master = this.resolveObject(game, this.supportMasterId);
            const oldNode = master?.prismSupportTrait?.captureState?.().sequence?.nodes
                .find((node: PrismSupportSequenceNodeState) => node.towerId === this.host.id);
            master?.prismSupportTrait?.cancelAttack?.();
            this.clearSupportAssignment();
            const startedTick = Math.max(0, positiveInteger(game?.currentTick));
            const readyTick = Math.max(startedTick, oldNode?.activationTick ?? startedTick);
            const sequenceId = ++this.sequenceIdCounter;
            this.sequence = {
                sequenceId,
                masterId: this.host.id,
                targetId: canonicalId(target?.obj?.id) ? target.obj.id : null,
                startedTick,
                readyTick,
                fireDelayHandled: readyTick > startedTick || positiveInteger(this.host.art?.fireUp) > 0,
                nodes: [{
                    towerId: this.host.id,
                    targetId: null,
                    providerIds: [],
                    depth: 0,
                    chargeDelay: 0,
                    activationDelay: readyTick - startedTick,
                    activationTick: readyTick,
                    activated: false,
                    supportModifier: this.host.rules.prismForwarding.supportModifier,
                    damageAdd: this.host.rules.prismForwarding.damageAdd,
                    intensity: this.host.rules.prismForwarding.intensity,
                }],
            };
            return {
                ...emptyComposition(),
                ready: startedTick >= readyTick,
                blocked: false,
                handlesFireUp: this.sequence.fireDelayHandled,
            };
        }
        const targetId = canonicalId(target?.obj?.id) ? target.obj.id : null;
        if (this.sequence &&
            this.sequence.masterId === this.host.id &&
            this.sequence.targetId === targetId) {
            this.pruneSequence(game);
            if (!this.sequence) {
                return { ...emptyComposition(), ready: true, blocked: false, handlesFireUp: false };
            }
            if (this.sequence.nodes.length === 1) {
                const ready = game.currentTick >= this.sequence.readyTick;
                const handlesFireUp = this.sequence.fireDelayHandled;
                if (ready) this.cancelAttack();
                return { ...emptyComposition(), ready, blocked: false, handlesFireUp };
            }
            this.activateDue(game, false);
            return {
                ...this.currentComposition(),
                ready: game.currentTick >= this.sequence.readyTick,
                blocked: false,
                handlesFireUp: this.sequence.fireDelayHandled,
            };
        }
        this.cancelAttack();
        const network = this.buildNetwork(game);
        if (network.providerCount === 0) {
            return { ...emptyComposition(), ready: true, blocked: false, handlesFireUp: false };
        }
        const sequenceId = ++this.sequenceIdCounter;
        const startedTick = Math.max(0, positiveInteger(game?.currentTick));
        const root = network.nodes.find(node => node.towerId === this.host.id)!;
        this.sequence = {
            sequenceId,
            masterId: this.host.id,
            targetId,
            startedTick,
            readyTick: startedTick + root.activationDelay,
            fireDelayHandled: positiveInteger(this.host.art?.fireUp) > 0,
            nodes: network.nodes.map(node => ({
                towerId: node.towerId,
                targetId: network.edges.find(edge => edge.providerId === node.towerId)?.targetId ?? null,
                providerIds: [...node.providerIds],
                depth: node.depth,
                chargeDelay: node.chargeDelay,
                activationDelay: node.activationDelay,
                activationTick: startedTick + node.activationDelay,
                activated: false,
                supportModifier: node.supportModifier,
                damageAdd: node.damageAdd,
                intensity: node.intensity,
            })),
        };
        for (const edge of network.edges) {
            const provider = this.resolveObject(game, edge.providerId);
            provider?.prismSupportTrait?.assignSupport?.(this.host.id, edge.targetId, sequenceId, game);
        }
        this.activateDue(game, false);
        return {
            ...this.currentComposition(),
            ready: game.currentTick >= this.sequence.readyTick,
            blocked: false,
            handlesFireUp: this.sequence.fireDelayHandled,
        };
    }

    completeAttack(game: any, target?: any): PrismFireComposition {
        this.lastGame = game;
        const targetId = canonicalId(target?.obj?.id) ? target.obj.id : null;
        if (!this.sequence || this.sequence.targetId !== targetId) {
            this.cancelAttack();
            return emptyComposition();
        }
        this.pruneSequence(game);
        this.activateDue(game, true);
        const composition = this.currentComposition();
        this.cancelAttack();
        return composition;
    }

    cancelAttack(): void {
        const game = this.lastGame;
        if (this.sequence) {
            for (const node of this.sequence.nodes) {
                if (node.towerId === this.host.id) continue;
                const provider = this.resolveObject(game, node.towerId);
                if (provider?.prismSupportTrait?.supportMasterId === this.host.id) {
                    provider.prismSupportTrait.clearSupportAssignment();
                }
            }
        }
        this.sequence = null;
    }

    assignSupport(masterId: number, targetId: number, sequenceId: number, game: any = this.lastGame): void {
        if (this.supportMasterId !== null && this.supportMasterId !== masterId) {
            const master = this.resolveObject(game, this.supportMasterId);
            master?.prismSupportTrait?.cancelAttack?.();
        }
        this.lastGame = game;
        this.supportMasterId = masterId;
        this.supportTargetId = targetId;
        this.supportSequenceId = sequenceId;
    }

    private clearSupportAssignment(): void {
        this.supportMasterId = null;
        this.supportTargetId = null;
        this.supportSequenceId = null;
    }

    private lastGame: any;

    private resolveObject(game: any, id: number): any {
        try {
            return game?.getObjectById?.(id);
        }
        catch {
            return undefined;
        }
    }

    private currentComposition(): PrismFireComposition {
        if (!this.sequence) return emptyComposition();
        const nodes: PrismNetworkNode[] = this.sequence.nodes.map(node => ({
            towerId: node.towerId,
            typeName: "",
            ownerId: -1,
            depth: node.depth,
            providerIds: [...node.providerIds],
            chargeDelay: node.chargeDelay,
            activationDelay: node.activationDelay,
            supportModifier: node.supportModifier,
            damageAdd: node.damageAdd,
            intensity: node.intensity,
        }));
        return computePrismFireComposition({
            masterId: this.sequence.masterId,
            nodes,
            edges: [],
            longestChain: nodes.reduce((longest, node) => Math.max(longest, node.depth), 0),
            providerCount: Math.max(0, nodes.length - 1),
        });
    }

    private assignedEdgeIsValid(
        game: any,
        providerState: PrismSupportSequenceNodeState,
        targetState: PrismSupportSequenceNodeState,
    ): boolean {
        const provider = this.resolveObject(game, providerState.towerId);
        const target = this.resolveObject(game, targetState.towerId);
        if (!provider || !target || !isOperationalPrismTower(provider) || !isOperationalPrismTower(target)) return false;
        if (provider.prismSupportTrait?.supportMasterId !== this.host.id ||
            provider.prismSupportTrait?.supportSequenceId !== this.sequence?.sequenceId ||
            isBusyPrismTower(provider)) return false;
        const rules = provider.rules?.prismForwarding;
        if (!rules || !rules.targets.some(name => normalizePrismTypeName(name) === normalizePrismTypeName(target.name))) {
            return false;
        }
        const sameOwner = provider.owner === target.owner && provider.owner === this.host.owner;
        const allied = rules.toAllies &&
            game?.alliances?.areAllied?.(provider.owner, target.owner) &&
            game?.alliances?.areAllied?.(provider.owner, this.host.owner);
        if (!sameOwner && !allied) return false;
        const profile = this.getSupportProfile(provider, game);
        const distance = this.distance(provider, target, game);
        if (distance < profile.minimumRange) return false;
        return profile.range === Number.POSITIVE_INFINITY || distance <= profile.range;
    }

    private pruneSequence(game: any): void {
        if (!this.sequence) return;
        if (!isOperationalPrismTower(this.host)) {
            this.cancelAttack();
            return;
        }
        const byId = new Map(this.sequence.nodes.map(node => [node.towerId, node]));
        const root = byId.get(this.host.id);
        if (!root) {
            this.cancelAttack();
            return;
        }
        const keep = new Set<number>([this.host.id]);
        const visit = (receiver: PrismSupportSequenceNodeState): void => {
            for (const providerId of [...receiver.providerIds]) {
                const provider = byId.get(providerId);
                if (!provider) continue;
                if (!this.assignedEdgeIsValid(game, provider, receiver)) {
                    receiver.providerIds = receiver.providerIds.filter(id => id !== providerId);
                    continue;
                }
                if (keep.has(provider.towerId)) continue;
                keep.add(provider.towerId);
                visit(provider);
            }
        };
        visit(root);
        for (const node of this.sequence.nodes) {
            if (keep.has(node.towerId) || node.towerId === this.host.id) continue;
            const provider = this.resolveObject(game, node.towerId);
            if (provider?.prismSupportTrait?.supportMasterId === this.host.id) {
                provider.prismSupportTrait.clearSupportAssignment();
            }
        }
        this.sequence.nodes = this.sequence.nodes
            .filter(node => keep.has(node.towerId))
            .sort((first, second) => first.depth - second.depth || first.towerId - second.towerId);
        for (const node of this.sequence.nodes) {
            node.providerIds = this.sequence.nodes
                .filter(candidate => candidate.targetId === node.towerId)
                .map(candidate => candidate.towerId)
                .sort((first, second) => first - second);
        }
        if (this.sequence.nodes.length === 1) return;
        const resolveTiming = (node: PrismSupportSequenceNodeState, visited = new Set<number>()): { charge: number; fire: number } => {
            if (visited.has(node.towerId)) return { charge: 0, fire: 0 };
            const nextVisited = new Set(visited);
            nextVisited.add(node.towerId);
            const tower = this.resolveObject(game, node.towerId);
            const ownFireDelay = positiveInteger(tower?.art?.fireUp);
            let longestCharge = 0;
            let latestFire = ownFireDelay;
            for (const providerId of node.providerIds) {
                const provider = this.sequence!.nodes.find(candidate => candidate.towerId === providerId);
                if (!provider) continue;
                const timing = resolveTiming(provider, nextVisited);
                longestCharge = Math.max(longestCharge, timing.charge);
                latestFire = Math.max(latestFire, timing.fire);
            }
            node.chargeDelay = node.providerIds.length
                ? positiveInteger(tower?.rules?.prismForwarding?.chargeDelay) + longestCharge
                : 0;
            node.activationDelay = Math.max(0, latestFire - ownFireDelay + node.chargeDelay);
            node.activationTick = this.sequence!.startedTick + node.activationDelay;
            return { charge: node.chargeDelay, fire: latestFire };
        };
        resolveTiming(root);
        this.sequence.readyTick = root.activationTick;
    }

    private resolveSupportFlh(tower: any): FlhCoords {
        const elite = tower?.veteranTrait?.isElite?.() === true;
        const alternate = elite
            ? tower?.art?.eliteAlternateFireFlh
            : tower?.art?.alternateFireFlh;
        if (alternate && (alternate.forward !== 0 || alternate.lateral !== 0 || alternate.vertical !== 0)) {
            return alternate.clone();
        }
        const primary = elite
            ? tower?.art?.elitePrimaryFireFlh
            : tower?.art?.primaryFireFlh;
        return primary?.clone?.() ?? new FlhCoords();
    }

    private activateDue(game: any, force: boolean): void {
        if (!this.sequence) return;
        const longestChain = this.sequence.nodes.reduce((longest, node) => Math.max(longest, node.depth), 0);
        const due = this.sequence.nodes
            .filter(node => node.towerId !== this.host.id && !node.activated &&
                (force || game.currentTick >= node.activationTick))
            .sort((first, second) => second.depth - first.depth || first.towerId - second.towerId);
        for (const node of due) {
            const provider = this.resolveObject(game, node.towerId);
            const target = this.resolveObject(game, node.targetId!);
            if (!provider || !target) continue;
            const profile = this.getSupportProfile(provider, game);
            node.activated = true;
            provider.prismSupportTrait?.activateSupport?.(profile.rof);
            game?.events?.dispatch?.(new PrismSupportBeamEvent(
                provider,
                target,
                profile,
                this.resolveSupportFlh(provider),
                node.depth,
                longestChain - node.depth,
                this.sequence.sequenceId,
            ));
        }
    }

    private activateSupport(rof: number): void {
        this.supportCooldownTicks = Math.max(this.supportCooldownTicks, positiveInteger(rof));
    }

    [NotifyTick.onTick](_tower: any, game: any): void {
        this.lastGame = game;
        if (this.supportCooldownTicks > 0) this.supportCooldownTicks--;
        if (this.supportMasterId !== null) {
            const master = this.resolveObject(game, this.supportMasterId);
            const masterSequence = master?.prismSupportTrait?.sequence;
            const assigned = masterSequence?.sequenceId === this.supportSequenceId &&
                masterSequence.nodes.some(node => node.towerId === this.host.id);
            if (!assigned) this.clearSupportAssignment();
        }
        this.pruneSequence(game);
        this.activateDue(game, false);
    }

    getHash(): number {
        return scalarStateHash("PrismSupportTrait", this.captureState());
    }

    captureState(): PrismSupportTraitStateV1 {
        return {
            version: PRISM_SUPPORT_TRAIT_STATE_VERSION,
            supportCooldownTicks: this.supportCooldownTicks,
            supportMasterId: this.supportMasterId,
            supportTargetId: this.supportTargetId,
            supportSequenceId: this.supportSequenceId,
            sequenceIdCounter: this.sequenceIdCounter,
            sequence: this.sequence ? {
                sequenceId: this.sequence.sequenceId,
                masterId: this.sequence.masterId,
                targetId: this.sequence.targetId,
                startedTick: this.sequence.startedTick,
                readyTick: this.sequence.readyTick,
                fireDelayHandled: this.sequence.fireDelayHandled,
                nodes: this.sequence.nodes.map(node => ({
                    ...node,
                    providerIds: [...node.providerIds],
                })),
            } : null,
        };
    }

    validateState(state: unknown, context: PrismSupportTraitRestoreContext = {}): void {
        validateStateInternal(state, this.host?.id, context);
    }

    restoreState(state: unknown, context: PrismSupportTraitRestoreContext = {}): void {
        const normalized = validateStateInternal(state, this.host?.id, context);
        this.supportCooldownTicks = normalized.supportCooldownTicks;
        this.supportMasterId = normalized.supportMasterId;
        this.supportTargetId = normalized.supportTargetId;
        this.supportSequenceId = normalized.supportSequenceId;
        this.sequenceIdCounter = normalized.sequenceIdCounter;
        this.sequence = normalized.sequence ? {
            sequenceId: normalized.sequence.sequenceId,
            masterId: normalized.sequence.masterId,
            targetId: normalized.sequence.targetId,
            startedTick: normalized.sequence.startedTick,
            readyTick: normalized.sequence.readyTick,
            fireDelayHandled: normalized.sequence.fireDelayHandled,
            nodes: normalized.sequence.nodes.map(node => ({
                towerId: node.towerId,
                targetId: node.targetId,
                providerIds: [...node.providerIds],
                depth: node.depth,
                chargeDelay: node.chargeDelay,
                activationDelay: node.activationDelay,
                activationTick: node.activationTick,
                activated: node.activated,
                supportModifier: node.supportModifier,
                damageAdd: node.damageAdd,
                intensity: node.intensity,
            })),
        } : null;
    }

    debugGetState(): PrismSupportTraitStateV1 {
        return this.captureState();
    }

    dispose(): void {
        this.cancelAttack();
        this.clearSupportAssignment();
        this.supportCooldownTicks = 0;
    }
}
