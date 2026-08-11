import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";

export interface AresVeterancyRules {
    /** The airstrike designator receives credit instead of the called-in aircraft. */
    fromAirstrike: boolean;
    /** An elite gunner/open-topped vehicle passes new kill experience to its passenger. */
    promotePassengers: boolean;
    /** Additional experience awarded to the owner of a spawned unit. */
    spawnOwnerModifier: number;
    /** Additional experience awarded to a mind controller. */
    mindControlSelfModifier: number;
}

interface IniSectionLike {
    has(key: string): boolean;
    getBool(key: string, defaultValue?: boolean): boolean;
    getFixed?(key: string, defaultValue?: number): number;
    getNumber(key: string, defaultValue?: number): number;
}

/**
 * Parse only the customizable-veterancy fields authored by Mental Omega.
 * The omitted values are the documented Ares defaults.
 */
export function parseAresVeterancyRules(section: IniSectionLike): AresVeterancyRules {
    return {
        fromAirstrike: readBoolean(section, "Experience.FromAirstrike"),
        promotePassengers: section.getBool("Experience.PromotePassengers"),
        spawnOwnerModifier: readModifier(section, "Experience.SpawnOwnerModifier", 0),
        mindControlSelfModifier: readModifier(section, "Experience.MindControlSelfModifier", 0),
    };
}

/**
 * Ares documents FromAirstrike as boolean. Some shipped MO map overrides use
 * the equivalent percentage spelling (100%/0%), so accept non-zero numeric
 * boolean values without changing the documented yes/no behavior.
 */
function readBoolean(section: IniSectionLike, key: string): boolean {
    const value = section.getBool(key);
    if (value || !section.has(key)) return value;
    const numeric = section.getFixed?.(key, Number.NaN);
    return Number.isFinite(numeric) && numeric !== 0;
}

function readModifier(section: IniSectionLike, key: string, defaultValue: number): number {
    if (!section.has(key)) return defaultValue;
    const value = section.getFixed
        ? section.getFixed(key, defaultValue)
        : section.getNumber(key, defaultValue);
    return Number.isFinite(value) ? value : defaultValue;
}

export interface AresKillAttribution {
    source?: any;
    airstrikeDesignator?: any;
    passenger?: any;
    spawner?: any;
}

export interface AresVeterancyRecipient {
    object: any;
    multiplier: number;
}

/** Build a reusable description of all relationships that can affect kill XP. */
export function createAresKillAttribution(killer: any): AresKillAttribution {
    const source = killer?.obj;
    const authored = killer?.aresAttribution ?? {};
    const passenger = source?.openToppedTrait?.getPassenger?.() ??
        source?.gunnerTrait?.getPassenger?.();
    const spawner = authored.spawner ?? source?.spawnLinkTrait?.getParent?.();
    return {
        source,
        airstrikeDesignator: authored.airstrikeDesignator,
        passenger,
        spawner,
    };
}

function rulesFor(object: any): AresVeterancyRules {
    return object?.rules?.aresVeterancy ?? {
        fromAirstrike: false,
        promotePassengers: false,
        spawnOwnerModifier: 0,
        mindControlSelfModifier: 0,
    };
}

function isTrainable(object: any): boolean {
    return object?.rules?.trainable !== false;
}

function addRecipient(
    recipients: Map<any, AresVeterancyRecipient>,
    object: any,
    multiplier: number,
): void {
    if (!object || !isTrainable(object) || !Number.isFinite(multiplier) || multiplier === 0) return;
    const previous = recipients.get(object);
    if (previous) {
        previous.multiplier += multiplier;
    }
    else {
        recipients.set(object, { object, multiplier });
    }
}

/**
 * Resolve the recipients for one kill. The normal source receives 100% of
 * the normal XP unless one of the Ares source relationships redirects it.
 */
export function resolveAresVeterancyRecipients(
    attribution: AresKillAttribution,
    gameManager?: { areFriendly?(source: any, target: any): boolean },
): readonly AresVeterancyRecipient[] {
    const source = attribution.source;
    if (!source?.isTechno?.()) return [];

    const recipients = new Map<any, AresVeterancyRecipient>();
    const sourceRules = rulesFor(source);
    let sourceReceivesCredit = isTrainable(source);

    const designator = attribution.airstrikeDesignator;
    if (designator && rulesFor(designator).fromAirstrike) {
        sourceReceivesCredit = false;
        addRecipient(recipients, designator, 1);
    }

    const passenger = attribution.passenger;
    if (sourceReceivesCredit &&
        sourceRules.promotePassengers &&
        source.veteranLevel >= VeteranLevel.Elite &&
        (source.rules?.openTopped || source.rules?.gunner) &&
        passenger) {
        sourceReceivesCredit = false;
        addRecipient(recipients, passenger, 1);
    }

    if (sourceReceivesCredit) {
        addRecipient(recipients, source, 1);
    }

    const spawner = attribution.spawner;
    if (spawner &&
        isTrainable(source) &&
        isTrainable(spawner) &&
        rulesFor(spawner).spawnOwnerModifier !== 0) {
        addRecipient(recipients, spawner, rulesFor(spawner).spawnOwnerModifier);
    }

    const controller = source.mindControllableTrait?.getController?.();
    const originalOwner = source.mindControllableTrait?.getOriginalOwner?.();
    const controllerModifier = controller
        ? rulesFor(controller).mindControlSelfModifier
        : 0;
    const controllerCanCredit = controller &&
        isTrainable(source) &&
        isTrainable(controller) &&
        controllerModifier !== 0 &&
        (!originalOwner || !gameManager?.areFriendly?.(controller, { owner: originalOwner }));
    if (controllerCanCredit) {
        addRecipient(recipients, controller, controllerModifier);
    }

    return [...recipients.values()];
}
