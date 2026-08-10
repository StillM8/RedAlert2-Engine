/**
 * Explicit resource precedence for the Westwood/MO overlay model.
 *
 * Higher values win.  The enum is deliberately independent from the order in
 * which asynchronous archive loads happen, so a future loader cannot change
 * gameplay merely by completing in a different order.
 */
export enum ResourceLayer {
    BaseGame = 0,
    Expansion = 100,
    ExtensionRuntime = 200,
    ModCore = 300,
    ModPatch = 400,
    LooseOverride = 500,
    MapOverride = 600,
}

export type ResourceSource = "game" | "engine" | "mod" | "map" | "cdn";
