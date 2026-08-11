import type { IniSection } from "@/data/IniSection";

export interface AresInsigniaSelection {
    fileName: string;
    frame: number;
}

export interface AresInsigniaRules {
    rookie?: string;
    veteran?: string;
    elite?: string;
    rookieFrame: number;
    veteranFrame: number;
    eliteFrame: number;
    showEnemy: boolean;
}

interface IniReader {
    entries?: Map<string, string | string[]>;
    getBool(key: string, defaultValue?: boolean): boolean;
    getNumber(key: string, defaultValue?: number): number;
    getString(key: string, defaultValue?: string): string;
}

function findKey(ini: IniReader, key: string): string | undefined {
    const expected = key.toLocaleLowerCase("en-US");
    return [...(ini.entries?.keys() ?? [])].find((entry) =>
        entry.trim().toLocaleLowerCase("en-US") === expected,
    );
}

function getString(ini: IniReader, key: string): string {
    const actualKey = findKey(ini, key);
    return actualKey === undefined ? "" : ini.getString(actualKey).trim();
}

function getNumber(ini: IniReader, key: string, defaultValue: number): number {
    const actualKey = findKey(ini, key);
    return actualKey === undefined ? defaultValue : ini.getNumber(actualKey, defaultValue);
}

export function parseAresInsigniaRules(
    ini: IniSection | IniReader,
    defaultShowEnemy = true,
): AresInsigniaRules | undefined {
    const values = {
        rookie: getString(ini, "Insignia.Rookie") || undefined,
        veteran: getString(ini, "Insignia.Veteran") || undefined,
        elite: getString(ini, "Insignia.Elite") || undefined,
    };
    const hasFrame = ["Rookie", "Veteran", "Elite"].some((rank) =>
        findKey(ini, `InsigniaFrame.${rank}`) !== undefined,
    );
    if (!values.rookie && !values.veteran && !values.elite && !hasFrame) {
        return undefined;
    }

    const showEnemyKey = findKey(ini, "Insignia.ShowEnemy");
    return {
        ...values,
        rookieFrame: getNumber(ini, "InsigniaFrame.Rookie", -1),
        veteranFrame: getNumber(ini, "InsigniaFrame.Veteran", -1),
        eliteFrame: getNumber(ini, "InsigniaFrame.Elite", -1),
        showEnemy: showEnemyKey === undefined
            ? defaultShowEnemy
            : ini.getBool(showEnemyKey, defaultShowEnemy),
    };
}

export function resolveAresInsigniaShowEnemy(
    ini: IniSection | IniReader,
    defaultShowEnemy = true,
): boolean {
    const key = findKey(ini, "Insignia.ShowEnemy");
    return key === undefined ? defaultShowEnemy : ini.getBool(key, defaultShowEnemy);
}

/** Engine veterancy values are 0=rookie, 1=veteran, 2=elite. */
export function selectAresInsignia(
    rules: AresInsigniaRules | undefined,
    veteranLevel: number,
): AresInsigniaSelection | undefined {
    if (!rules) return undefined;

    let fileName: string | undefined;
    let frame: number;
    if (veteranLevel <= 0) {
        fileName = rules.rookie;
        frame = rules.rookieFrame;
    }
    else if (veteranLevel === 1) {
        fileName = rules.veteran;
        frame = rules.veteranFrame;
    }
    else {
        fileName = rules.elite;
        frame = rules.eliteFrame;
    }
    return fileName ? { fileName, frame: frame < 0 ? 0 : Math.trunc(frame) } : undefined;
}
