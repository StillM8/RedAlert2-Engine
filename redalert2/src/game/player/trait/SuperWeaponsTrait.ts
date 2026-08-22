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
     * Deterministic fingerprint of every owned superweapon's future-affecting
     * state: readiness, charge timers, and finite-shot counters. Two peers
     * that disagree about whether a superweapon is ready would diverge on the
     * next activation, so this must contribute to the lockstep hash.
     * Keys are sorted so Map insertion order cannot influence the value.
     */
    getHash(): number {
        let hash = 0;
        for (const name of [...this.superWeapons.keys()].sort()) {
            const weapon = this.superWeapons.get(name)!;
            for (const char of name) {
                hash = ((hash * 31) + char.charCodeAt(0)) | 0;
            }
            hash = (hash * 31 + (weapon.status ?? 0)) | 0;
            hash = (hash * 31 + (weapon.chargeTicks ?? 0)) | 0;
            hash = (hash * 31 + (weapon.rechargeTicks ?? 0)) | 0;
            hash = (hash * 31 + (this.aresShotsFired.get(name) ?? 0)) | 0;
        }
        hash = (hash * 31 + this.superWeapons.size) | 0;
        hash = (hash * 31 + this.aresShotsFired.size) | 0;
        return hash;
    }
}
