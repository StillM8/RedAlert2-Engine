import { CompositeDisposable } from '@/util/disposable/CompositeDisposable';
import { Coords } from '@/game/Coords';
import { EventType } from '@/game/event/EventType';
interface Game {
    events: {
        subscribe: (event: EventType, handler: (event: any) => void) => () => void;
    };
}
interface RenderableManager {
    createTransientAnim: (name: string, callback: (anim: any) => void, onFinished?: () => void) => any;
}
interface TriggerAnimEvent {
    type: EventType;
    name: string;
    tile: {
        rx: number;
        ry: number;
        z: number;
    };
    position?: any;
    mutationOwner?: any;
    useUnitPalette?: boolean;
    animationChain?: string[];
}
export class TriggerActionFxHandler {
    private game: Game;
    private renderableManager: RenderableManager;
    private disposables: CompositeDisposable;
    private handleEvent: (event: TriggerAnimEvent) => void;
    constructor(game: Game, renderableManager: RenderableManager) {
        this.game = game;
        this.renderableManager = renderableManager;
        this.disposables = new CompositeDisposable();
        this.handleEvent = (event: TriggerAnimEvent) => {
            switch (event.type) {
                case EventType.TriggerAnim: {
                    const chain = event.animationChain?.length ? event.animationChain : [event.name];
                    const play = (index: number) => {
                        const animName = chain[index];
                        this.renderableManager.createTransientAnim(animName, (anim) => {
                            const position = event.position ??
                                Coords.tile3dToWorld(event.tile.rx + 0.5, event.tile.ry + 0.5, event.tile.z);
                            anim.setPosition(position);
                            if (event.useUnitPalette && event.mutationOwner) {
                                anim.remapUnitColor(event.mutationOwner.color);
                            }
                        }, () => {
                            if (index + 1 < chain.length) play(index + 1);
                        });
                    };
                    play(0);
                    break;
                }
            }
        };
    }
    init(): void {
        this.disposables.add(this.game.events.subscribe(EventType.TriggerAnim, this.handleEvent));
    }
    dispose(): void {
        this.disposables.dispose();
    }
}
