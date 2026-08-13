import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";

export interface AresVeterancyRules {
    /** Allow an open-topped/gunner transport to gain experience from passengers. */
    fromPassengers: boolean;
    /** The airstrike designator receives credit instead of the called-in aircraft. */
    fromAirstrike: boolean;
    /** An elite gunner/open-topped vehicle passes new kill experience to its passenger. */
    promotePassengers: boolean;
    /** Experience multiplier when a passenger is the credited recipient. */
    passengerModifier: number;
    /** Experience multiplier when an airstrike designator is the credited recipient. */
    airstrikeModifier: number;
    /** Additional experience awarded to the owner of a spawned unit. */
    spawnOwnerModifier: number;
    /** Experience multiplier retained by a spawned unit. */
    spawnModifier: number;
    /** Additional experience awarded to a mind controller. */
    mindControlSelfModifier: number;
    /** Experience multiplier retained by a mind-controlled unit. */
    mindControlVictimModifier: number;
}

interface IniSectionLike {
    has(key: string): boolean;
    getBool(key: string, defaultValue?: boolean): boolean;
    getString?(key: string, defaultValue?: string): string;
    getFixed?(key: string, defaultValue?: number): number;
    getNumber(key: string, defaultValue?: number): number;
}

/** Parse the documented customizable-veterancy fields with Ares defaults. */
export function parseAresVeterancyRules(section: IniSectionLike): AresVeterancyRules {
    return {
        fromPassengers: readBoolean(section, "Experience.FromPassengers", true),
        fromAirstrike: readBoolean(section, "Experience.FromAirstrike"),
        promotePassengers: section.getBool("Experience.PromotePassengers"),
        passengerModifier: readModifier(section, "Experience.PassengerModifier", 1),
        airstrikeModifier: readModifier(section, "Experience.AirstrikeModifier", 1),
        spawnOwnerModifier: readModifier(section, "Experience.SpawnOwnerModifier", 0),
        spawnModifier: readModifier(section, "Experience.SpawnModifier", 1),
        mindControlSelfModifier: readModifier(section, "Experience.MindControlSelfModifier", 0),
        mindControlVictimModifier: readModifier(section, "Experience.MindControlVictimModifier", 1),
    };
}

/**
 * Ares documents the source-selection fields as boolean. Some shipped map
 * overrides use the equivalent percentage spelling (100%/0%), so accept
 * non-zero numeric boolean values without changing yes/no behavior.
 */
function readBoolean(section: IniSectionLike, key: string, defaultValue: boolean = false): boolean {
    const raw = section.getString?.(key, "")?.trim().toLocaleLowerCase("en-US") ?? "";
    if (!raw) return defaultValue;
    if (["yes", "1", "true", "on"].includes(raw)) return true;
    if (["no", "0", "false", "off"].includes(raw)) return false;
    const numeric = section.getFixed?.(key, Number.NaN);
    return Number.isFinite(numeric) ? numeric !== 0 : section.getBool(key, defaultValue);
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
    return {
        fromPassengers: true,
        fromAirstrike: false,
        promotePassengers: false,
        passengerModifier: 1,
        airstrikeModifier: 1,
        spawnOwnerModifier: 0,
        spawnModifier: 1,
        mindControlSelfModifier: 0,
        mindControlVictimModifier: 1,
        ...object?.rules?.aresVeterancy,
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
    let sourceMultiplier = 1;

    const sourceController = source.mindControllableTrait?.getController?.();
    if (sourceController) {
        sourceMultiplier *= sourceRules.mindControlVictimModifier;
    }

    const designator = attribution.airstrikeDesignator;
    if (designator && rulesFor(designator).fromAirstrike) {
        sourceReceivesCredit = false;
        addRecipient(recipients, designator, rulesFor(designator).airstrikeModifier);
    }

    const passenger = attribution.passenger;
    if (passenger) {
        if (!sourceRules.fromPassengers) {
            sourceReceivesCredit = false;
        }
        else if (sourceReceivesCredit &&
            sourceRules.promotePassengers &&
            source.veteranLevel >= VeteranLevel.Elite &&
            (source.rules?.openTopped || source.rules?.gunner) &&
            passenger) {
            // A mind-controlled open-topped unit does not pass passenger XP to
            // a non-allied passenger/controller relationship.
            const passengerController = source.mindControllableTrait?.getController?.();
            const passengerControllerAllowed = !passengerController ||
                !gameManager?.areFriendly ||
                gameManager.areFriendly(passengerController, source);
            sourceReceivesCredit = false;
            if (passengerControllerAllowed) {
                addRecipient(recipients, passenger, sourceRules.passengerModifier * sourceMultiplier);
            }
        }
    }

    const spawner = attribution.spawner;
    if (spawner && isTrainable(source) && isTrainable(spawner)) {
        const spawnerRules = rulesFor(spawner);
        sourceMultiplier *= spawnerRules.spawnModifier;
        if (spawner.mindControllableTrait?.getController?.()) {
            sourceMultiplier *= spawnerRules.mindControlVictimModifier;
        }
    }

    if (sourceReceivesCredit) {
        addRecipient(recipients, source, sourceMultiplier);
    }

    if (spawner &&
        isTrainable(source) &&
        isTrainable(spawner) &&
        rulesFor(spawner).spawnOwnerModifier !== 0) {
        const spawnerRules = rulesFor(spawner);
        const spawnerMindControlMultiplier = spawner.mindControllableTrait?.getController?.()
            ? spawnerRules.mindControlVictimModifier
            : 1;
        addRecipient(recipients, spawner, spawnerRules.spawnOwnerModifier * spawnerMindControlMultiplier);
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
