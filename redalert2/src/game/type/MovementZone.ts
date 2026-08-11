export enum MovementZone {
    Amphibious = 0,
    AmphibiousCrusher = 1,
    AmphibiousDestroyer = 2,
    Crusher = 3,
    CrusherAll = 4,
    Destroyer = 5,
    Fly = 6,
    Infantry = 7,
    InfantryDestroyer = 8,
    Normal = 9,
    Subterranean = 10,
    Water = 11
}

/** Generic Ares/YR spelling compatibility; the authored MO value is misspelled. */
export const movementZoneAliases = {
    Subterannean: "Subterranean",
} as const;
