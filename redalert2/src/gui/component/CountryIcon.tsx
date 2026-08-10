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
export const CountryIcon: React.FC<CountryIconProps> = ({ country, countryFlags }) => {
    const countryName = typeof country === 'string' ? country : country?.name;
    const configuredFlag = typeof country !== 'string' ? country?.flag : countryFlags?.get(countryName);
    const iconSrc = configuredFlag ? normalizeFlagName(configuredFlag) : countryIcons.get(countryName);
    return (<div className="player-country-icon">
      {iconSrc && <Image src={iconSrc}/>}
    </div>);
};
