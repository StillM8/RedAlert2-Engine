import { DriveLocomotor } from './DriveLocomotor';

/**
 * Standard Mech locomotion. Ares exposes this as the Tiberian Sun walker
 * CLSID; its ground route is Drive-compatible, but it does not use the
 * regular acceleration curve and is approximately 40% slower than Drive.
 */
export class MechLocomotor extends DriveLocomotor {
    constructor(game: any) {
        super(game, { speedMultiplier: 0.6, ignoreAcceleration: true });
    }
}
