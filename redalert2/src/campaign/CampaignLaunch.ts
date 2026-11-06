import { Engine } from "@/engine/Engine";
import type { GameOpts } from "@/game/gameopts/GameOpts";
import { CampaignCatalogService } from "./CampaignService";
import {
    CAMPAIGN_LAUNCH_KIND,
    type CampaignCatalog,
    type CampaignDefinition,
    type CampaignLaunch,
    type CampaignLaunchPresentation,
    type CampaignMissionIdentity,
} from "./CampaignTypes";

export interface CampaignLaunchScreenOptions {
    gameId?: string;
    timestamp?: number;
    playerName?: string;
    returnTo?: unknown;
    gameOptions?: Partial<GameOpts>;
}

export interface CampaignGameScreenParams {
    kind: typeof CAMPAIGN_LAUNCH_KIND;
    campaignLaunch: CampaignLaunch;
    create: true;
    singlePlayer: true;
    gameId: string;
    timestamp: number;
    playerName: string;
    gameOpts: Partial<GameOpts>;
    mapTransfer: false;
    tournament: false;
    gservUrl: string;
    returnTo?: unknown;
}

export interface CampaignResultLike {
    victory?: boolean;
    scripted?: boolean;
    outcome?: string;
    nextScenario?: unknown;
    altNextScenario?: unknown;
    alternateNextScenario?: unknown;
    endOfGame?: unknown;
    skipScore?: unknown;
}

export interface NextCampaignLaunchOptions {
    catalog?: CampaignCatalog;
    loadCatalog?: () => CampaignCatalog | undefined | Promise<CampaignCatalog | undefined>;
    nextScenario?: unknown;
    altNextScenario?: unknown;
    endOfGame?: unknown;
    nextMission?: CampaignMissionIdentity;
    result?: CampaignResultLike;
    campaignState?: any;
    campaignSession?: any;
}

export function isCampaignLaunch(value: unknown): value is CampaignLaunch {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Partial<CampaignLaunch>;
    return candidate.kind === CAMPAIGN_LAUNCH_KIND &&
        candidate.version === 1 &&
        typeof candidate.battleId === "string" &&
        typeof candidate.mapFile === "string" &&
        typeof candidate.battleFile === "string";
}

export function getCampaignLaunch(params: unknown): CampaignLaunch | undefined {
    if (isCampaignLaunch(params)) {
        return params;
    }
    if (!params || typeof params !== "object") {
        return undefined;
    }
    const container = params as { campaignLaunch?: unknown; campaign?: unknown };
    if (isCampaignLaunch(container.campaignLaunch)) {
        return container.campaignLaunch;
    }
    return isCampaignLaunch(container.campaign) ? container.campaign : undefined;
}

function defaultGameOptions(launch: CampaignLaunch): Partial<GameOpts> {
    return {
        gameMode: 0,
        gameSpeed: 6,
        credits: 0,
        unitCount: 0,
        shortGame: false,
        superWeapons: true,
        buildOffAlly: launch.buildOffAlly,
        mcvRepacks: false,
        cratesAppear: true,
        hostTeams: false,
        destroyableBridges: false,
        multiEngineer: false,
        noDogEngiKills: false,
        mapName: launch.mapFile,
        mapTitle: launch.presentation.title,
        mapDigest: "",
        mapSizeBytes: 0,
        maxSlots: 8,
        mapOfficial: false,
        humanPlayers: [
            {
                name: "Player 1",
                countryId: -2,
                colorId: -2,
                startPos: -2,
                teamId: -2,
            },
        ],
        aiPlayers: new Array(8).fill(undefined),
    };
}

export function campaignLaunchToGameOptions(
    launch: CampaignLaunch,
    overrides: Partial<GameOpts> = {},
): Partial<GameOpts> {
    return {
        ...defaultGameOptions(launch),
        ...overrides,
        mapName: overrides.mapName ?? launch.mapFile,
        mapTitle: overrides.mapTitle ?? launch.presentation.title,
        buildOffAlly: overrides.buildOffAlly ?? launch.buildOffAlly,
        isCampaign: true,
        campaign: launch,
    };
}

export function campaignLaunchToGameScreenParams(
    launch: CampaignLaunch,
    options: CampaignLaunchScreenOptions = {},
): CampaignGameScreenParams {
    const playerName = options.playerName ?? "Player 1";
    return {
        kind: CAMPAIGN_LAUNCH_KIND,
        campaignLaunch: launch,
        create: true,
        singlePlayer: true,
        gameId: options.gameId ?? `campaign:${launch.battleId}`,
        timestamp: options.timestamp ?? Date.now(),
        playerName,
        gameOpts: campaignLaunchToGameOptions(launch, {
            ...options.gameOptions,
            humanPlayers: options.gameOptions?.humanPlayers ?? [
                {
                    name: playerName,
                    countryId: -2,
                    colorId: -2,
                    startPos: -2,
                    teamId: -2,
                },
            ],
        }),
        mapTransfer: false,
        tournament: false,
        gservUrl: "",
        returnTo: options.returnTo,
    };
}

