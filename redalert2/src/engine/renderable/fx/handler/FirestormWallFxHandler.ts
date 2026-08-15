import { EventType } from '@/game/event/EventType';
import { CompositeDisposable } from '@/util/disposable/CompositeDisposable';
import { Coords } from '@/game/Coords';

interface Game {
    events: {
        subscribe: (event: EventType, handler: (event: any) => void) => {
            dispose: () => void;
        };
    };
    rules: {
        audioVisual: {
            firestormActiveAnim: string;
            firestormIdleAnim: string;
        };
    };
}
interface RenderableManager {
    createTransientAnim: (name: string, callback: (anim: any) => void) => any;
}
interface WallStateChangeEvent {
    type: EventType;
    building: {
        tile: {
            rx: number;
            ry: number;
            z: number;
        };
        isDestroyed?: boolean;
    };
    active: boolean;
}

/**
 * Renders the authored Firestorm wall animation flicker.
 *
 * Ares restores Firestorm walls with the shared FirestormActiveAnim /
 * FirestormIdleAnim audio-visual fields.  The docs specify these are played
 * *randomly* on wall sections while the owner's firestorm is active or idle.
 * The simulation (AresFirestormWallTrait) makes the random decision with the
 * deterministic game RNG and dispatches transient TriggerAnimEvents; this
 * handler subscribes to the wall state-change event for future persistent
 * presentation needs and keeps the registry of wall tiles for reference.
 */
export class FirestormWallFxHandler {
    private game: Game;
    private renderableManager: RenderableManager;
    private disposables: CompositeDisposable;
    private wallState = new Map<any, boolean>();
    private handleStateChange: (event: WallStateChangeEvent) => void;
    constructor(game: Game, renderableManager: RenderableManager) {
        this.game = game;
        this.renderableManager = renderableManager;
        this.disposables = new CompositeDisposable();
        this.handleStateChange = (event: WallStateChangeEvent) => {
            if (event.building.isDestroyed) {
                this.wallState.delete(event.building);
                return;
            }
            this.wallState.set(event.building, event.active);
        };
    }
    init(): void {
        this.disposables.add(this.game.events.subscribe(EventType.AresFirestormWallStateChange, this.handleStateChange));
    }
    dispose(): void {
        this.wallState.clear();
        this.disposables.dispose();
    }
}
