import { EventType } from "@/game/event/EventType";
import { CompositeDisposable } from "@/util/disposable/CompositeDisposable";
import { AresBountyTextFx } from "@/engine/renderable/fx/AresBountyTextFx";
import * as THREE from "three";

interface Game {
    events: {
        subscribe: (event: EventType, handler: (event: any) => void) => () => void;
    };
    speed: {
        value: number;
    };
}

interface RenderableManager {
    addEffect(effect: any): void;
}

/** Bridges the generic Ares bounty event to the shared world renderer. */
export class AresBountyFxHandler {
    private readonly disposables = new CompositeDisposable();

    constructor(
        private readonly game: Game,
        private readonly renderableManager: RenderableManager,
        private readonly camera: THREE.Camera,
    ) { }

    private handleBountyAward = (event: { amount: number; position?: THREE.Vector3 }) => {
        if (!event.position || !Number.isFinite(event.amount)) {
            return;
        }
        this.renderableManager.addEffect(new AresBountyTextFx(
            event.position,
            event.amount,
            this.camera,
            this.game.speed,
        ));
    };

    init(): void {
        this.disposables.add(this.game.events.subscribe(EventType.AresBountyAward, this.handleBountyAward));
    }

    dispose(): void {
        this.disposables.dispose();
    }
}
