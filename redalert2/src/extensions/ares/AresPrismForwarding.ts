import { parseAresRgb, type AresRgb } from "@/extensions/ares/AresWeaponVisuals";

export enum PrismForwardingMode {
    No = "no",
    Forward = "forward",
    Attack = "attack",
    Both = "yes",
}

export interface PrismForwardingGlobalRules {
    type: string;
    supportMax: number;
    supportModifier: number;
    supportHeight: number;
    supportDelay: number;
    supportDuration: number;
}

export interface PrismForwardingRules {
    mode: PrismForwardingMode;
    targets: string[];
    maxFeeds: number;
    maxChainLength: number;
    maxNetworkSize: number;
    supportModifier: number;
    damageAdd: number;
    myHeight: number;
    toAllies: boolean;
    breakSupport: boolean;
    chargeDelay: number;
    intensity: number;
    supportWeapon?: string;
    eliteSupportWeapon?: string;
}

export interface PrismSupportWeaponProfile {
    range: number;
    minimumRange: number;
    rof: number;
    report: string[];
    isLaser: boolean;
    laserDuration: number;
    isHouseColor: boolean;
    laserInnerColor?: AresRgb;
    laserOuterColor?: AresRgb;
    laserOuterSpread: number;
    laserThickness: number;
    isElectricBolt: boolean;
    isAlternateColor: boolean;
    boltColors: [AresRgb | undefined, AresRgb | undefined, AresRgb | undefined];
    isRadBeam: boolean;
    beamDuration: number;
    beamIsHouseColor: boolean;
    beamColor?: AresRgb;
    beamAmplitude: number;
}

interface IniReader {
    entries?: Map<string, string | string[]>;
    getNumber(key: string, defaultValue?: number): number;
    getString(key: string, defaultValue?: string): string;
    getBool(key: string, defaultValue?: boolean): boolean;
    getArray(key: string): string[];
    has(key: string): boolean;
}

export function normalizePrismTypeName(name: string | undefined): string {
    return (name ?? "").trim().toLocaleLowerCase("en-US");
}

export function canPrismAttack(rules: PrismForwardingRules | undefined): boolean {
    return rules?.mode === PrismForwardingMode.Attack || rules?.mode === PrismForwardingMode.Both;
}

export function canPrismForward(rules: PrismForwardingRules | undefined): boolean {
    return rules?.mode === PrismForwardingMode.Forward || rules?.mode === PrismForwardingMode.Both;
}

