import { ObjectType } from "@/engine/type/ObjectType";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";

export interface AresBountyTechnoRules {
    enabled: boolean;
    /** Undefined means use [AudioVisual] BountyDisplay at runtime. */
    display?: boolean;
    value: number;
    rookieValue: number;
    veteranValue: number;
    eliteValue: number;
}

export interface AresBountyGeneralRules {
    enablers: string[];
}

interface IniSectionLike {
    has(key: string): boolean;
    getBool(key: string, defaultValue?: boolean): boolean;
    getNumber(key: string, defaultValue?: number): number;
    getArray(key: string): string[];
}

const BOUNTY_KEYS = [
    "Bounty",
    "Bounty.Display",
    "Bounty.Value",
    "Bounty.RookieValue",
    "Bounty.VeteranValue",
    "Bounty.EliteValue",
] as const;

function normalizeNames(values: string[]): string[] {
    return values
        .map(value => value.trim())
        .filter(value => value.length > 0 && value.toLocaleLowerCase("en-US") !== "none");
}

/** Parse the [General] BountyEnablers list. An empty list means always enabled. */
export function parseAresBountyGeneralRules(section: IniSectionLike): AresBountyGeneralRules {
    return { enablers: normalizeNames(section.getArray("BountyEnablers")) };
}

/**
 * Parse the TechnoType bounty extension. The extension is absent when no
 * bounty key was authored, preserving the vanilla path for ordinary rules.
 */
export function parseAresBountyTechnoRules(section: IniSectionLike): AresBountyTechnoRules | undefined {
    if (!BOUNTY_KEYS.some(key => section.has(key))) {
        return undefined;
    }

    const value = section.getNumber("Bounty.Value", 0);
    return {
        enabled: section.getBool("Bounty"),
        display: section.has("Bounty.Display") ? section.getBool("Bounty.Display") : undefined,
        value,
        rookieValue: section.has("Bounty.RookieValue")
            ? section.getNumber("Bounty.RookieValue")
            : value,
        veteranValue: section.has("Bounty.VeteranValue")
            ? section.getNumber("Bounty.VeteranValue")
            : value,
        eliteValue: section.has("Bounty.EliteValue")
            ? section.getNumber("Bounty.EliteValue")
            : value,
    };
}

/** Select the authored bounty value without treating zero as an absent value. */
export function selectAresBountyValue(rules: AresBountyTechnoRules, level: VeteranLevel | number): number {
    if (level >= VeteranLevel.Elite) {
        return rules.eliteValue;
    }
    if (level >= VeteranLevel.Veteran) {
        return rules.veteranValue;
    }
    return rules.rookieValue;
}

interface BountyPlayer {
    country?: { givesBounty?: boolean };
    credits: number;
    getOwnedObjectsByType?(type: ObjectType, includeLimbo?: boolean): Array<{ name?: string; rules?: { name?: string } }>;
}

interface BountyObject {
    owner?: BountyPlayer;
    rules?: {
        aresBounty?: AresBountyTechnoRules;
        name?: string;
    };
    veteranLevel?: VeteranLevel | number;
    isTechno?(): boolean;
    mindControllableTrait?: { getOriginalOwner?(): BountyPlayer | undefined };
}

interface BountyGame {
    rules?: {
        general?: { bountyEnablers?: string[] };
    };
    areFriendly?(source: BountyObject, target: BountyObject): boolean;
}

function hasBountyEnabler(player: BountyPlayer, game: BountyGame): boolean {
    const enablers = game.rules?.general?.bountyEnablers ?? [];
    if (enablers.length === 0) {
        return true;
    }

    const expected = new Set(enablers.map(name => name.toLocaleLowerCase("en-US")));
    return (player.getOwnedObjectsByType?.(ObjectType.Building, true) ?? []).some(object => {
        const name = object.rules?.name ?? object.name;
        return !!name && expected.has(name.toLocaleLowerCase("en-US"));
    });
}

/**
 * Award bounty for the same source shape used by Game.destroyObject(). This
 * handles weapon kills and crush kills because both provide killer.obj.
 * Returns the signed amount applied, or zero when the kill is not eligible.
 */
export function awardAresBounty(game: BountyGame, killer: any, target: BountyObject): number {
    const source = killer?.obj as BountyObject | undefined;
    const player = killer?.player as BountyPlayer | undefined;
    if (!source || !player || !target?.isTechno?.()) {
        return 0;
    }

    const hunterRules = source.rules?.aresBounty;
    if (!hunterRules?.enabled || !hasBountyEnabler(player, game)) {
        return 0;
    }

    const victimOwner = target.mindControllableTrait?.getOriginalOwner?.() ?? target.owner;
    if (!victimOwner || victimOwner === player || victimOwner.country?.givesBounty === false) {
        return 0;
    }
    if (game.areFriendly?.(source, { owner: victimOwner }) ?? false) {
        return 0;
    }

    const value = selectAresBountyValue(target.rules?.aresBounty ?? {
        enabled: false,
        value: 0,
        rookieValue: 0,
        veteranValue: 0,
        eliteValue: 0,
    }, target.veteranLevel ?? VeteranLevel.None);
    player.credits = Math.max(0, player.credits + value);
    return value;
}
