import { EngineDriver, type BuildingRole, type ProductionPlan } from '../harness/EngineDriver';

export async function startAssetBackedSkirmish(engine: EngineDriver, options: { aiCount?: number; allowCustomMapFallback?: boolean } = {}): Promise<void> {
    await engine.boot({ importAssets: true });
    await engine.openSkirmish();
    // Gameplay qualification prefers official maps. The soak may explicitly
    // fall back to a deterministic custom map because its purpose is long-run
    // lifecycle stability rather than retail-map placement qualification.
    await engine.chooseMap({
        minSlots: options.aiCount ? options.aiCount + 1 : undefined,
        allowCustomFallback: options.allowCustomMapFallback ?? Boolean(options.aiCount),
    });
    if (options.aiCount) {
        await engine.configureAiCount(options.aiCount);
    }
    await engine.startSkirmish();
}

export async function deployMcv(engine: EngineDriver): Promise<void> {
    await engine.deployMcvAndWaitForConstructionYard();
}

export async function buildRole(engine: EngineDriver, role: BuildingRole): Promise<{ plan: ProductionPlan; object: Record<string, unknown> }> {
    const plan = await engine.queueBuilding(role);
    await engine.waitForProductionReady(plan);
    await engine.placeQueuedBuilding(plan);
    const object = await engine.waitForOwnedObject(plan.objectName);
    return { plan, object };
}

export async function buildBasicEconomy(engine: EngineDriver): Promise<void> {
    await deployMcv(engine);
    await buildRole(engine, 'power');
    await buildRole(engine, 'refinery');
}

export async function buildVehicleProduction(engine: EngineDriver): Promise<ProductionPlan> {
    await buildBasicEconomy(engine);
    const warFactory = await buildRole(engine, 'war-factory');
    const unit = await engine.queueCombatUnit('vehicle');
    await engine.waitForProductionReady(unit);
    await engine.advanceTicks(30);
    await engine.waitForOwnedObject(unit.objectName);
    return {
        ...warFactory.plan,
        objectName: unit.objectName,
        objectType: unit.objectType,
        queueType: unit.queueType,
    };
}
