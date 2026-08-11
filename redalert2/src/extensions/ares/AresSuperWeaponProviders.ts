/** Ordered Ares superweapon provider slots on a TechnoType. */
export type AresSuperWeaponProviderSlot = "SuperWeapon" | "SuperWeapon2" | "SuperWeapons";

export interface AresSuperWeaponProvider {
    name: string;
    slot: AresSuperWeaponProviderSlot;
    index: number;
}

export interface AresSuperWeaponProviderRules {
    superWeapon?: unknown;
    superWeapon2?: unknown;
    superWeapons?: unknown;
}

function normalize(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function values(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : [value];
    return raw
        .flatMap(item => String(item ?? "").split(","))
        .map(item => item.trim())
        .filter(item => item.length > 0 && normalize(item) !== "none");
}

/**
 * Normalize the two vanilla provider slots plus Ares' ordered list. A
 * building gets one logical provider per case-insensitive superweapon name;
 * preserving the first occurrence keeps presentation and EVA ordering stable.
 */
export function normalizeAresSuperWeaponProviders(
    rules: AresSuperWeaponProviderRules,
): AresSuperWeaponProvider[] {
    const slots: Array<[AresSuperWeaponProviderSlot, unknown]> = [
        ["SuperWeapon", rules.superWeapon],
        ["SuperWeapon2", rules.superWeapon2],
        ["SuperWeapons", rules.superWeapons],
    ];
    const seen = new Set<string>();
    const providers: AresSuperWeaponProvider[] = [];
    for (const [slot, value] of slots) {
        for (const name of values(value)) {
            const key = normalize(name);
            if (seen.has(key)) continue;
            seen.add(key);
            providers.push({ name, slot, index: providers.length });
        }
    }
    return providers;
}

export function getAresSuperWeaponProviderNames(rules: AresSuperWeaponProviderRules): string[] {
    return normalizeAresSuperWeaponProviders(rules).map(provider => provider.name);
}

export function hasAresSuperWeaponProvider(rules: AresSuperWeaponProviderRules): boolean {
    return normalizeAresSuperWeaponProviders(rules).length > 0;
}

export function buildingProvidesAresSuperWeapon(
    building: { name?: string; rules?: AresSuperWeaponProviderRules },
    superWeaponName: string,
): boolean {
    const expected = normalize(superWeaponName);
    return normalizeAresSuperWeaponProviders(building.rules ?? {})
        .some(provider => normalize(provider.name) === expected);
}
