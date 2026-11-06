import { Coords } from "@/game/Coords";
import { ObjectType } from "@/engine/type/ObjectType";
import { Vector2 } from "@/game/math/Vector2";
import { Weapon } from "@/game/Weapon";
import { WeaponType } from "@/game/WeaponType";
import { Warhead } from "@/game/Warhead";
import { SuperWeaponEffect, TileCoord } from "@/game/superweapon/SuperWeaponEffect";
import { Game } from "@/game/Game";
import { Target } from "@/game/Target";
import { Player } from "../Player";
import { getBuildingSuperWeaponTraits } from "@/game/gameobject/trait/SuperWeaponTrait";

export interface NukeEffectOptions {
    payload?: string;
    nukePayload?: string;
    payloadConfigured?: boolean;
    nukePayloadConfigured?: boolean;
    siloLaunch?: boolean;
    nukeSiloLaunch?: boolean;
    damage?: number;
    swDamage?: number;
    warhead?: string;
    swWarhead?: string;
    superWeapon?: any;
    superWeaponName?: string;
    weaponType?: string;
}

function normalizedName(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const name = value.trim();
    if (!name || /^(?:none|<none>)$/i.test(name)) return undefined;
    return name;
}

function comparableName(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function isHealthyAndPresent(building: any): boolean {
    if (!building || building.isDestroyed || building.isDisposed || building.isCrashing) return false;
    if (building.isSpawned === false || building.limboData) return false;
    const health = building.healthTrait?.health;
    if (health !== undefined && health !== null && (!Number.isFinite(health) || health <= 0)) return false;
    return true;
}

function isPowerOnline(building: any): boolean {
    const powered = building.poweredTrait?.isPoweredOn;
    if (powered === false || (typeof powered === "function" && powered() === false)) return false;
    if (building.rules?.powered && building.owner?.powerTrait?.isLowPower?.()) return false;
    return true;
}

function configuredProviderNames(building: any): string[] {
    const values = [
        building.rules?.superWeapon,
        building.rules?.superWeapon2,
        ...(Array.isArray(building.rules?.superWeapons)
            ? building.rules.superWeapons
            : building.rules?.superWeapons ? [building.rules.superWeapons] : []),
    ];
    return values.filter((value): value is string => typeof value === "string" && !!value.trim());
}

export function isNukeSiloEligible(
    building: any,
    superWeapon?: any,
    expectedName?: string,
): boolean {
    const nukeSilo = building?.rules?.nukeSilo;
    if (nukeSilo !== true && !/^(?:yes|true|1|on)$/i.test(String(nukeSilo))) return false;
    if (!isHealthyAndPresent(building) || !isPowerOnline(building)) return false;

    const targetName = expectedName ?? superWeapon?.name ?? superWeapon?.rules?.name;
    const traits = getBuildingSuperWeaponTraits(building);
    if (traits.length) {
        if (superWeapon) {
            return traits.some((trait: any) => {
                const attached = trait.getSuperWeapon?.(building);
                return attached === superWeapon ||
                    (!!targetName && comparableName(attached?.name) === comparableName(targetName));
            });
        }
        if (targetName) {
            return traits.some((trait: any) => comparableName(trait.name) === comparableName(targetName));
        }
    }
    if (superWeapon && targetName) {
        return configuredProviderNames(building).some((name) =>
            comparableName(name) === comparableName(targetName));
    }
    if (targetName) {
        const providerNames = configuredProviderNames(building);
        if (providerNames.length) {
            return providerNames.some((name) =>
                comparableName(name) === comparableName(targetName));
        }
    }
    return true;
}

export function selectNukeLaunchSilo(
    owner: any,
    expectedName?: string,
    superWeapon?: any,
): any | undefined {
    if (superWeapon?.isGift === true && superWeapon?.oneTimeOnly === true) return undefined;
    const buildings = owner?.getOwnedObjectsByType?.(ObjectType.Building) ?? owner?.buildings ?? [];
    return [...buildings].find((building: any) =>
        (!building?.owner || building.owner === owner) &&
        isNukeSiloEligible(building, superWeapon, expectedName));
}

export function resolveNukeDamage(configured: number | undefined, payloadRules: any): number {
    const configuredDamage = configured === undefined || configured === null
        ? Number.NaN
        : Number(configured);
    if (Number.isFinite(configuredDamage) && configuredDamage >= 0) return configuredDamage;
    const payloadDamage = Number(payloadRules?.damage);
    return Number.isFinite(payloadDamage) ? payloadDamage : 0;
}

export function resolveNukeWarhead(configured: string | undefined, payloadRules: any): string | undefined {
    return normalizedName(configured) ?? normalizedName(payloadRules?.warhead);
}

export class NukeEffect extends SuperWeaponEffect {
    private readonly weaponType?: string;
    private readonly options: NukeEffectOptions;
    private legacyPayloadFallback = false;

    constructor(
        type: any,
        owner: Player,
        tile: TileCoord,
        weaponTypeOrOptions?: string | NukeEffectOptions,
        options: NukeEffectOptions = {},
    ) {
        super(type, owner, tile);
        const suppliedOptions = typeof weaponTypeOrOptions === "object" && weaponTypeOrOptions !== null
            ? { ...weaponTypeOrOptions, ...options }
            : options;
        this.weaponType = normalizedName(
            typeof weaponTypeOrOptions === "string"
                ? weaponTypeOrOptions
                : suppliedOptions.weaponType,
        );
        this.options = {
            ...suppliedOptions,
            payload: suppliedOptions.payload ?? suppliedOptions.nukePayload,
            payloadConfigured: suppliedOptions.payloadConfigured ??
                suppliedOptions.nukePayloadConfigured ?? suppliedOptions.nukePayload !== undefined,
            siloLaunch: suppliedOptions.siloLaunch ?? suppliedOptions.nukeSiloLaunch,
            damage: suppliedOptions.damage ?? suppliedOptions.swDamage,
            warhead: suppliedOptions.warhead ?? suppliedOptions.swWarhead,
        };
    }

    onStart(game: Game): void {
        const payloadName = this.resolvePayloadName(game);
        if (!payloadName) return;
        const payloadRules = this.getWeaponRules(game, payloadName);
        if (!payloadRules) return;

        let target: Target;
        try {
            target = game.createTarget(undefined, this.tile);
        }
        catch {
            return;
        }

        const superWeapon = this.resolveSuperWeapon();
        const expectedName = this.options.superWeaponName ?? superWeapon?.name;
        const silo = this.siloLaunchEnabled() && this.weaponType
            ? selectNukeLaunchSilo(this.owner, expectedName, superWeapon)
            : undefined;
        if (silo) {
            try {
                const weapon = Weapon.factory(this.weaponType, WeaponType.Primary, silo, game.rules);
                if (!weapon) throw new Error("Missing carrier weapon");
                this.attachPayloadSettings(weapon, payloadName, payloadRules);
                weapon.fire(target, game);
                return;
            }
            catch {
            }
        }

        this.fireLooseNuke(payloadName, payloadRules, target, game);
    }

    private resolveSuperWeapon(): any {
        if (this.options.superWeapon !== undefined) return this.options.superWeapon;
        const name = this.options.superWeaponName;
        if (!name) return undefined;
        try {
            return this.owner?.superWeaponsTrait?.get?.(name);
        }
        catch {
            return undefined;
        }
    }

    private siloLaunchEnabled(): boolean {
        const value: any = this.options.siloLaunch;
        if (value === undefined || typeof value === "boolean") return value !== false;
        return !["no", "false", "0", "off"].includes(String(value).trim().toLocaleLowerCase("en-US"));
    }

    private resolvePayloadName(game: Game): string | undefined {
        const rawPayload = typeof this.options.payload === "string"
            ? this.options.payload.trim()
            : undefined;
        if (rawPayload && /^(?:none|<none>)$/i.test(rawPayload)) {
            return undefined;
        }
        const configured = normalizedName(rawPayload);
        if (configured) {
            return this.getWeaponRules(game, configured) ? configured : undefined;
        }

        const defaultPayload = Weapon.NUKE_PAYLOAD_NAME;
        if (this.getWeaponRules(game, defaultPayload)) return defaultPayload;
        if (!this.options.payloadConfigured && this.weaponType && this.getWeaponRules(game, this.weaponType)) {
            this.legacyPayloadFallback = true;
            return this.weaponType;
        }
        return undefined;
    }

    private getWeaponRules(game: Game, name: string): any | undefined {
        try {
            return game.rules.getWeapon(name);
        }
        catch {
            return undefined;
        }
    }

    private configuredWarheadName(): string | undefined {
        return normalizedName(this.options.warhead);
    }

    private attachPayloadSettings(weapon: any, payloadName: string, payloadRules: any): void {
        if (this.legacyPayloadFallback) return;
        weapon.nukePayloadName = payloadName;
        weapon.nukeDamage = resolveNukeDamage(this.options.damage, payloadRules);
        weapon.nukeWarheadName = this.configuredWarheadName();
    }

    private configureLooseWeapon(weapon: any, game: Game, payloadName: string, payloadRules: any): boolean {
        const damage = resolveNukeDamage(this.options.damage, payloadRules);
        const warheadName = this.configuredWarheadName();
        if (warheadName) {
            try {
                weapon.warhead = new Warhead(game.rules.getWarhead(warheadName));
            }
            catch {
                return false;
            }
        }
        weapon.rules = {
            ...(weapon.rules ?? {}),
            damage,
            ...(warheadName ? { warhead: warheadName } : {}),
        };
        if (!this.legacyPayloadFallback) {
            weapon.nukePayloadName = payloadName;
            weapon.nukeDamage = damage;
            weapon.nukeWarheadName = warheadName;
        }
        return true;
    }

    private fireLooseNuke(
        payloadName: string,
        payloadRules: any,
        target: Target,
        game: Game,
    ): void {
        const tile = this.tile;
        if (!tile || !game.map?.isWithinHardBounds) return;
        const position = new Vector2(tile.rx + 0.5, tile.ry + 0.5).multiplyScalar(Coords.LEPTONS_PER_TILE);
        if (!game.map.isWithinHardBounds(position)) return;
        try {
            const projectile = game.createLooseProjectile(payloadName, this.owner, target);
            if (!projectile) return;
            if (projectile.fromWeapon && !this.configureLooseWeapon(projectile.fromWeapon, game, payloadName, payloadRules)) {
                return;
            }
            projectile.position.moveToLeptons(position);
            projectile.position.tileElevation = Coords.worldToTileHeight(projectile.rules?.detonationAltitude ?? 0);
            game.spawnObject(projectile, projectile.position.tile ?? tile);
        }
        catch {
        }
    }

    onTick(game: Game): boolean {
        return true;
    }
}
