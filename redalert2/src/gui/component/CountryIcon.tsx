import React from 'react';
import { RANDOM_COUNTRY_NAME, OBS_COUNTRY_NAME } from '@/game/gameopts/constants';
import { Image } from '@/gui/component/Image';
const countryIcons = new Map<string, string>()
    .set("Americans", "usai.pcx")
    .set("French", "frai.pcx")
    .set("Germans", "geri.pcx")
    .set("British", "gbri.pcx")
    .set("Russians", "rusi.pcx")
    .set("Confederation", "lati.pcx")
    .set("Africans", "djbi.pcx")
    .set("Arabs", "arbi.pcx")
    .set("Alliance", "japi.pcx")
    // YR only — ships in ra2md.mix::localmd.mix. Image.tsx skips a missing
    // file gracefully, so RA2-only installs are unaffected.
    .set("YuriCountry", "yrii.pcx")
    .set(RANDOM_COUNTRY_NAME, "rani.pcx")
    .set(OBS_COUNTRY_NAME, "obsi.pcx");
interface CountryIconProps {
    country: any;
    countryFlags?: Map<string, string>;
}
function normalizeFlagName(flag: string): string {
    return /\.[a-z0-9]+$/i.test(flag) ? flag : `${flag}.pcx`;
}
function findCaseInsensitive(map: Map<string, string> | undefined, key: string): string | undefined {
    if (!map) return undefined;
    const direct = map.get(key);
    if (direct !== undefined) return direct;
    const normalized = key.toLocaleLowerCase('en-US');
    return [...map.entries()].find(([candidate]) =>
        candidate.toLocaleLowerCase('en-US') === normalized)?.[1];
}

/** Resolve an explicit content-defined flag before using retail fallbacks. */
export function resolveCountryIconFilename(country: any, countryFlags?: Map<string, string>): string | undefined {
    const isName = typeof country === 'string';
    const countryName = isName ? country : country?.name ?? country?.id;
    if (!countryName) return undefined;
    const configuredFlag = isName
        ? findCaseInsensitive(countryFlags, countryName)
        : country?.flag;
    if (configuredFlag) return normalizeFlagName(configuredFlag);

    const normalizedName = String(countryName).toLocaleLowerCase('en-US');
    const fallback = [...countryIcons.entries()].find(([name]) =>
        name.toLocaleLowerCase('en-US') === normalizedName)?.[1];
    return fallback;
}
export const CountryIcon: React.FC<CountryIconProps> = ({ country, countryFlags }) => {
    const iconSrc = resolveCountryIconFilename(country, countryFlags);
    return (<div className="player-country-icon">
      {iconSrc ? <Image src={iconSrc}/> : null}
    </div>);
};
