import { Coords } from "@/game/Coords";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { isAresEmpOperational } from "@/extensions/ares/AresEMP";
import { getAvailableBuildingSuperWeapon } from "@/game/gameobject/trait/SuperWeaponTrait";
import type { AresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { SuperWeaponEffect, type TileCoord } from "@/game/superweapon/SuperWeaponEffect";

type TileLike = { rx: number; ry: number; z?: number };

interface EmpulseBuilding {
    id?: number | string;
    name?: string;
    tile?: TileLike;
    centerTile?: TileLike;
    tileElevation?: number;
    zone?: number;
    isDestroyed?: boolean;
    isDisposed?: boolean;
    isCrashing?: boolean;
    isSpawned?: boolean;
    rules?: {
        name?: string;
        empulseCannon?: boolean;
        powered?: boolean;
    };
    owner?: any;
    empTrait?: { isUnderEMP?: () => boolean };
    warpedOutTrait?: { isActive?: () => boolean };
    poweredTrait?: { isPoweredOn?: () => boolean };
    superWeaponTrait?: { getSuperWeapon?: (building: any) => any };
    superWeaponTraits?: Array<{ getSuperWeapon?: (building: any) => any }>;
    primaryWeapon?: EmpulseWeapon;
    armedTrait?: { getWeapons?: () => EmpulseWeapon[] };
}

interface EmpulseWeapon {
    rules?: {
        damage?: number;
        minimumRange?: number;
        range?: number;
    };
    warhead?: {
        detonate?: (...args: any[]) => void;
    };
    expireCooldown?: () => void;
    fire?: (target: any, game: any) => void;
}

export interface AresEmpulseLaunchSiteOptions {
    superWeapon?: any;
}

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function buildingName(building: EmpulseBuilding): string {
    return String(building.rules?.name ?? building.name ?? "");
}

function buildingTile(building: EmpulseBuilding): TileLike | undefined {
    return building.centerTile ?? building.tile;
}

function targetTileDistance(source: EmpulseBuilding, target: TileLike): number {
    const sourceTile = buildingTile(source);
    if (!sourceTile || !target) return Number.POSITIVE_INFINITY;
    return Math.hypot(sourceTile.rx - target.rx, sourceTile.ry - target.ry);
}

function getLaunchWeapon(building: EmpulseBuilding): EmpulseWeapon | undefined {
    return building.primaryWeapon ?? building.armedTrait?.getWeapons?.()[0];
}

function isHealthyAndPresent(building: EmpulseBuilding): boolean {
    if (building.isDestroyed || building.isDisposed || building.isCrashing) return false;
    // Real buildings are false while in limbo; synthetic fixtures may omit
    // isSpawned, so only an explicit false rejects the site.
    if (building.isSpawned === false) return false;
    const health = (building as any).healthTrait?.health;
    return !Number.isFinite(health) || health > 0;
}

function isPowerOnline(building: EmpulseBuilding): boolean {
    if (building.poweredTrait?.isPoweredOn && !building.poweredTrait.isPoweredOn()) {
        return false;
    }
    if (building.rules?.powered && building.owner?.powerTrait?.isLowPower?.()) {
        return false;
    }
    return true;
}

/**
 * Antares' default EMPulse launch site is an attached BuildingType with
 * EMPulseCannon=yes. EMPulse.Cannons overrides that test and names the exact
 * BuildingTypes allowed to fire, without requiring the normal attachment.
 */
export function isAresEmpulseLaunchSite(
    building: EmpulseBuilding,
    rules: Pick<AresSuperWeaponDefinition, "empulseCannons">,
    options: AresEmpulseLaunchSiteOptions = {},
): boolean {
    if (!isHealthyAndPresent(building) || !isPowerOnline(building) || !isAresEmpOperational(building)) {
        return false;
    }

    const configuredCannons = new Set((rules.empulseCannons ?? []).map(normalize));
    if (configuredCannons.size > 0) {
        return configuredCannons.has(normalize(buildingName(building)));
    }

    if (!building.rules?.empulseCannon) return false;
    if (!options.superWeapon) return true;

    const attached = getAvailableBuildingSuperWeapon(building)?.superWeapon;
    return attached === options.superWeapon;
}

function resolveLaunchRange(
    building: EmpulseBuilding,
    rules: Pick<AresSuperWeaponDefinition, "swRangeMinimum" | "swRangeMaximum">,
): { minimum: number; maximum: number } {
    const weapon = getLaunchWeapon(building);
    let minimum = Number.isFinite(rules.swRangeMinimum) ? rules.swRangeMinimum! : 0;
    let maximum = Number.isFinite(rules.swRangeMaximum) ? rules.swRangeMaximum! : -1;

    // Antares resolves negative range values from the cannon weapon. Its
    // default EMPulse maximum is -1, so an omitted SW.RangeMaximum uses the
    // weapon's range rather than becoming an unlimited attack.
    if (minimum < 0) minimum = weapon?.rules?.minimumRange ?? 0;
    if (maximum < 0) maximum = weapon?.rules?.range ?? Number.POSITIVE_INFINITY;
    return { minimum, maximum };
}

export function isAresEmpulseLaunchSiteInRange(
    building: EmpulseBuilding,
    target: TileLike,
    rules: Pick<AresSuperWeaponDefinition, "swRangeMinimum" | "swRangeMaximum">,
): boolean {
    const distance = targetTileDistance(building, target);
    const range = resolveLaunchRange(building, rules);
    return distance >= range.minimum && distance <= range.maximum;
}

function deterministicBuildingOrder(a: EmpulseBuilding, b: EmpulseBuilding): number {
    const aId = typeof a.id === "number" ? a.id : Number(a.id);
    const bId = typeof b.id === "number" ? b.id : Number(b.id);
    if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) {
        return aId - bId;
    }
    const aTile = buildingTile(a);
    const bTile = buildingTile(b);
    if (aTile && bTile && (aTile.rx !== bTile.rx || aTile.ry !== bTile.ry)) {
        return aTile.rx - bTile.rx || aTile.ry - bTile.ry;
    }
    return normalize(buildingName(a)).localeCompare(normalize(buildingName(b)));
}

