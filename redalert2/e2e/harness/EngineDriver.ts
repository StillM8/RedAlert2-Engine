import { expect, type Page } from '@playwright/test';
import { OrderType } from '../../src/game/order/OrderType';
import { Diagnostics } from './Diagnostics';
import { AssetProfile } from './AssetProfile';
import {
    expectGameStarted,
    expectImportPrompt,
    expectMainMenu,
    expectSkirmishLobby,
    readEngineState,
    type EngineState,
} from './GameAssertions';

const DEFAULT_TIMEOUT = 180_000;
const BUILDING_OBJECT_TYPE = 2;
const INFANTRY_OBJECT_TYPE = 3;
const VEHICLE_OBJECT_TYPE = 7;
const INFANTRY_FACTORY = 2;
const VEHICLE_FACTORY = 3;
const NAVAL_FACTORY = 4;

export type BuildingRole = 'power' | 'refinery' | 'barracks' | 'war-factory';

export interface ProductionPlan {
    objectName: string;
    objectType: number;
    queueType: number;
    placement: { rx: number; ry: number };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Drives the real menu/import/game path through stable UI and debug seams.
 * The debug seam is used only after normal navigation has reached the screen;
 * it avoids coordinate-dependent canvas clicks for deterministic assertions.
 */
export class EngineDriver {
    private readonly recentActions: Array<Record<string, unknown>> = [];

    constructor(
        readonly page: Page,
        readonly assets: AssetProfile,
        readonly diagnostics: Diagnostics,
    ) {
    }

    private recordAction(action: string, details: Record<string, unknown> = {}): void {
        const entry = {
            at: new Date().toISOString(),
            action,
            ...details,
        };
        this.recentActions.push(entry);
        if (this.recentActions.length > 100) {
            this.recentActions.shift();
        }
        this.diagnostics.recordAction(entry);
    }

    async boot(options: { importAssets?: boolean } = {}): Promise<void> {
        const importAssets = options.importAssets ?? this.assets.isConfigured;
        if (importAssets) {
            this.assets.requireConfigured();
            await this.page.addInitScript({ content: this.assets.createPickerInitScript() });
        }
        const url = `/?test=e2e&content=builtin:${this.assets.game}`;
        this.recordAction('boot', { url, importAssets });
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
        await expect(this.page.locator('#ra2web-root')).toBeAttached({ timeout: 30_000 });
        await this.page.waitForFunction(() => Boolean(
            (window as any).__ra2debug?.mainMenuController || document.querySelector('.game-res-box'),
        ), undefined, { timeout: DEFAULT_TIMEOUT });
        if (importAssets) {
            await expectImportPrompt(this.page);
            await this.page.locator('.game-res-box .browse-buttons button').first().click();
            await this.waitForMainMenu();
        }
    }

    async waitForMainMenu(): Promise<void> {
        await expectMainMenu(this.page);
    }

