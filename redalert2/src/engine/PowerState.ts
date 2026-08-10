import { BoxedVar } from '../util/BoxedVar';

export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';

/**
 * OS-reported thermal pressure, pushed in by the native shell
 * (ios/Sources/GameViewController.swift or the Android shell). Nothing in the browser can observe
 * this: JavaScript timing cannot tell SoC throttling apart from a heavy frame,
 * so without the shell the game has no way to know it is cooking the device.
 */
export const thermalState = new BoxedVar<ThermalState>('nominal');

/** Set when the native shell reports a power-saving mode. */
export const lowPowerMode = new BoxedVar<boolean>(false);

/**
 * Render fps ceiling implied by the current power state. 0 = no ceiling.
 *
 * Only the render path is capped — the simulation tick rate is untouched, so
 * this can change mid-match without any risk to lockstep determinism. At
 * `serious` the SoC is already throttling, so halving the frame rate costs
 * less smoothness than the throttle itself would.
 */
export function powerFrameCap(): number {
    if (thermalState.value === 'critical') {
        return 15;
    }
    if (thermalState.value === 'serious' || lowPowerMode.value) {
        return 20;
    }
    return 0;
}

/**
 * Installs the receiver the native shell calls. No-op in a browser, where the
 * shell never calls it and the caps above stay inert.
 */
export function installPowerStateReceiver(): void {
    const shell = (window as any).__RA2_SHELL__;
    if (shell?.thermalState) {
        thermalState.value = shell.thermalState;
    }
    (window as any).__RA2_POWER__ = (state: { thermal?: ThermalState; lowPower?: boolean }) => {
        if (state?.thermal) {
            thermalState.value = state.thermal;
        }
        if (state?.lowPower !== undefined) {
            lowPowerMode.value = !!state.lowPower;
        }
    };
}
