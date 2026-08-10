import { jsx } from '@/gui/jsx/jsx';
import { HtmlContainer } from '@/gui/HtmlContainer';
import { UiComponent } from '@/gui/jsx/UiComponent';
import { UiObject } from '@/gui/UiObject';
import { HtmlView } from '@/gui/jsx/HtmlView';
import { LoadingScreen } from './LoadingScreen';
import { OBS_COUNTRY_NAME, OBS_COUNTRY_UI_NAME } from '@/game/gameopts/constants';
import * as THREE from 'three';
import { SideType, isYuriCountry } from '@/game/SideType';
import { Engine } from '@/engine/Engine';
interface Country {
    name: string;
    side: SideType;
    uiName: string;
    loadScreen?: string;
    loadScreenPalette?: string;
}
interface PlayerInfo {
    name: string;
    country?: Country;
    color?: string;
}
interface Rules {
    getMultiplayerCountries(): Country[];
    colors: Map<string, any>;
}
interface Viewport {
    x: number;
    y: number;
    width: number;
    height: number;
}
interface GameResConfig {
    isCdn(): boolean;
    getCdnBaseUrl(): string;
}
interface LoadingScreenWrapperProps {
    playerInfos: PlayerInfo[];
    strings: {
        get(key: string, ...args: any[]): string;
    };
    rules: Rules;
    viewport: Viewport;
    playerName?: string;
    mapName: string;
    gameResConfig: GameResConfig;
}
const countryBackgrounds = new Map<string, string>()
    .set("Americans", "ls800ustates.png")
    .set("French", "ls800france.png")
    .set("Germans", "ls800germany.png")
    .set("British", "ls800ukingdom.png")
    .set("Russians", "ls800russia.png")
    .set("Confederation", "ls800cuba.png")
    .set("Africans", "ls800libya.png")
    .set("Arabs", "ls800iraq.png")
    .set("Alliance", "ls800korea.png")
    .set("YuriCountry", "ls800yuri.png")
    .set(OBS_COUNTRY_NAME, "ls800obs.png");
// YR repainted every loading screen against a per-country palette (RA2
// shares one mpls.pal). Rendering a YR screen with the RA2 palette
// produces the blotchy white/blue garbage, so prefer these when present.
const countryPalettes = new Map<string, string>()
    .set("Americans", "mplsu.pal")
    .set("French", "mplsf.pal")
    .set("Germans", "mplsg.pal")
    .set("British", "mplsuk.pal")
    .set("Russians", "mplsr.pal")
    .set("Confederation", "mplsc.pal")
    .set("Africans", "mplsl.pal")
    .set("Arabs", "mplsi.pal")
    .set("Alliance", "mplsk.pal")
    .set("YuriCountry", "mpyls.pal")
    .set(OBS_COUNTRY_NAME, "mplsobs.pal");
