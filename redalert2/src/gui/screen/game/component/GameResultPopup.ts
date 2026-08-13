import * as THREE from "three";
import { jsx } from "@/gui/jsx/jsx";
import { UiObject } from "@/gui/UiObject";
import { UiComponent, UiComponentProps } from "@/gui/jsx/UiComponent";
import { HtmlContainer } from "@/gui/HtmlContainer";
import { Engine } from "@/engine/Engine";
export enum GameResultType {
    SpVictory = 0,
    SpDefeat = 1,
    MpVictory = 2,
    MpDefeat = 3
}
export type GameResultPopupProps = UiComponentProps & {
    viewport: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    type: GameResultType;
    image?: string;
    palette?: string;
};
export class GameResultPopup extends UiComponent<GameResultPopupProps> {
    createUiObject() {
        const { viewport } = this.props;
        const obj = new UiObject(new THREE.Object3D(), new HtmlContainer());
        obj.setPosition(viewport.x, viewport.y);
        obj.getHtmlContainer().setSize(viewport.width, viewport.height);
        return obj;
    }
    defineChildren() {
        const { viewport, type } = this.props;
        const customImage = this.props.image;
        const customPalette = this.props.palette;
        const hasCustomPresentation = !!customImage && !!customPalette && !!Engine.vfs?.fileExists(customImage) && !!Engine.vfs?.fileExists(customPalette);
        return jsx("sprite", {
            image: hasCustomPresentation ? customImage : "grfxtxt.shp",
            palette: hasCustomPresentation ? customPalette : "grfxtxt.pal",
            ref: (e: any) => {
                const size = e.getSize();
                e.setPosition((viewport.width - size.width) / 2, (viewport.height - size.height) / 2);
            },
            frame: type,
        });
    }
}
