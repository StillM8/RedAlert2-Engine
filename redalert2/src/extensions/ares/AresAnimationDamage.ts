/**
 * The Ares animation-damage fields are authored on an [Animation] section,
 * not on the AttachEffect section that happens to display the animation.
 * Keep this model independent so standalone animations and attached
 * animations can use the same parser and accumulator semantics.
 */
export interface AresAnimationDamageSection {
    getNumber(key: string, defaultValue?: number): number;
    getString(key: string, defaultValue?: string): string;
    getBool(key: string, defaultValue?: boolean): boolean;
}

export interface AresAnimationDamageDefinition {
    name: string;
    damage: number;
    /** Number of simulation/animation update frames between full hits. */
    damageDelay: number;
    warhead?: string;
    weapon?: string;
    /** Animation playback values used by standalone animation instances. */
    rate: number;
    start: number;
    end: number;
    loopStart: number;
    loopEnd: number;
    loopCount: number;
    reverse: boolean;
}

export interface AresAnimationDamageState {
    accumulator: number;
}

export interface AresAnimationDamageStep {
    state: AresAnimationDamageState;
    damage: number;
}

function nonBlank(value: string | undefined): string | undefined {
    const text = value?.trim();
    return text || undefined;
}

function safeNumber(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/** Parse the documented Ares Animation damage family from an art section. */
export function parseAresAnimationDamage(
    name: string,
    section: AresAnimationDamageSection | undefined,
): AresAnimationDamageDefinition | undefined {
    if (!section) return undefined;

    const damage = safeNumber(section.getNumber("Damage", 0), 0);
    const authoredDelay = safeNumber(section.getNumber("Damage.Delay", 0), 0);
    const start = Math.trunc(safeNumber(section.getNumber("Start", 0), 0));
    const end = Math.max(start, Math.trunc(safeNumber(section.getNumber("End", start), start)));
    const loopStart = Math.max(start, Math.trunc(safeNumber(section.getNumber("LoopStart", start), start)));
    const loopEnd = Math.max(
        loopStart,
        Math.trunc(safeNumber(section.getNumber("LoopEnd", end + 1), end + 1)) - 1,
    );
    const loopCount = Math.trunc(safeNumber(section.getNumber("LoopCount", 1), 1));
    const rate = Math.max(0, safeNumber(section.getNumber("Rate", 60 * 15), 60 * 15) / 60);
    return {
        name,
        damage,
        damageDelay: Math.max(0, Math.trunc(authoredDelay)),
        warhead: nonBlank(section.getString("Warhead", "")),
        weapon: nonBlank(section.getString("Weapon", "")),
        rate,
        start,
        end,
        loopStart,
        loopEnd,
        loopCount,
        reverse: section.getBool("Reverse", false),
    };
}

function truncInteger(value: number): number {
    return value < 0 ? Math.ceil(value) : Math.floor(value);
}

/**
 * Advance one Ares animation damage accumulator.
 *
 * With Damage.Delay and Damage >= 1, Ares waits for the authored delay and
 * then delivers the full integer damage. Without a delay it accumulates
 * fractional Damage values and spends whole points as soon as available.
 */
export function advanceAresAnimationDamage(
    definition: AresAnimationDamageDefinition,
    previousState: AresAnimationDamageState = { accumulator: 0 },
): AresAnimationDamageStep {
    let accumulator = Number.isFinite(previousState.accumulator)
        ? previousState.accumulator
        : 0;

    if (definition.damageDelay > 0 && definition.damage >= 1) {
        accumulator += 1;
        if (accumulator < definition.damageDelay) {
            return { state: { accumulator }, damage: 0 };
        }

        accumulator = 0;
        return {
            state: { accumulator },
            damage: Math.max(0, truncInteger(definition.damage)),
        };
    }

    accumulator += definition.damage;
    if (accumulator < 1) {
        return { state: { accumulator }, damage: 0 };
    }

    const damage = Math.max(0, truncInteger(accumulator));
    accumulator -= damage;
    return { state: { accumulator }, damage };
}
