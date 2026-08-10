export enum SideType {
    GDI = 0,
    Nod = 1,
    Civilian = 2,
    Mutant = 3,
    // Yuri's Revenge third faction ("ThirdSide" in rulesmd.ini).
    Yuri = 4
}

/** Keep Yuri presentation selection independent from the display name. */
export function isYuriCountry(country?: { side?: SideType; name?: string; sideId?: string; presentationId?: string }): boolean {
    if (!country) {
        return false;
    }
    if (country.side === SideType.Yuri) {
        return true;
    }
    const presentation = country.presentationId?.replace(/\s+/g, '').toLowerCase();
    if (presentation === 'yuri' || presentation === 'yurihud') {
        return true;
    }
    const normalizedName = country.name?.replace(/\s+/g, '').toLowerCase();
    return normalizedName === 'yuricountry' || normalizedName === 'yuri';
}