    async clickSidebarButton(label: string): Promise<void> {
        this.recordAction('click-sidebar', { label });
        const button = this.page.locator('.menu-button').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`) }).first();
        await expect(button, `sidebar button "${label}"`).toBeVisible({ timeout: 30_000 });
        await button.click();
    }

    async openSkirmish(): Promise<void> {
        await this.clickSidebarButton('Skirmish');
        await expectSkirmishLobby(this.page);
    }

    async chooseMap(options: { mapName?: string; minSlots?: number } = {}): Promise<void> {
        const mapTitle = await this.page.evaluate(({ mapName, minSlots }) => {
            const candidates = ((window as any).__ra2debug?.skirmishLobby?.maps ?? [])
                .filter((map: any) => !minSlots || Number(map.maxSlots) >= minSlots)
                .filter((map: any) => !mapName || map.mapName === mapName)
                .sort((left: any, right: any) => Number(right.maxSlots) - Number(left.maxSlots));
            return candidates[0]?.mapTitle as string | undefined;
        }, options);
        await this.clickSidebarButton('Choose Map');
        await expect(this.page.locator('.map-sel-form')).toBeVisible({ timeout: 60_000 });
        const maps = this.page.locator('.map-list .list-item');
        const map = mapTitle
            ? maps.filter({ hasText: mapTitle }).first()
            : options.mapName
                ? maps.filter({ hasText: options.mapName }).first()
                : maps.first();
        await expect(map, options.mapName ? `map "${options.mapName}"` : 'at least one map').toBeVisible({ timeout: 60_000 });
        await map.click();
        await this.clickSidebarButton('Use Map');
        await expectSkirmishLobby(this.page);
    }

    async configureAiCount(count: number): Promise<void> {
        this.recordAction('configure-ai-count', { count });
        await this.page.evaluate((requestedCount) => {
            const configureAiCount = (window as any).__ra2debug?.skirmishLobby?.configureAiCount;
            if (typeof configureAiCount !== 'function') {
                throw new Error('Skirmish debug bridge does not expose configureAiCount');
            }
            configureAiCount(requestedCount);
        }, count);
    }

    async startSkirmish(): Promise<EngineState> {
        this.recordAction('start-skirmish');
        await this.page.evaluate(() => {
            const startGame = (window as any).__ra2debug?.skirmishLobby?.startGame;
            if (typeof startGame !== 'function') {
                throw new Error('Skirmish debug bridge is not available');
            }
            startGame();
        });
        return expectGameStarted(this.page);
    }

    async readState(): Promise<EngineState | undefined> {
        return readEngineState(this.page);
    }

    async waitForTick(minimumTick: number, timeout = DEFAULT_TIMEOUT): Promise<EngineState> {
        await this.page.waitForFunction((tick) => Number((window as any).__ra2debug?.game?.currentTick ?? -1) >= tick, minimumTick, { timeout });
        return (await this.readState())!;
    }

    async advanceTicks(count: number): Promise<EngineState> {
        if (!Number.isSafeInteger(count) || count < 1) {
            throw new Error(`advanceTicks count must be a positive safe integer, got ${count}`);
        }
        this.recordAction('advance-ticks', { count });
        await this.page.evaluate((requestedCount) => {
            const advanceTicks = (window as any).__ra2debug?.advanceTicks;
            if (typeof advanceTicks !== 'function') {
                throw new Error('Game debug bridge does not expose advanceTicks');
            }
            advanceTicks(requestedCount);
        }, count);
        return (await this.readState())!;
    }

    async placeBuilding(buildingName: string, x: number, y: number): Promise<void> {
        this.recordAction('place-building', { buildingName, x, y });
        await this.callActionsApi('placeBuilding', [buildingName, x, y]);
    }

    async queueForProduction(queueType: number, objectType: number, objectName: string, quantity = 1): Promise<void> {
        this.recordAction('queue-production', { queueType, objectType, objectName, quantity });
        await this.callActionsApi('queueForProduction', [queueType, objectType, objectName, quantity]);
    }

    /** Finds a rules-driven building and queues it through the normal action path. */
    async queueBuilding(role: BuildingRole): Promise<ProductionPlan> {
        this.recordAction('queue-building', { role });
        return this.page.evaluate(({ role, buildingObjectType, infantryFactory, vehicleFactory, navalFactory }) => {
            const debugRoot = (window as any).__ra2debug;
            const game = debugRoot?.game;
            const player = debugRoot?.localPlayer;
            const actionsApi = debugRoot?.actionsApi;
            const production = player?.production;
            if (!game || !player || !actionsApi || !production) {
                throw new Error('Production bridge is not available');
            }
            const matchesRole = (rules: any): boolean => {
                switch (role) {
                    case 'power':
                        return Number(rules?.power) > 0 && !rules?.constructionYard && !rules?.refinery && !rules?.factory;
                    case 'refinery':
                        return Boolean(rules?.refinery);
                    case 'barracks':
                        return Number(rules?.factory) === infantryFactory;
                    case 'war-factory':
                        return Number(rules?.factory) === vehicleFactory || Number(rules?.factory) === navalFactory;
                }
            };
            const building = production.getAvailableObjects()
                .filter((object: any) => object?.type === buildingObjectType && matchesRole(object))
                .sort((left: any, right: any) => String(left.name).localeCompare(String(right.name)))[0];
            if (!building) {
                throw new Error(`No available ${role} building; available buildings were: ${production.getAvailableObjects()
                    .filter((object: any) => object?.type === buildingObjectType)
                    .map((object: any) => object.name)
                    .join(', ')}`);
            }
            const worker = game.getConstructionWorker(player);
            const anchors = player.getOwnedObjects(true)
                .filter((object: any) => object?.isBuilding?.() && object.tile)
                .map((object: any) => object.tile);
            const tiles = game.map.tiles.getAll();
            const distanceToAnchor = (tile: any): number => anchors.length
                ? Math.min(...anchors.map((anchor: any) => Math.abs(anchor.rx - tile.rx) + Math.abs(anchor.ry - tile.ry)))
                : 0;
            const placement = tiles
                .slice()
                .sort((left: any, right: any) => distanceToAnchor(left) - distanceToAnchor(right))
                .find((tile: any) => worker.canPlaceAt(building.name, tile, { normalizedTile: true }));
            if (!placement) {
                throw new Error(`No legal placement tile found for ${building.name}`);
            }
            const queueType = production.getQueueTypeForObject(building);
            actionsApi.queueForProduction(queueType, buildingObjectType, building.name, 1);
            return {
                objectName: building.name,
                objectType: buildingObjectType,
                queueType,
                placement: { rx: placement.rx, ry: placement.ry },
            } satisfies ProductionPlan;
        }, {
            role,
            buildingObjectType: BUILDING_OBJECT_TYPE,
            infantryFactory: INFANTRY_FACTORY,
            vehicleFactory: VEHICLE_FACTORY,
            navalFactory: NAVAL_FACTORY,
        });
    }

    async queueCombatUnit(kind: 'infantry' | 'vehicle'): Promise<{ objectName: string; objectType: number; queueType: number }> {
        this.recordAction('queue-combat-unit', { kind });
        return this.page.evaluate(({ kind, infantryObjectType, vehicleObjectType }) => {
            const debugRoot = (window as any).__ra2debug;
            const player = debugRoot?.localPlayer;
            const actionsApi = debugRoot?.actionsApi;
            const production = player?.production;
            if (!player || !actionsApi || !production) {
                throw new Error('Production bridge is not available');
            }
            const objectType = kind === 'infantry' ? infantryObjectType : vehicleObjectType;
            const object = production.getAvailableObjects()
                .filter((candidate: any) => candidate?.type === objectType)
                .filter((candidate: any) => !candidate?.harvester && !candidate?.deploysInto && !candidate?.engineer)
                .sort((left: any, right: any) => String(left.name).localeCompare(String(right.name)))[0];
            if (!object) {
                throw new Error(`No available ${kind} combat unit`);
            }
            const queueType = production.getQueueTypeForObject(object);
            actionsApi.queueForProduction(queueType, objectType, object.name, 1);
            return { objectName: object.name, objectType, queueType };
        }, {
            kind,
            infantryObjectType: INFANTRY_OBJECT_TYPE,
            vehicleObjectType: VEHICLE_OBJECT_TYPE,
        });
    }

    async placeQueuedBuilding(plan: ProductionPlan): Promise<void> {
        this.recordAction('place-queued-building', { ...plan });
        await this.placeBuilding(plan.objectName, plan.placement.rx, plan.placement.ry);
    }

    async waitForProductionReady(plan: Pick<ProductionPlan, 'objectName' | 'queueType'>, maxTicks = 12_000): Promise<void> {
        for (let elapsed = 0; elapsed <= maxTicks; elapsed += 300) {
            const ready = await this.page.evaluate(({ queueType, objectName }) => {
                const queue = (window as any).__ra2debug?.localPlayer?.production?.getQueue?.(queueType);
                return queue?.status === 3 && queue?.getFirst?.()?.rules?.name === objectName;
            }, plan);
            if (ready) {
                return;
            }
            if (elapsed < maxTicks) {
                await this.advanceTicks(Math.min(300, maxTicks - elapsed));
            }
        }
        throw new Error(`Production queue ${plan.queueType} did not become ready for ${plan.objectName} after ${maxTicks} simulation ticks`);
    }

    async waitForOwnedObject(name: string, maxTicks = 12_000): Promise<Record<string, unknown>> {
        for (let elapsed = 0; elapsed <= maxTicks; elapsed += 300) {
            const owned = await this.getOwnedObjects();
            const object = owned.find((candidate) => candidate.name === name && candidate.isSpawned);
            if (object) {
                return object;
            }
            if (elapsed < maxTicks) {
                await this.advanceTicks(Math.min(300, maxTicks - elapsed));
            }
        }
        throw new Error(`Object "${name}" was not owned after ${maxTicks} simulation ticks`);
    }

    async readEconomy(): Promise<{ credits: number; objects: Array<Record<string, unknown>> }> {
        return this.page.evaluate(() => {
            const debugRoot = (window as any).__ra2debug;
            return {
                credits: Number(debugRoot?.localPlayer?.credits ?? NaN),
                objects: (debugRoot?.localPlayer?.getOwnedObjects?.() ?? []).map((object: any) => ({
                    id: object.id,
                    name: object.name,
                    isBuilding: Boolean(object.isBuilding?.()),
                    isUnit: Boolean(object.isUnit?.()),
                    isHarvester: Boolean(object.harvesterTrait || object.rules?.harvester),
                    health: object.healthTrait?.health,
                })),
            };
        });
    }

    async attackNearestEnemy(): Promise<{ attackerId: number; targetId: number; targetHealth: number }> {
        this.recordAction('attack-nearest-enemy');
        return this.page.evaluate(() => {
            const debugRoot = (window as any).__ra2debug;
            const game = debugRoot?.game;
            const localPlayer = debugRoot?.localPlayer;
            const actionsApi = debugRoot?.actionsApi;
            const enemy = game?.playerList?.getCombatants?.().find((player: any) => player !== localPlayer && !player.isObserver);
            const target = enemy?.getOwnedObjects?.(true).find((object: any) => object?.isTechno?.() && object?.isSpawned && object?.healthTrait);
            const attacker = localPlayer?.getOwnedObjects?.(true).find((object: any) => object?.isUnit?.() && !object?.rules?.harvester && !object?.rules?.deploysInto && object?.attackTrait);
            if (!enemy || !target || !attacker || !actionsApi) {
                throw new Error('Could not find an owned attacker and enemy target for combat qualification');
            }
            actionsApi.orderUnits([attacker.id], 2, target.id);
            return {
                attackerId: attacker.id,
                targetId: target.id,
                targetHealth: target.healthTrait.getHitPoints?.() ?? target.healthTrait.health,
            };
        });
    }

    async waitForDamage(targetId: number, initialHealth: number, maxTicks = 12_000): Promise<number> {
        for (let elapsed = 0; elapsed <= maxTicks; elapsed += 300) {
            const health = await this.page.evaluate((id) => {
                const object = (window as any).__ra2debug?.game?.getObjectById?.(id);
                return object?.healthTrait?.getHitPoints?.() ?? object?.healthTrait?.health ?? 0;
            }, targetId);
            if (health < initialHealth) {
                return health;
            }
            if (elapsed < maxTicks) {
                await this.advanceTicks(Math.min(300, maxTicks - elapsed));
            }
        }
        throw new Error(`Target ${targetId} did not take damage after ${maxTicks} simulation ticks`);
    }

    async waitForDestroyed(targetId: number, maxTicks = 24_000): Promise<void> {
        for (let elapsed = 0; elapsed <= maxTicks; elapsed += 300) {
            const alive = await this.page.evaluate((id) => {
                const object = (window as any).__ra2debug?.game?.getObjectById?.(id);
                if (!object || object.isSpawned === false) {
                    return false;
                }
                const health = object.healthTrait?.getHitPoints?.() ?? object.healthTrait?.health;
                return typeof health !== 'number' || health > 0;
            }, targetId);
            if (!alive) {
                return;
            }
            if (elapsed < maxTicks) {
                await this.advanceTicks(Math.min(300, maxTicks - elapsed));
            }
        }
        throw new Error(`Target ${targetId} was not destroyed after ${maxTicks} simulation ticks`);
    }

    async waitForGameEnd(maxTicks = 60_000): Promise<EngineState> {
        for (let elapsed = 0; elapsed <= maxTicks; elapsed += 600) {
            const state = (await this.readState())!;
            if (state.status === 2) {
                return state;
            }
            if (elapsed < maxTicks) {
                await this.advanceTicks(Math.min(600, maxTicks - elapsed));
            }
        }
        throw new Error(`Game did not reach Ended after ${maxTicks} simulation ticks`);
    }

    async waitForScoreScreen(timeout = 30_000): Promise<void> {
        await expect(this.page.locator('.score-wrapper')).toBeVisible({ timeout });
    }

    async orderUnits(unitIds: number[], orderType: OrderType, targetX?: number, targetY?: number): Promise<void> {
        this.recordAction('order-units', { unitIds, orderType, targetX, targetY });
        await this.callActionsApi('orderUnits', [unitIds, orderType, targetX, targetY]);
    }

    async selectFirstDeployableUnit(): Promise<{ id: number; name: string }> {
        this.recordAction('select-deployable-unit');
        return this.page.evaluate(() => {
            const debugRoot = (window as any).__ra2debug;
            const localPlayer = debugRoot?.localPlayer;
            const unitSelection = debugRoot?.unitSelection;
            const actionsApi = debugRoot?.actionsApi;
            const unit = localPlayer?.getOwnedObjects?.().find((object: any) => object?.isUnit?.() && object?.rules?.deploysInto);
            if (!unit || !unitSelection || !actionsApi) {
                throw new Error('No deployable owned unit or game action bridge is available');
            }
            unitSelection.deselectAll();
            unitSelection.addToSelection(unit);
            actionsApi.orderUnits([unit.id], 10);
            return { id: unit.id, name: unit.name };
        });
    }

    async getOwnedObjects(): Promise<Array<Record<string, unknown>>> {
        return this.page.evaluate(() => {
            const localPlayer = (window as any).__ra2debug?.localPlayer;
            return (localPlayer?.getOwnedObjects?.() ?? []).map((object: any) => ({
                id: object.id,
                name: object.name,
                type: object.type,
                isBuilding: Boolean(object.isBuilding?.()),
                isUnit: Boolean(object.isUnit?.()),
                isSpawned: Boolean(object.isSpawned),
                tile: object.tile ? { rx: object.tile.rx, ry: object.tile.ry, z: object.tile.z } : undefined,
            }));
        });
    }

    async callActionsApi(method: string, args: unknown[] = []): Promise<void> {
        await this.page.evaluate(({ method, args }) => {
            const action = (window as any).__ra2debug?.actionsApi?.[method];
            if (typeof action !== 'function') {
                throw new Error(`Actions API method "${method}" is not available`);
            }
            action(...args);
        }, { method, args });
    }

    async quitGame(): Promise<void> {
        this.recordAction('quit-game');
        await this.callActionsApi('quitGame');
    }

    getRecentActions(): Array<Record<string, unknown>> {
        return [...this.recentActions];
    }
}
