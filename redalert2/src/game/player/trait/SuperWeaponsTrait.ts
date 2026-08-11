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
}
