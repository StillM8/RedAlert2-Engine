export class SuperWeaponsTrait {
    private superWeapons: Map<string, any>;
    private readonly aresShotsFired = new Map<string, number>();
    constructor() {
        this.superWeapons = new Map();
    }
    getAll(): any[] {
        return [...this.superWeapons.values()];
    }
    add(superWeapon: any): void {
        this.superWeapons.set(superWeapon.name, superWeapon);
    }
    has(name: string): boolean {
        return this.superWeapons.has(name);
    }
    get(name: string): any | undefined {
        return this.superWeapons.get(name);
    }
    remove(name: string): void {
        this.superWeapons.get(name)?.deactivateChargeDrain?.();
        this.superWeapons.delete(name);
    }
    getAresShotsFired(name: string): number {
        return this.aresShotsFired.get(name) ?? 0;
    }
    recordAresSuperWeaponShot(name: string, shotsFired: number): void {
        this.aresShotsFired.set(name, Math.max(0, Math.trunc(shotsFired)));
    }
    /**
     * Deterministic fingerprint of every future-affecting superweapon state
     * owned by this player.
     *
     * Two collections are hashed independently and domain-separated:
     *
     * - currently owned superweapons (readiness, charge timers) and their
     *   per-weapon shot counters;
     * - the full historical Ares shots-fired map. The global availability
     *   evaluator consults historical counts even for superweapons the
     *   player does NOT currently own (grant/revoke/reacquisition cycles),
     *   so hashing only current weapons plus a bare history size would let
     *   two peers with different histories but equal sizes collide.
     *
     * Both iterations use sorted keys so Map insertion order cannot influence
     * the value.
     */
    getHash(): number {
        let hash = OWNED_WEAPONS_HASH_TAG;
        for (const name of [...this.superWeapons.keys()].sort()) {
            const weapon = this.superWeapons.get(name)!;
            hash = mixString(hash, name);
            if (typeof weapon.getHash === "function") {
                hash = (hash * 31 + weapon.getHash()) | 0;
            }
            else {
                hash = (hash * 31 + (weapon.status ?? 0)) | 0;
                hash = (hash * 31 + (weapon.chargeTicks ?? 0)) | 0;
                hash = (hash * 31 + (weapon.rechargeTicks ?? 0)) | 0;
                hash = (hash * 31 + (weapon.chargeDrainRatio ?? 1)) | 0;
                hash = (hash * 31 + (weapon.virtualChargeSinceTick ?? -1)) | 0;
                hash = (hash * 31 + (weapon.aresBatteryActive ? 1 : 0)) | 0;
                hash = (hash * 31 + (weapon.shotsFired ?? 0)) | 0;
            }
            hash = (hash * 31 + (this.aresShotsFired.get(name) ?? 0)) | 0;
        }
        hash = (hash * 31 + this.superWeapons.size) | 0;

        hash = (hash * 31 + SHOT_HISTORY_HASH_TAG) | 0;
        for (const name of [...this.aresShotsFired.keys()].sort()) {
            hash = mixString(hash, name);
            hash = (hash * 31 + (this.aresShotsFired.get(name) ?? 0)) | 0;
        }
        hash = (hash * 31 + this.aresShotsFired.size) | 0;
        return hash;
    }
}

/** Domain separators so the two collections cannot alias each other. */
const OWNED_WEAPONS_HASH_TAG = 0x53573031; // "SW01"
const SHOT_HISTORY_HASH_TAG = 0x53483031; // "SH01"

function mixString(hash: number, value: string): number {
    for (const char of value) {
        hash = ((hash * 31) + char.charCodeAt(0)) | 0;
    }
    return hash;
}