function integer(value: number, fallback: number): number {
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function finiteNumber(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function limit(value: number, fallback: number): number {
    const normalized = integer(value, fallback);
    return normalized === -1 ? -1 : Math.max(0, normalized);
}

function weaponReference(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    const compact = normalizePrismTypeName(normalized).replace(/[^a-z0-9]/g, "");
    return compact === "none" || compact === "notaweapon" ? undefined : normalized;
}

function modeFromIni(value: string, fallback: PrismForwardingMode): PrismForwardingMode {
    switch (value.trim().toLocaleLowerCase("en-US")) {
        case "yes":
        case "true":
            return PrismForwardingMode.Both;
        case "no":
        case "false":
            return PrismForwardingMode.No;
        case "forward":
            return PrismForwardingMode.Forward;
        case "attack":
            return PrismForwardingMode.Attack;
        default:
            return fallback;
    }
}

export function parsePrismForwardingRules(
    ini: IniReader,
    buildingName: string | undefined,
    globalRules: PrismForwardingGlobalRules,
): PrismForwardingRules {
    const fallbackMode = buildingName &&
        normalizePrismTypeName(globalRules.type) === normalizePrismTypeName(buildingName)
        ? PrismForwardingMode.Both
        : PrismForwardingMode.No;
    const mode = modeFromIni(buildingName ? ini.getString("PrismForwarding", "") : "", fallbackMode);
    const authoredTargets = ini.has("PrismForwarding.Targets")
        ? ini.getArray("PrismForwarding.Targets")
        : buildingName ? [buildingName] : [];
    const targets: string[] = [];
    const targetKeys = new Set<string>();
    for (const value of authoredTargets) {
        const target = value.trim();
        const key = normalizePrismTypeName(target);
        if (!key || targetKeys.has(key)) continue;
        targetKeys.add(key);
        targets.push(target);
    }
    const supportWeapon = weaponReference(ini.getString("PrismForwarding.SupportWeapon", ""));
    const eliteWeapon = weaponReference(ini.getString(
        "PrismForwarding.EliteSupportWeapon",
        supportWeapon ?? "",
    ));
    return {
        mode,
        targets: targets.length || !ini.has("PrismForwarding.Targets") ? targets : [],
        maxFeeds: limit(ini.getNumber("PrismForwarding.MaxFeeds", globalRules.supportMax), globalRules.supportMax),
        maxChainLength: limit(ini.getNumber("PrismForwarding.MaxChainLength", 1), 1),
        maxNetworkSize: limit(ini.getNumber("PrismForwarding.MaxNetworkSize", globalRules.supportMax), globalRules.supportMax),
        supportModifier: finiteNumber(ini.getNumber("PrismForwarding.SupportModifier", globalRules.supportModifier), globalRules.supportModifier),
        damageAdd: integer(ini.getNumber("PrismForwarding.DamageAdd", 0), 0),
        myHeight: integer(ini.getNumber("PrismForwarding.MyHeight", globalRules.supportHeight), globalRules.supportHeight),
        toAllies: ini.getBool("PrismForwarding.ToAllies", false),
        breakSupport: ini.getBool("PrismForwarding.BreakSupport", false),
        chargeDelay: Math.max(1, integer(ini.getNumber("PrismForwarding.ChargeDelay", 1), 1)),
        intensity: integer(ini.getNumber("PrismForwarding.Intensity", -2), -2),
        supportWeapon,
        eliteSupportWeapon: eliteWeapon,
    };
}

function color(value: unknown): AresRgb | undefined {
    if (Array.isArray(value)) return parseAresRgb(value.join(","));
    return parseAresRgb(typeof value === "string" ? value : undefined);
}

function rangeValue(value: unknown, fallback: number): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (numeric === -2) return Number.POSITIVE_INFINITY;
    if (numeric === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
    return Number.isFinite(numeric) ? numeric : fallback;
}

function supportDelayValue(value: unknown, fallback: number): number {
    const numeric = typeof value === "number" ? value : Number(value);
    return Math.max(0, integer(Number.isFinite(numeric) ? numeric : fallback, fallback));
}

export function createPrismSupportWeaponProfile(
    weapon: any,
    defaults: {
        primaryRange: number;
        supportDelay: number;
        supportDuration: number;
    },
): PrismSupportWeaponProfile {
    if (!weapon) {
        const range = defaults.primaryRange === Number.POSITIVE_INFINITY
            ? Number.POSITIVE_INFINITY
            : Math.max(0, defaults.primaryRange + 1);
        return {
            range,
            minimumRange: 0,
            rof: supportDelayValue(defaults.supportDelay, 0),
            report: [],
            isLaser: true,
            laserDuration: supportDelayValue(defaults.supportDuration, 0),
            isHouseColor: true,
            laserOuterSpread: 0,
            laserThickness: 3,
            isElectricBolt: false,
            isAlternateColor: false,
            boltColors: [undefined, undefined, undefined],
            isRadBeam: false,
            beamDuration: 15,
            beamIsHouseColor: false,
            beamAmplitude: 40,
        };
    }
    const rules = weapon.range !== undefined || weapon.isLaser !== undefined
        ? weapon
        : weapon.rules ?? weapon;
    const visuals = rules.aresWeaponVisuals ?? {};
    const boltColors = visuals.boltColors ?? rules.boltColors ?? [];
    return {
        range: rangeValue(rules.range, 0),
        minimumRange: Math.max(0, integer(Number(rules.minimumRange) || 0, 0)),
        rof: supportDelayValue(rules.rof, 0),
        report: Array.isArray(rules.report) ? [...rules.report] : [],
        isLaser: rules.isLaser === true,
        laserDuration: supportDelayValue(rules.laserDuration, 0),
        isHouseColor: rules.isHouseColor === true,
        laserInnerColor: color(rules.laserInnerColor),
        laserOuterColor: color(rules.laserOuterColor),
        laserOuterSpread: finiteNumber(Number(rules.laserOuterSpread), 0),
        laserThickness: rules.laserThickness < 0 ? 3 : Math.max(0, integer(Number(rules.laserThickness), 3)),
        isElectricBolt: rules.isElectricBolt === true,
        isAlternateColor: rules.isAlternateColor === true,
        boltColors: [color(boltColors[0]), color(boltColors[1]), color(boltColors[2])],
        isRadBeam: rules.isRadBeam === true,
        beamDuration: supportDelayValue(visuals.beamDuration ?? rules.beamDuration, 15),
        beamIsHouseColor: (visuals.beamIsHouseColor ?? rules.beamIsHouseColor) === true,
        beamColor: color(visuals.beamColor ?? rules.beamColor),
        beamAmplitude: Math.max(0, finiteNumber(Number(visuals.beamAmplitude ?? rules.beamAmplitude), 40)),
    };
}

export interface PrismNetworkPosition {
    x: number;
    y: number;
    z: number;
}

export interface PrismNetworkTower {
    id: number;
    typeName: string;
    ownerId: number;
    rules: PrismForwardingRules;
    operational: boolean;
    position: PrismNetworkPosition;
    supportRange: number;
    minimumSupportRange: number;
    supportCooldownTicks?: number;
    busy?: boolean;
    supportTargetId?: number;
    fireDelay?: number;
}

export interface PrismNetworkContext {
    areAllied(firstOwnerId: number, secondOwnerId: number): boolean;
    distance(first: PrismNetworkPosition, second: PrismNetworkPosition): number;
}

export interface PrismNetworkNode {
    towerId: number;
    typeName: string;
    ownerId: number;
    depth: number;
    providerIds: number[];
    chargeDelay: number;
    activationDelay: number;
    supportModifier: number;
    damageAdd: number;
    intensity: number;
}

export interface PrismNetworkEdge {
    providerId: number;
    targetId: number;
    depth: number;
    activationDelay: number;
}

export interface PrismNetwork {
    masterId: number;
    nodes: PrismNetworkNode[];
    edges: PrismNetworkEdge[];
    longestChain: number;
    providerCount: number;
}

export interface PrismFireComposition {
    damageMultiplier: number;
    damageBonus: number;
    providerCount: number;
    networkSize: number;
    longestChain: number;
    beamThicknessOffset: number;
}

function defaultDistance(first: PrismNetworkPosition, second: PrismNetworkPosition): number {
    return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function positiveDelay(value: number | undefined): number {
    return Math.max(0, integer(value ?? 0, 0));
}

function intensityOffset(intensity: number, downstreamTowers: number): number {
    if (downstreamTowers <= 0 || intensity === 0) return 0;
    return intensity < 0 ? -intensity : intensity * downstreamTowers;
}

function providerCanFeed(
    provider: PrismNetworkTower,
    target: PrismNetworkTower,
    master: PrismNetworkTower,
    context: PrismNetworkContext,
    distance: number,
): boolean {
    if (!canPrismForward(provider.rules) || !provider.operational) return false;
    if ((provider.supportCooldownTicks ?? 0) > 0 || provider.busy) return false;
    if (provider.supportTargetId !== undefined) return false;
    if (!provider.rules.targets.some(targetName => normalizePrismTypeName(targetName) === normalizePrismTypeName(target.typeName))) {
        return false;
    }
    const sameOwner = provider.ownerId === target.ownerId && provider.ownerId === master.ownerId;
    const allied = provider.rules.toAllies &&
        context.areAllied(provider.ownerId, target.ownerId) &&
        context.areAllied(provider.ownerId, master.ownerId);
    if (!sameOwner && !allied) return false;
    const minimumRange = Math.max(0, finiteNumber(provider.minimumSupportRange, 0));
    if (distance < minimumRange) return false;
    const maximumRange = provider.supportRange === -2
        ? Number.POSITIVE_INFINITY
        : provider.supportRange;
    if (maximumRange !== Number.POSITIVE_INFINITY &&
        (!Number.isFinite(maximumRange) || maximumRange < 0)) return false;
    return maximumRange === Number.POSITIVE_INFINITY || distance <= maximumRange;
}

export function buildPrismSupportNetwork(
    master: PrismNetworkTower,
    candidates: readonly PrismNetworkTower[],
    context: PrismNetworkContext,
): PrismNetwork {
    const empty: PrismNetwork = {
        masterId: master.id,
        nodes: [],
        edges: [],
        longestChain: 0,
        providerCount: 0,
    };
    if (!Number.isSafeInteger(master.id) || !canPrismAttack(master.rules)) return empty;
    const uniqueCandidates = new Map<number, PrismNetworkTower>();
    for (const candidate of [...candidates].sort((first, second) => first.id - second.id)) {
        if (!Number.isSafeInteger(candidate.id) || uniqueCandidates.has(candidate.id)) continue;
        uniqueCandidates.set(candidate.id, candidate);
    }
    uniqueCandidates.set(master.id, master);
    const nodeById = new Map<number, PrismNetworkNode>();
    const assigned = new Set<number>([master.id]);
    const root: PrismNetworkNode = {
        towerId: master.id,
        typeName: master.typeName,
        ownerId: master.ownerId,
        depth: 0,
        providerIds: [],
        chargeDelay: 0,
        activationDelay: 0,
        supportModifier: master.rules.supportModifier,
        damageAdd: master.rules.damageAdd,
        intensity: master.rules.intensity,
    };
    nodeById.set(master.id, root);
    let frontier: PrismNetworkNode[] = [root];
    let networkSize = 0;
    const maximumNetworkSize = master.rules.maxNetworkSize;
    const maximumChainLength = master.rules.maxChainLength;
    const distanceBetween = context.distance ?? defaultDistance;
    while (frontier.length) {
        const nextFrontier: PrismNetworkNode[] = [];
        for (const receiver of frontier) {
            const receiverTower = uniqueCandidates.get(receiver.towerId);
            if (!receiverTower) continue;
            const maximumFeeds = receiverTower.rules.maxFeeds;
            if (maximumFeeds === 0) continue;
            const depth = receiver.depth + 1;
            if (maximumChainLength !== -1 && depth > maximumChainLength) continue;
            if (maximumNetworkSize !== -1 && networkSize >= maximumNetworkSize) continue;
            const eligible = [...uniqueCandidates.values()]
                .filter(provider =>
                    !assigned.has(provider.id) &&
                    providerCanFeed(provider, receiverTower, master, context, distanceBetween(provider.position, receiverTower.position)))
                .sort((first, second) => {
                    const firstDistance = distanceBetween(first.position, receiverTower.position);
                    const secondDistance = distanceBetween(second.position, receiverTower.position);
                    return firstDistance - secondDistance || first.id - second.id;
                });
            let feeds = 0;
            for (const provider of eligible) {
                if (maximumFeeds !== -1 && feeds >= maximumFeeds) break;
                if (maximumNetworkSize !== -1 && networkSize >= maximumNetworkSize) break;
                const node: PrismNetworkNode = {
                    towerId: provider.id,
                    typeName: provider.typeName,
                    ownerId: provider.ownerId,
                    depth,
                    providerIds: [],
                    chargeDelay: 0,
                    activationDelay: 0,
                    supportModifier: provider.rules.supportModifier,
                    damageAdd: provider.rules.damageAdd,
                    intensity: provider.rules.intensity,
                };
                receiver.providerIds.push(provider.id);
                nodeById.set(provider.id, node);
                assigned.add(provider.id);
                nextFrontier.push(node);
                feeds++;
                networkSize++;
            }
        }
        frontier = nextFrontier;
    }
    const towerById = new Map<number, PrismNetworkTower>();
    for (const tower of uniqueCandidates.values()) towerById.set(tower.id, tower);
    const resolveTiming = (node: PrismNetworkNode, visited = new Set<number>()): { charge: number; fire: number } => {
        if (visited.has(node.towerId)) return { charge: 0, fire: 0 };
        const nextVisited = new Set(visited);
        nextVisited.add(node.towerId);
        const ownFireDelay = positiveDelay(towerById.get(node.towerId)?.fireDelay);
        let longestCharge = 0;
        let latestFire = ownFireDelay;
        for (const providerId of node.providerIds) {
            const provider = nodeById.get(providerId);
            if (!provider) continue;
            const timing = resolveTiming(provider, nextVisited);
            longestCharge = Math.max(longestCharge, timing.charge);
            latestFire = Math.max(latestFire, timing.fire);
        }
        node.chargeDelay = node.providerIds.length
            ? towerById.get(node.towerId)!.rules.chargeDelay + longestCharge
            : 0;
        node.activationDelay = Math.max(0, latestFire - ownFireDelay + node.chargeDelay);
        return { charge: node.chargeDelay, fire: latestFire };
    };
    resolveTiming(root);
    const nodes = [...nodeById.values()].sort((first, second) => first.depth - second.depth || first.towerId - second.towerId);
    for (const node of nodes) node.providerIds.sort((first, second) => first - second);
    const edges = nodes
        .filter(node => node.towerId !== master.id)
        .map(node => ({
            providerId: node.towerId,
            targetId: nodes.find(candidate => candidate.providerIds.includes(node.towerId))?.towerId ?? master.id,
            depth: node.depth,
            activationDelay: node.activationDelay,
        }))
        .sort((first, second) => first.depth - second.depth || first.providerId - second.providerId);
    return {
        masterId: master.id,
        nodes,
        edges,
        longestChain: nodes.reduce((longest, node) => Math.max(longest, node.depth), 0),
        providerCount: Math.max(0, nodes.length - 1),
    };
}

export function computePrismFireComposition(network: PrismNetwork): PrismFireComposition {
    const master = network.nodes.find(node => node.towerId === network.masterId);
    const providers = network.nodes.filter(node => node.towerId !== network.masterId);
    const supportModifier = providers.reduce((total, node) => total + node.supportModifier, 0);
    return {
        damageMultiplier: 1 + supportModifier,
        damageBonus: providers.reduce((total, node) => total + node.damageAdd, 0) + (master?.damageAdd ?? 0),
        providerCount: providers.length,
        networkSize: providers.length,
        longestChain: network.longestChain,
        beamThicknessOffset: master
            ? intensityOffset(master.intensity, network.longestChain)
            : 0,
    };
}

export function computePrismNodeThicknessOffset(node: PrismNetworkNode, longestChain: number): number {
    return intensityOffset(node.intensity, longestChain - node.depth);
}

export function composePrismProjectileDamage(
    baseDamage: number,
    damageBonus: number,
    damageMultiplier: number,
): number {
    return (baseDamage + damageBonus) * damageMultiplier;
}