export function applyCampaignLaunchToParams(params: any): any {
    const launch = getCampaignLaunch(params);
    if (!launch) {
        return params;
    }
    const normalized = campaignLaunchToGameScreenParams(launch, {
        gameId: params?.gameId,
        timestamp: params?.timestamp,
        playerName: params?.playerName,
        returnTo: params?.returnTo,
        gameOptions: params?.gameOpts,
    });
    return {
        ...params,
        ...normalized,
        campaignLaunch: launch,
    };
}

export function campaignLaunchPresentation(launch: CampaignLaunch): CampaignLaunchPresentation {
    return { ...launch.presentation };
}

function scenarioValue(value: unknown): string | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? String(value) : undefined;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim().replace(/\\/g, "/");
    if (!normalized || ["none", "no", "null"].includes(normalized.toLocaleLowerCase("en-US"))) {
        return undefined;
    }
    return normalized;
}

function scenarioKeys(value: unknown): string[] {
    const scenario = scenarioValue(value);
    if (!scenario) {
        return [];
    }
    const normalized = scenario.replace(/^\.\//, "");
    const leaf = normalized.split("/").pop() ?? normalized;
    const stem = leaf.replace(/\.[^.]+$/, "");
    return [...new Set([normalized, leaf, stem]
        .filter(Boolean)
        .map((entry) => entry.toLocaleLowerCase("en-US")))];
}

function sameScenario(left: unknown, right: unknown): boolean {
    const leftKeys = scenarioKeys(left);
    const rightKeys = scenarioKeys(right);
    return leftKeys.length > 0 && rightKeys.length > 0 && leftKeys.some((key) => rightKeys.includes(key));
}

function sameText(left: unknown, right: unknown): boolean {
    if (left === undefined || right === undefined || left === null || right === null) {
        return false;
    }
    return String(left).trim().replace(/\\/g, "/").toLocaleLowerCase("en-US") ===
        String(right).trim().replace(/\\/g, "/").toLocaleLowerCase("en-US");
}

function firstScenario(...values: unknown[]): string | undefined {
    for (const value of values) {
        const scenario = scenarioValue(value);
        if (scenario) {
            return scenario;
        }
    }
    return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value !== 0;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLocaleLowerCase("en-US");
        if (["yes", "y", "true", "1", "on"].includes(normalized)) {
            return true;
        }
        if (["no", "n", "false", "0", "off"].includes(normalized)) {
            return false;
        }
    }
    return undefined;
}

function firstBoolean(...values: unknown[]): boolean | undefined {
    for (const value of values) {
        const result = booleanValue(value);
        if (result !== undefined) {
            return result;
        }
    }
    return undefined;
}

function identityScenario(identity: CampaignMissionIdentity | undefined): string | undefined {
    return firstScenario(identity?.scenario, identity?.mapFile);
}

function definitionScenario(definition: CampaignDefinition): string | undefined {
    return firstScenario(definition.scenario, definition.mapFile);
}

function definitionNextScenario(definition: CampaignDefinition): string | undefined {
    return firstScenario(definition.nextScenario, definition.nextMission?.scenario, definition.nextMission?.mapFile);
}

function definitionAlternateScenario(definition: CampaignDefinition): string | undefined {
    return firstScenario(definition.altNextScenario, definition.nextMission?.altNextScenario);
}