/**
 * Selects the cannons used by one EMPulse activation. The returned order is
 * stable so SW.MaxCount and lockstep/replay behavior do not depend on Set
 * insertion or object enumeration order.
 */
export function selectAresEmpulseLaunchSites(
    buildings: Iterable<EmpulseBuilding>,
    rules: Pick<AresSuperWeaponDefinition, "extensionType" | "empulseCannons" | "empulseTargetSelf" | "empulseLinked" | "swMaxCount" | "swRangeMinimum" | "swRangeMaximum">,
    target: TileLike,
    options: AresEmpulseLaunchSiteOptions = {},
): EmpulseBuilding[] {
    const candidates = [...buildings]
        .filter(building => isAresEmpulseLaunchSite(building, rules, options))
        .sort(deterministicBuildingOrder);
    // EMPulse's type initializer overrides the common Ares SW.MaxCount
    // default to one. A negative authored value explicitly opts into all
    // eligible cannons; zero intentionally fires none.
    const maximum = rules.swMaxCount === undefined
        ? rules.extensionType === "EMPulse" ? 1 : Number.POSITIVE_INFINITY
        : rules.swMaxCount < 0
            ? Number.POSITIVE_INFINITY
            : Math.max(0, Math.floor(rules.swMaxCount));

    if (rules.empulseTargetSelf) {
        return candidates.slice(0, maximum);
    }

    const inRange = candidates.filter(building =>
        isAresEmpulseLaunchSiteInRange(building, target, rules));

    // Linked mode uses one in-range cannon as the launch-site check, then
    // allows every eligible cannon to fire at the selected target.
    if (rules.empulseLinked) {
        return inRange.length > 0 ? candidates.slice(0, maximum) : [];
    }
    return inRange.slice(0, maximum);
}

function detonateAtBuilding(
    game: any,
    owner: any,
    building: EmpulseBuilding,
    weapon: EmpulseWeapon,
): void {
    const tile = buildingTile(building);
    if (!tile || !weapon.warhead?.detonate) return;
    const bridge = game.map?.tileOccupation?.getBridgeOnTile?.(tile);
    const elevation = bridge?.tileElevation ?? building.tileElevation ?? tile.z ?? 0;
    const zone = game.map?.getTileZone?.(tile) ?? building.zone ?? 0;
    const center = Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, (tile.z ?? 0) + elevation);
    weapon.warhead.detonate(
        game,
        weapon.rules?.damage ?? 0,
        tile,
        elevation,
        center,
        zone,
        bridge ? CollisionType.OnBridge : CollisionType.None,
        game.createTarget(bridge, tile),
        { player: owner, obj: building, weapon },
        false,
        undefined,
    );
}

/**
 * Standalone implementation of Antares' Type=EMPulse launch state. The
 * original DLL queues a missile mission on each selected cannon; this host
 * uses the cannon's normal Weapon object for the projectile path and invokes
 * the same warhead directly for EMPulse.TargetSelf, whose Antares path
 * detonates immediately at each cannon.
 */
export class EMPulseEffect extends SuperWeaponEffect {
    private launchSites: EmpulseBuilding[] = [];
    private pendingFrames = 0;
    private launched = false;

    constructor(
        type: any,
        owner: any,
        tile: TileCoord,
        private readonly rules: AresSuperWeaponDefinition,
        private readonly superWeapon?: any,
    ) {
        super(type, owner, tile);
    }

    onStart(game: any): void {
        this.launchSites = selectAresEmpulseLaunchSites(
            this.owner?.buildings ?? [],
            this.rules,
            this.tile,
            { superWeapon: this.superWeapon },
        );

        if (this.rules.empulseTargetSelf) {
            this.launch(true, game);
            return;
        }

        this.pendingFrames = Math.max(0, Math.floor(this.rules.empulsePulseDelay ?? 32));
        if (this.pendingFrames === 0) {
            this.launch(false, game);
        }
    }

    onTick(game: any): boolean {
        if (this.launched) return true;
        if (this.pendingFrames > 0) {
            this.pendingFrames--;
            if (this.pendingFrames > 0) return false;
        }
        this.launch(false, game);
        return true;
    }

    private launch(targetSelf: boolean, game: any): void {
        if (this.launched) return;
        this.launched = true;
        for (const building of this.launchSites) {
            const weapon = getLaunchWeapon(building);
            if (!weapon) continue;
            if (targetSelf) {
                detonateAtBuilding(game, this.owner, building, weapon);
            }
            else {
                weapon.expireCooldown?.();
                weapon.fire?.(game.createTarget(undefined, this.tile), game);
            }
        }
    }
}
