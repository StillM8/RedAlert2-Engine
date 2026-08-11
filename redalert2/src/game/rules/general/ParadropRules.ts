import { SideType } from '../../SideType';
import type { AresSideRegistry, SideId } from '@/extensions/ares/AresSides';

interface IniSectionReader {
    entries?: Map<string, string | string[]>;
    getArray(key: string): string[];
    getNumberArray(key: string): number[];
    getNumber(key: string, defaultValue?: number): number;
    getString(key: string, defaultValue?: string): string;
}

interface IniFileReader {
    getSection(name: string): IniSectionReader | undefined;
}

interface ParadropSquad {
    inf: string;
    num: number;
}

/**
 * Resolve the legacy paradrop aircraft without assuming a particular mod's
 * object name.  Retail YR and Ares profiles commonly omit the old
 * General->ParadropPlane key while still marking the aircraft in the shared
 * AircraftTypes registry with Primary=ParaDropWeapon.
 */
export function resolveParadropAircraft(
    general: IniSectionReader,
    rootIni?: IniFileReader,
): string {
    const explicit = general.getString("ParadropPlane").trim();
    if (explicit) {
        return explicit;
    }

    const aircraftTypes = rootIni?.getSection("AircraftTypes");
    if (!aircraftTypes?.entries) {
        return "";
    }

    for (const [index, value] of aircraftTypes.entries) {
        if (!/^\d+$/.test(index) || typeof value !== "string") {
            continue;
        }
        const aircraftName = value.trim();
        if (!aircraftName) {
            continue;
        }
        const aircraft = rootIni.getSection(aircraftName);
        if (aircraft?.getString("Primary").trim().toLocaleLowerCase("en-US") === "paradropweapon") {
            return aircraftName;
        }
    }

    // Ares custom paradrop superweapons can provide their own aircraft and
    // therefore have no legacy plane to expose to the vanilla call sites.
    return "";
}

export class ParadropRules {
    private allyParaDrop: ParadropSquad[] = [];
    private amerParaDrop: ParadropSquad[] = [];
    private sovParaDrop: ParadropSquad[] = [];
    private yuriParaDrop: ParadropSquad[] = [];
    private paradropPlane: string = '';
    private paradropRadius: number = 0;
    private squadsBySideId = new Map<string, ParadropSquad[]>();
    private warnedUnknownSides = new Set<string>();
    readIni(ini: IniSectionReader, sideRegistry?: AresSideRegistry, rootIni?: IniFileReader): ParadropRules {
        this.allyParaDrop = this.readParadropSquad(ini.getArray("AllyParaDropInf"), ini.getNumberArray("AllyParaDropNum"), "Ally");
        this.amerParaDrop = this.readParadropSquad(ini.getArray("AmerParaDropInf"), ini.getNumberArray("AmerParaDropNum"), "Amer");
        this.sovParaDrop = this.readParadropSquad(ini.getArray("SovParaDropInf"), ini.getNumberArray("SovParaDropNum"), "Sov");
        this.yuriParaDrop = this.readParadropSquad(ini.getArray("YuriParaDropInf"), ini.getNumberArray("YuriParaDropNum"), "Yuri");
        this.squadsBySideId.clear();
        this.warnedUnknownSides.clear();
        if (sideRegistry) {
            for (const side of sideRegistry.list()) {
                const squads = side.legacySide === SideType.GDI
                    ? this.allyParaDrop
                    : side.legacySide === SideType.Nod
                        ? this.sovParaDrop
                        : side.legacySide === SideType.Yuri
                            ? (this.yuriParaDrop.length ? this.yuriParaDrop : this.sovParaDrop)
                            : undefined;
                // A custom side has no safe Soviet/Yuri fallback. It will
                // return an empty, diagnosable squad until its own data-driven
                // paradrop definition is implemented.
                if (squads) this.squadsBySideId.set(side.id.toLocaleLowerCase("en-US"), squads);
            }
        }
        else {
            this.squadsBySideId.set("gdi", this.allyParaDrop);
            this.squadsBySideId.set("allied", this.allyParaDrop);
            this.squadsBySideId.set("nod", this.sovParaDrop);
            this.squadsBySideId.set("soviet", this.sovParaDrop);
            this.squadsBySideId.set("yuri", this.yuriParaDrop.length ? this.yuriParaDrop : this.sovParaDrop);
            this.squadsBySideId.set("thirdside", this.yuriParaDrop.length ? this.yuriParaDrop : this.sovParaDrop);
        }
        this.paradropPlane = resolveParadropAircraft(ini, rootIni);
        this.paradropRadius = ini.getNumber("ParadropRadius");
        return this;
    }
    private readParadropSquad(infArray: string[], numArray: number[], side: string): ParadropSquad[] {
        if (infArray.length !== numArray.length) {
            throw new RangeError(`${side}ParaDropInf/Num size mismatch (${infArray.length}, ${numArray.length})`);
        }
        const squads: ParadropSquad[] = [];
        for (let i = 0; i < infArray.length; ++i) {
            if (numArray[i] > 0) {
                squads.push({ inf: infArray[i], num: numArray[i] });
            }
        }
        return squads;
    }
    getParadropSquads(side: SideType | SideId): ParadropSquad[] {
        if (typeof side === "string") {
            const key = side.trim().toLocaleLowerCase("en-US");
            const squads = this.squadsBySideId.get(key);
            if (squads) return squads;
            if (!this.warnedUnknownSides.has(key)) {
                this.warnedUnknownSides.add(key);
                console.warn(`[Ares] No paradrop squad definition for side "${side}"`);
            }
            return [];
        }
        switch (side) {
            case SideType.GDI:
                return this.allyParaDrop;
            case SideType.Nod:
                return this.sovParaDrop;
            case SideType.Yuri:
                // YR: YuriParaDropInf/Num; RA2 rules lack them, so borrow Soviet.
                return this.yuriParaDrop.length ? this.yuriParaDrop : this.sovParaDrop;
            default:
                return this.sovParaDrop;
        }
    }
}