function definitionMatches(
    definition: CampaignDefinition,
    desiredScenario: string | undefined,
    identity: CampaignMissionIdentity | undefined,
): number {
    if (!desiredScenario && !identity) {
        return -1;
    }
    let score = 0;
    let matched = false;
    const currentScenario = definitionScenario(definition);
    const nextScenario = definitionNextScenario(definition);
    const alternateScenario = definitionAlternateScenario(definition);
    if (desiredScenario && (sameScenario(desiredScenario, currentScenario) ||
        sameText(desiredScenario, definition.id) ||
        sameText(desiredScenario, definition.nextMission?.section))) {
        score += 300;
        matched = true;
    }
    if (desiredScenario && nextScenario && sameScenario(desiredScenario, nextScenario)) {
        score += 100;
        matched = true;
    }
    if (desiredScenario && alternateScenario && sameScenario(desiredScenario, alternateScenario)) {
        score += 90;
        matched = true;
    }
    if (identity) {
        const identityScenarioValue = identityScenario(identity);
        if (identityScenarioValue && sameScenario(identityScenarioValue, currentScenario)) {
            score += 30;
            matched = true;
        }
        if (identityScenarioValue && nextScenario && sameScenario(identityScenarioValue, nextScenario)) {
            score += 40;
            matched = true;
        }
        if (identityScenarioValue && alternateScenario && sameScenario(identityScenarioValue, alternateScenario)) {
            score += 35;
            matched = true;
        }
        if (sameText(identity.battleId, definition.battleId) || sameText(identity.battleId, definition.id)) {
            score += 20;
            matched = true;
        }
        if (sameText(identity.section, definition.id)) {
            score += 220;
            matched = true;
        }
        else if (sameText(identity.section, definition.nextMission?.section)) {
            score += 160;
            matched = true;
        }
        if (identity.index !== undefined && identity.index === definition.nextMission?.index) {
            score += 100;
            matched = true;
        }
        if (sameText(identity.sourceFile, definition.sourceFile) ||
            sameText(identity.sourceFile, definition.battleFile) ||
            sameText(identity.sourceFile, definition.nextMission?.sourceFile)) {
            score += 80;
            matched = true;
        }
        if (identity.side !== undefined && sameText(identity.side, definition.side)) {
            score += 40;
        }
        if (identity.sideName !== undefined && sameText(identity.sideName, definition.sideName)) {
            score += 40;
        }
    }
    return matched ? score : -1;
}

function hasCatalogDefinitions(catalog: CampaignCatalog): boolean {
    try {
        return Array.isArray(catalog.campaigns) || Array.isArray(catalog.allCampaigns);
    }
    catch {
        return false;
    }
}

function catalogDefinitions(catalog: CampaignCatalog): CampaignDefinition[] {
    const result: CampaignDefinition[] = [];
    const seen = new Set<CampaignDefinition>();
    for (const definition of [...(catalog.campaigns ?? []), ...(catalog.allCampaigns ?? [])]) {
        if (definition && !seen.has(definition)) {
            seen.add(definition);
            result.push(definition);
        }
    }
    return result;
}

function findNextDefinition(
    catalog: CampaignCatalog,
    desiredScenario: string | undefined,
    identity: CampaignMissionIdentity | undefined,
): CampaignDefinition | undefined {
    let best: CampaignDefinition | undefined;
    let bestScore = -1;
    for (const definition of catalogDefinitions(catalog)) {
        const score = definitionMatches(definition, desiredScenario, identity);
        if (score > bestScore) {
            best = definition;
            bestScore = score;
        }
    }
    return bestScore > 0 ? best : undefined;
}

function alternateRequested(
    launch: CampaignLaunch,
    options: NextCampaignLaunchOptions,
    alternateScenario: string | undefined,
): boolean {
    const result = options.result;
    const state = options.campaignState;
    const session = options.campaignSession;
    const explicit = firstBoolean(
        result?.alternateNextScenario,
        state?.alternateNextScenario,
        session?.alternateNextScenario,
        launch.alternateNextScenario,
    );
    if (explicit !== undefined) {
        return explicit;
    }
    const selected = firstScenario(options.nextScenario, result?.nextScenario, state?.nextScenario);
    if (selected && alternateScenario && sameScenario(selected, alternateScenario)) {
        return true;
    }
    const global = firstBoolean(
        state?.globalVariables?.["1"],
        session?.globalVariables?.["1"],
    );
    if (global !== undefined) {
        return global;
    }
    return false;
}

function scenarioForIdentity(
    definition: CampaignDefinition,
    identity: CampaignMissionIdentity | undefined,
): string | undefined {
    if (!identity) {
        return definitionScenario(definition);
    }
    if (sameText(identity.section, definition.id)) {
        return definitionScenario(definition);
    }
    if (sameText(identity.section, definition.nextMission?.section) ||
        (identity.index !== undefined && identity.index === definition.nextMission?.index)) {
        return identityScenario(definition.nextMission) ?? definitionNextScenario(definition);
    }
    if (sameText(identity.battleId, definition.battleId) || sameText(identity.battleId, definition.id)) {
        return definitionNextScenario(definition) ?? definitionScenario(definition);
    }
    return identityScenario(identity) ?? definitionScenario(definition);
}

