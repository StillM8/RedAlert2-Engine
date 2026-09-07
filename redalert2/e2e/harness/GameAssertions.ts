import { expect, type Page } from '@playwright/test';

export interface EngineState {
    status?: number;
    currentTick?: number;
    hash?: number | string;
    nextObjectId?: number;
    objectCount?: number;
    objectIds?: number[];
    players?: Array<{
        name?: string;
        defeated?: boolean;
        isAi?: boolean;
        credits?: number;
    }>;
}

export async function readEngineState(page: Page): Promise<EngineState | undefined> {
    return page.evaluate(() => {
        const game = (window as any).__ra2debug?.game;
        if (!game) {
            return undefined;
        }
        let state: any;
        try {
            state = game.debugGetState?.();
        }
        catch {
            state = undefined;
        }
        return {
            status: game.status,
            currentTick: game.currentTick,
            hash: (() => {
                try {
                    return game.getHash?.();
                }
                catch {
                    return undefined;
                }
            })(),
            nextObjectId: game.nextObjectId?.value,
            objectCount: Array.isArray(state?.objects) ? state.objects.length : undefined,
            objectIds: Array.isArray(state?.objects)
                ? state.objects.map((object: any) => object?.id).filter((id: unknown) => Number.isSafeInteger(id))
                : undefined,
            players: Array.isArray(state?.players)
                ? state.players.map((player: any) => ({
                    name: player?.name,
                    defeated: player?.defeated,
                    isAi: player?.isAi,
                    credits: player?.credits,
                }))
                : undefined,
        } satisfies EngineState;
    });
}

export async function expectImportPrompt(page: Page): Promise<void> {
    await expect(page.locator('.game-res-box')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.game-res-box .browse-buttons button').first()).toBeVisible();
}

export async function expectMainMenu(page: Page): Promise<void> {
    await page.waitForFunction(() => Boolean((window as any).__ra2debug?.mainMenuController), undefined, {
        timeout: 180_000,
    });
    await expect(page.locator('.menu-button').first()).toBeVisible({ timeout: 30_000 });
}

export async function expectSkirmishLobby(page: Page): Promise<void> {
    await page.waitForFunction(() => Boolean((window as any).__ra2debug?.skirmishLobby), undefined, {
        timeout: 60_000,
    });
    await expect(page.locator('.menu-button').filter({ hasText: 'Start Game' }).first()).toBeVisible({ timeout: 30_000 });
}

export async function expectGameStarted(page: Page): Promise<EngineState> {
    await page.waitForFunction(() => {
        const debugRoot = (window as any).__ra2debug;
        return Boolean(debugRoot?.gameScreen && debugRoot.game && debugRoot.game.status === 1);
    }, undefined, { timeout: 240_000 });
    const state = await readEngineState(page);
    expect(state?.status).toBe(1);
    expect(state?.currentTick).toBeGreaterThanOrEqual(0);
    return state!;
}

export async function expectUniqueObjectIds(page: Page): Promise<void> {
    const state = await readEngineState(page);
    const ids = state?.objectIds ?? [];
    expect(new Set(ids).size, `duplicate object IDs: ${ids.join(', ')}`).toBe(ids.length);
}

export async function expectFiniteObjectPositions(page: Page): Promise<void> {
    const invalid = await page.evaluate(() => {
        const state = (window as any).__ra2debug?.game?.debugGetState?.();
        const objects = Array.isArray(state?.objects) ? state.objects : [];
        return objects
            .filter((object: any) => object?.position)
            .filter((object: any) => ![object.position.x, object.position.y, object.position.z].every(Number.isFinite))
            .map((object: any) => ({ id: object.id, name: object.name, position: object.position }))
            .slice(0, 20);
    });
    expect(invalid, `non-finite object positions: ${JSON.stringify(invalid)}`).toEqual([]);
}
