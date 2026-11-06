import { DetonateIvanBombsAction } from '../DetonateIvanBombsAction';

export class DetonateIvanBombsActionFactory {
    constructor(private readonly game: any) {
    }

    create(): DetonateIvanBombsAction {
        return new DetonateIvanBombsAction(this.game);
    }
}