function cloneLaunchForMission(
    launch: CampaignLaunch,
    definition: CampaignDefinition,
    scenario: string,
    alternate: boolean,
    session?: any,
): CampaignLaunch {
    const targetIsCampaignStart = sameScenario(scenario, definitionScenario(definition));
    const nextScenario = targetIsCampaignStart
        ? definitionNextScenario(definition)
        : undefined;
    const altNextScenario = targetIsCampaignStart
        ? definitionAlternateScenario(definition)
        : undefined;
    const nextMission = targetIsCampaignStart && definition.nextMission
        ? { ...definition.nextMission }
        : undefined;
    const presentation = targetIsCampaignStart
        ? { ...definition.presentation }
        : { ...launch.presentation };
    const side = launch.side ?? session?.side ?? definition.side;
    const sideName = launch.sideName ?? session?.sideName ?? definition.sideName;
    const difficulty = launch.difficulty ?? session?.difficulty;
    const buildOffAlly = launch.buildOffAlly ?? session?.buildOffAlly ?? definition.buildOffAlly;
    const campaign = targetIsCampaignStart
        ? definition
        : {
            ...definition,
            scenario,
            mapFile: scenario,
            nextScenario,
            altNextScenario,
            nextMission,
            presentation: {
                ...definition.presentation,
                sideName,
            },
        };
    return {
        ...launch,
        battleId: definition.battleId ?? launch.battleId,
        battleFile: definition.battleFile ?? launch.battleFile,
        mapFile: scenario,
        scenario,
        side,
        sideName,
        difficulty,
        buildOffAlly,
        cd: definition.cd ?? launch.cd,
        act: definition.act ?? launch.act,
        finalMovie: definition.finalMovie ?? launch.finalMovie,
        nextScenario,
        altNextScenario,
        nextMission,
        alternateNextScenario: alternate ? true : undefined,
        presentation: {
            ...presentation,
            sideName,
        },
        campaign,
    };
}

export async function loadActiveCampaignCatalog(): Promise<CampaignCatalog | undefined> {
    try {
        const profile = Engine.getActiveProfile?.();
        const profileId = typeof profile === "string" ? profile : profile?.id;
        return await new CampaignCatalogService(Engine.vfs, profileId ?? "ra2").loadAsync();
    }
    catch {
        return undefined;
    }
}

export function resolveNextCampaignLaunch(
    launch: CampaignLaunch,
    catalog: CampaignCatalog,
    options: NextCampaignLaunchOptions = {},
): CampaignLaunch | undefined {
    if (!launch || !catalog || !hasCatalogDefinitions(catalog)) {
        return undefined;
    }
    const result = options.result;
    const state = options.campaignState;
    const session = options.campaignSession;
    const endOfGame = firstBoolean(
        options.endOfGame,
        result?.endOfGame,
        state?.endOfGame,
        session?.endOfGame,
    );
    if (endOfGame) {
        return undefined;
    }
    const alternateScenario = firstScenario(
        options.altNextScenario,
        result?.altNextScenario,
        state?.altNextScenario,
        launch.altNextScenario,
        options.nextMission?.altNextScenario,
        launch.nextMission?.altNextScenario,
    );
    const alternate = alternateRequested(launch, options, alternateScenario);
    const explicitScenario = firstScenario(options.nextScenario, result?.nextScenario);
    const preferAlternate = Boolean(
        alternate &&
        alternateScenario &&
        (!explicitScenario || sameScenario(explicitScenario, launch.nextScenario) || sameScenario(explicitScenario, state?.nextScenario)),
    );
    const selectedScenario = firstScenario(
        preferAlternate ? alternateScenario : undefined,
        explicitScenario,
        state?.nextScenario,
        launch.nextScenario,
        !launch.nextScenario ? alternateScenario : undefined,
        options.nextMission?.scenario,
        options.nextMission?.mapFile,
        launch.nextMission?.scenario,
        launch.nextMission?.mapFile,
    );
    const identity = options.nextMission ?? launch.nextMission;
    if (!selectedScenario && !identity) {
        return undefined;
    }
    const definition = findNextDefinition(catalog, selectedScenario, identity);
    if (!definition) {
        return undefined;
    }
    const scenario = selectedScenario ?? scenarioForIdentity(definition, identity);
    if (!scenario) {
        return undefined;
    }
    return cloneLaunchForMission(launch, definition, scenario, alternate, session);
}

export async function loadNextCampaignLaunch(
    launch: CampaignLaunch,
    options: NextCampaignLaunchOptions = {},
): Promise<CampaignLaunch | undefined> {
    if (firstBoolean(
        options.endOfGame,
        options.result?.endOfGame,
        options.campaignState?.endOfGame,
        options.campaignSession?.endOfGame,
    )) {
        return undefined;
    }
    let catalog = options.catalog;
    if (!catalog) {
        const loader = options.loadCatalog ?? loadActiveCampaignCatalog;
        try {
            catalog = await loader();
        }
        catch {
            return undefined;
        }
    }
    return catalog ? resolveNextCampaignLaunch(launch, catalog, options) : undefined;
}

export const createNextCampaignLaunch = resolveNextCampaignLaunch;