export class LoadingScreenWrapper extends UiComponent<LoadingScreenWrapperProps> {
    private declare countryName: string;
    private declare color: string;
    private declare bgHtmlImg?: string;
    private declare bgSpriteImg?: string;
    private declare bgSpritePal?: string;
    private declare htmlEl?: any;
    private declare sprite?: any;
    createUiObject({ playerName, gameResConfig }: {
        playerName?: string;
        gameResConfig: GameResConfig;
    }): UiObject {
        const uiObject = new UiObject(new THREE.Object3D(), new HtmlContainer());
        const player = playerName
            ? this.props.playerInfos.find(p => p.name === playerName)
            : undefined;
        const countryName = player?.country
            ? isYuriCountry(player.country)
                ? "YuriCountry"
                : player.country.name
            : OBS_COUNTRY_NAME;
        this.countryName = countryName;
        let color = player?.color ?? "#fff";
        if (player?.country) {
            const loadColorKey = player.country.side === SideType.GDI
                ? "AlliedLoad"
                : player.country.side === SideType.Yuri
                    ? "YuriLoad"
                    : "SovietLoad";
            color = (this.props.rules.colors.get(loadColorKey) ??
                this.props.rules.colors.get("SovietLoad"))?.asHexString() ?? "#fff";
        }
        this.color = color;
        const configuredBackground = player?.country?.loadScreen?.trim();
        const backgroundImage = configuredBackground || countryBackgrounds.get(countryName);
        if (backgroundImage) {
            if (gameResConfig.isCdn()) {
                const htmlImage = /\.shp$/i.test(backgroundImage)
                    ? backgroundImage.replace(/\.shp$/i, '.png')
                    : backgroundImage;
                this.bgHtmlImg = gameResConfig.getCdnBaseUrl() + "ls/" + htmlImage;
            }
            else {
                this.bgSpriteImg = /\.(png|shp)$/i.test(backgroundImage)
                    ? backgroundImage.replace(/\.png$/i, '.shp')
                    : `${backgroundImage}.shp`;
                const configuredPalette = player?.country?.loadScreenPalette?.trim();
                const perCountryPal = configuredPalette || countryPalettes.get(countryName);
                this.bgSpritePal = perCountryPal && Engine.vfs?.fileExists(perCountryPal)
                    ? perCountryPal
                    : (player?.country ? "mpls.pal" : "mplsobs.pal");
            }
        }
        else {
            console.warn("Missing loading image for country " + countryName);
        }
        try {
            console.log('[LoadingScreenWrapper] createUiObject:', {
                isCdn: gameResConfig.isCdn(),
                countryName,
                bgSpriteImg: this.bgSpriteImg,
                bgSpritePal: this.bgSpritePal,
                bgHtmlImg: this.bgHtmlImg,
            });
            if (!gameResConfig.isCdn() && Engine.vfs) {
                const imgName = this.bgSpriteImg!;
                const palName = this.bgSpritePal!;
                const imgExists = Engine.vfs.fileExists(imgName);
                const palExists = Engine.vfs.fileExists(palName);
                console.log('[LoadingScreenWrapper] VFS existence:', { imgName, imgExists, palName, palExists });
                try {
                    (Engine.vfs as any).debugListFileOwners?.(imgName);
                    (Engine.vfs as any).debugListFileOwners?.(palName);
                    console.log('[LoadingScreenWrapper] VFS archives:', Engine.vfs.listArchives());
                }
                catch { }
            }
        }
        catch { }
        return uiObject;
    }
    defineChildren(): any {
        const countries = this.props.rules.getMultiplayerCountries();
        const viewport = this.props.viewport;
        try {
            console.log('[LoadingScreenWrapper] defineChildren: willRenderSprite=', !this.props.gameResConfig.isCdn(), {
                bgSpriteImg: this.bgSpriteImg,
                bgSpritePal: this.bgSpritePal,
                viewport,
            });
        }
        catch { }
        return jsx("fragment", null, this.props.gameResConfig.isCdn() || !this.bgSpriteImg
            ? []
            : jsx("sprite", {
                image: this.bgSpriteImg,
                palette: this.bgSpritePal,
                x: viewport.x,
                y: viewport.y,
                ref: (sprite: any) => (this.sprite = sprite),
            }), jsx(HtmlView, {
            innerRef: (el: any) => (this.htmlEl = el),
            component: LoadingScreen,
            props: {
                viewport: this.props.viewport,
                countryUiNames: new Map([
                    [OBS_COUNTRY_NAME, OBS_COUNTRY_UI_NAME],
                    ...countries.map(country => [country.name, country.uiName] as [
                        string,
                        string
                    ])
                ]),
                strings: this.props.strings,
                countryName: this.countryName,
                mapName: this.props.mapName,
                color: this.color,
                playerInfos: this.props.playerInfos,
                bgImageSrc: this.bgHtmlImg,
            },
        }));
    }
    updateViewport(viewport: Viewport): void {
        this.htmlEl?.applyOptions((options: any) => (options.viewport = viewport));
        this.sprite?.setPosition(viewport.x, viewport.y);
    }
    applyOptions(optionsUpdater: (options: any) => void): void {
        this.htmlEl?.applyOptions(optionsUpdater);
    }
}
