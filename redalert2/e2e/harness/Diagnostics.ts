import type { Page } from '@playwright/test';

export interface DiagnosticEvent {
    at: string;
    type: string;
    text: string;
    location?: string;
}

export interface RuntimeSnapshot {
    url: string;
    debugKeys: string[];
    profile?: unknown;
    screen?: unknown;
    game?: {
        id?: unknown;
        startTimestamp?: unknown;
        seed?: unknown;
        map?: {
            name?: unknown;
            title?: unknown;
            digest?: unknown;
        };
        status?: unknown;
        currentTick?: unknown;
        hash?: unknown;
        nextObjectId?: unknown;
        objectCount?: unknown;
        objectIds?: unknown[];
        players?: unknown[];
    };
}

export interface DiagnosticsSnapshot {
    runtime: RuntimeSnapshot | { error: string };
    events: DiagnosticEvent[];
    pageErrors: string[];
    requestFailures: DiagnosticEvent[];
    recentActions: unknown[];
}

const MAX_EVENTS = 250;
const MAX_ACTIONS = 100;

function trimRing<T>(items: T[], max: number): void {
    if (items.length > max) {
        items.splice(0, items.length - max);
    }
}

/** Collects browser/runtime evidence without serializing live engine objects. */
export class Diagnostics {
    private readonly events: DiagnosticEvent[] = [];
    private readonly pageErrors: string[] = [];
    private readonly requestFailures: DiagnosticEvent[] = [];
    private readonly recentActions: unknown[] = [];

    constructor(private readonly page: Page) {
        page.on('console', (message) => {
            this.events.push({
                at: new Date().toISOString(),
                type: `console:${message.type()}`,
                text: message.text(),
                location: message.location().url || undefined,
            });
            trimRing(this.events, MAX_EVENTS);
        });
        page.on('pageerror', (error) => {
            this.pageErrors.push(error.stack || error.message);
            trimRing(this.pageErrors, MAX_EVENTS);
        });
        page.on('requestfailed', (request) => {
            this.requestFailures.push({
                at: new Date().toISOString(),
                type: 'requestfailed',
                text: `${request.method()} ${request.url()} — ${request.failure()?.errorText || 'unknown error'}`,
                location: request.url(),
            });
            trimRing(this.requestFailures, MAX_EVENTS);
        });
    }

    recordAction(action: unknown): void {
        this.recentActions.push(action);
        trimRing(this.recentActions, MAX_ACTIONS);
    }

    get hasPageErrors(): boolean {
        return this.pageErrors.length > 0;
    }

    assertNoPageErrors(): void {
        if (this.pageErrors.length) {
            throw new Error(`The page raised ${this.pageErrors.length} uncaught error(s):\n${this.pageErrors.join('\n')}`);
        }
    }

    assertNoRepeatedRuntimeErrors(minimumOccurrences = 3): void {
        const relevantErrors = this.events
            .filter((event) => event.type === 'console:error')
            .filter((event) => /(?:bot|gameanimation|turnmanager|gamecrash|fatal|exception)/i.test(event.text));
        const counts = new Map<string, number>();
        for (const event of relevantErrors) {
            const normalized = event.text
                .replace(/\b(?:tick|currentTick)\s*[:=]\s*\d+/gi, 'tick')
                .replace(/\s+/g, ' ')
                .trim();
            counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
        }
        const repeated = [...counts.entries()]
            .filter(([, count]) => count >= minimumOccurrences)
            .map(([message, count]) => `${count}x ${message}`);
        if (repeated.length) {
            throw new Error(`Repeated runtime errors detected:\n${repeated.join('\n')}`);
        }
    }

    async capture(): Promise<DiagnosticsSnapshot> {
        let runtime: RuntimeSnapshot | { error: string };
        try {
            runtime = await this.page.evaluate(() => {
                const debugRoot = (window as any).__ra2debug ?? {};
                const game = debugRoot.game;
                let gameState: any;
                try {
                    gameState = game?.debugGetState?.();
                }
                catch (error) {
                    gameState = { error: String(error) };
                }
                const rawObjects = Array.isArray(gameState?.objects) ? gameState.objects : [];
                const rawPlayers = Array.isArray(gameState?.players) ? gameState.players : [];
                const objectIds = rawObjects
                    .map((object: any) => object?.id)
                    .filter((id: unknown) => Number.isSafeInteger(id))
                    .slice(0, 200);
                return {
                    url: location.href,
                    debugKeys: Object.keys(debugRoot).sort(),
                    profile: debugRoot.profile?.id ?? debugRoot.profile?.name,
                    screen: debugRoot.mainMenuController?.getCurrentScreenType?.(),
                    game: game
                        ? {
                            id: game.id,
                            startTimestamp: game.startTimestamp,
                            // GameFactory seeds the PRNG from the game id and
                            // timestamp. Keep both values in failure output so
                            // a soak failure can be replayed deterministically.
                            seed: {
                                gameId: game.id,
                                startTimestamp: game.startTimestamp,
                            },
                            map: {
                                name: game.gameOpts?.mapName,
                                title: game.gameOpts?.mapTitle,
                                digest: game.gameOpts?.mapDigest,
                            },
                            status: game.status,
                            currentTick: game.currentTick,
                            hash: (() => {
                                try {
                                    return game.getHash?.();
                                }
                                catch (error) {
                                    return `hash-error: ${String(error)}`;
                                }
                            })(),
                            nextObjectId: game.nextObjectId?.value,
                            objectCount: rawObjects.length,
                            objectIds,
                            players: rawPlayers.slice(0, 32).map((player: any) => ({
                                name: player?.name,
                                defeated: player?.defeated,
                                isAi: player?.isAi,
                                credits: player?.credits,
                            })),
                        }
                        : undefined,
                } satisfies RuntimeSnapshot;
            });
        }
        catch (error) {
            runtime = { error: String(error) };
        }
        return {
            runtime,
            events: [...this.events],
            pageErrors: [...this.pageErrors],
            requestFailures: [...this.requestFailures],
            recentActions: [...this.recentActions],
        };
    }
}
