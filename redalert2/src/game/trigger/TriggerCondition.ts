import { TriggerEventType } from "@/data/map/trigger/TriggerEventType";
import { houseReferenceMatches, resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";

const standingEventTypes = new Set<number>([
    TriggerEventType.NoEvent,
    TriggerEventType.AnyEvent,
    TriggerEventType.DestroyedAllUnits,
    TriggerEventType.DestroyedAllBuildings,
    TriggerEventType.DestroyedAll,
    TriggerEventType.CreditsExceed,
    TriggerEventType.ElapsedTime,
    TriggerEventType.DestroyedBuildings,
    TriggerEventType.DestroyedUnits,
    TriggerEventType.NoFactoriesLeft,
    TriggerEventType.GlobalIsSet,
    TriggerEventType.GlobalIsCleared,
    TriggerEventType.LowPower,
    TriggerEventType.BuildingExists,
    TriggerEventType.LocalIsSet,
    TriggerEventType.LocalIsCleared,
    TriggerEventType.AmbientLightBelow,
    TriggerEventType.AmbientLightAbove,
    TriggerEventType.ElapsedScenarioTime,
    TriggerEventType.DestroyedAllUnitsNaval,
    TriggerEventType.DestroyedAllUnitsLand,
    TriggerEventType.BuildingNotExists,
    TriggerEventType.PowerFull,
    TriggerEventType.TechTypeExists,
    TriggerEventType.TechTypeDoesNotExist,
]);

function eventType(event: any): number {
    const raw = event?.type;
    if (typeof raw === "number") {
        return raw;
    }
    const numeric = Number(raw);
    if (Number.isSafeInteger(numeric)) {
        return numeric;
    }
    if (typeof raw === "string") {
        const named = (TriggerEventType as any)[raw];
        if (Number.isSafeInteger(named)) {
            return named;
        }
    }
    return Number.NaN;
}

export function isTemporalTriggerEvent(event: any): boolean {
    const explicit = event?.temporal;
    if (typeof explicit === "boolean") {
        return explicit;
    }
    const type = eventType(event);
    if (type === 3 || type === 18) {
        return false;
    }
    return Number.isSafeInteger(type) && !standingEventTypes.has(type);
}

export function canRememberTriggerEvent(event: any): boolean {
    if (!isTemporalTriggerEvent(event)) {
        return false;
    }
    if (typeof event?.rememberable === "boolean") {
        return event.rememberable;
    }
    if (typeof event?.canRemember === "boolean") {
        return event.canRemember;
    }
    const type = eventType(event);
    if (type === TriggerEventType.EnteredBy ||
        type === TriggerEventType.AttackedByAny ||
        type === TriggerEventType.AttackedByHouse) {
        return false;
    }
    const name = String(event?.name ?? event?.eventName ?? event?.id ?? "").toLocaleLowerCase("en-US");
    return !name.includes("paralyzed") && !name.includes("repeating");
}

export class TriggerCondition {
    [key: string]: any;
    public event: any;
    public trigger: any;
    public blocking: boolean;
    public targets: any[];
    public temporal: boolean;
    public rememberable: boolean;
    public player?: any;
    constructor(event: any, trigger: any) {
        this.event = event;
        this.trigger = trigger;
        this.blocking = false;
        this.targets = [];
        this.temporal = isTemporalTriggerEvent(event);
        this.rememberable = canRememberTriggerEvent(event);
    }
    init(game: any): void {
        const player = resolveTriggerHousePlayer(game, this.trigger);
        if (player) {
            this.player = player;
        }
    }
    protected matchesHouse(context: any, player: any, reference: unknown): boolean {
        return houseReferenceMatches(context, player, reference);
    }
    check(context: any, events: any[]): boolean | any[] {
        throw new Error("Trigger condition does not implement check");
    }
    setTargets(targets: any[]): void {
        this.targets = targets;
    }
    reset(): void { }
    getDebugName(): string {
        return `${this.event.triggerId}[${this.event.eventIndex}] (${this.trigger.name}).`;
    }
}
