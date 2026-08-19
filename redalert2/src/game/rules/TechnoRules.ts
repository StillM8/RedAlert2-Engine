import { ObjectType } from "@/engine/type/ObjectType";
import { SideType } from "@/game/SideType";
import { SpeedType } from "@/game/type/SpeedType";
import { PipColor } from "@/game/type/PipColor";
import { LocomotorType, resolveLocomotorType } from "@/game/type/LocomotorType";
import { MovementZone, movementZoneAliases } from "@/game/type/MovementZone";
import { ArmorType } from "@/game/type/ArmorType";
import { LandTargeting } from "@/game/type/LandTargeting";
import { NavalTargeting } from "@/game/type/NavalTargeting";
import { ObjectRules } from "@/game/rules/ObjectRules";
import { WeaponType } from "@/game/WeaponType";
import { VeteranAbility } from "@/game/gameobject/unit/VeteranAbility";
import { VhpScan } from "@/game/type/VhpScan";
import { Vector3 } from "@/game/math/Vector3";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import type { AresSideRegistry, SideId } from "@/extensions/ares/AresSides";
import { parseAresPrerequisiteRules } from "@/extensions/ares/AresPrerequisites";
import { defaultAresEmpImmunity, parseAresEmpThreshold } from "@/extensions/ares/AresEMP";
import { parseAresTechnoExtensions } from "@/extensions/ares/AresTechnoExtensions";
import type { AresTechnoExtensions } from "@/extensions/ares/AresTechnoExtensions";
import { parseAresUrbanCombatBuildingRules } from "@/extensions/ares/AresUrbanCombat";
import type { AresUrbanCombatBuildingRules } from "@/extensions/ares/AresUrbanCombat";
import { parseAresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import { parseAresChronoshiftRules } from "@/extensions/ares/AresChronoshift";
import type { AresChronoshiftRules } from "@/extensions/ares/AresChronoshift";
import { resolveAresDamageParticleSelection } from "@/extensions/ares/AresDamageParticles";
import type { AresDamageParticleSelection } from "@/extensions/ares/AresDamageParticles";
import { getAresSuperWeaponProviderNames, hasAresSuperWeaponProvider } from "@/extensions/ares/AresSuperWeaponProviders";
import { parseAresInsigniaRules, resolveAresInsigniaShowEnemy } from "@/extensions/ares/AresInsignia";
import type { AresInsigniaRules } from "@/extensions/ares/AresInsignia";
import { parseAresBountyTechnoRules } from "@/extensions/ares/AresBounty";
import type { AresBountyTechnoRules } from "@/extensions/ares/AresBounty";
import { parseAresVeterancyRules } from "@/extensions/ares/AresVeterancy";
import type { AresVeterancyRules } from "@/extensions/ares/AresVeterancy";
import { parseAresChronoPrisonTechno } from "@/extensions/ares/AresChronoPrisons";
import type { AresChronoPrisonTechnoRules } from "@/extensions/ares/AresChronoPrisons";
import { resolveAresParticleSystems } from "@/extensions/ares/AresParticleSystems";
import type { AresParticleSystemRules } from "@/extensions/ares/AresParticleSystems";
interface House {
    name: string;
}
function normalizeHouseName(name: string): string {
    return name.trim().toLocaleLowerCase("en-US");
}
export enum BuildCat {
    Combat = 0,
    Tech = 1,
    Resource = 2,
    Power = 3
}
export enum FactoryType {
    None = 0,
    BuildingType = 1,
    InfantryType = 2,
    UnitType = 3,
    NavalUnitType = 4,
    AircraftType = 5
}
export class TechnoRules extends ObjectRules {
    static readonly MAX_SIGHT = 11;
    declare owner: string[];
    /** Legacy numeric adapter retained for vanilla UI/AI ordering. */
    declare aiBasePlanningSide?: number;
    /** Stable content-defined side identity used by extension-aware runtime paths. */
    declare aiBasePlanningSideId?: SideId;
    declare requiredHouses: string[];
    declare forbiddenHouses: string[];
    declare requiresStolenAlliedTech: boolean;
    declare requiresStolenSovietTech: boolean;
    declare requiresStolenThirdTech: boolean;
    declare techLevel: number;
    declare cost: number;
    declare points: number;
    declare power: number;
    declare powered: boolean;
    declare poweredUnit: boolean;
    declare powersUnit?: string;
    /** Ares Operator= accepts specific InfantryTypes or the _ANY_ sentinel. */
    declare operator?: string[];
    declare operatorAny: boolean;
    /** Ares Killing Drivers: this vehicle/aircraft cannot lose its driver. */
    declare protectedDriver: boolean;
    /** Antares extension: health fraction below which a protected driver may be killed. */
    declare protectedDriverMinHealth?: number;
    /** Ares Killing Drivers: infantry can reclaim a driverless vehicle. */
    declare canDrive: boolean;
    /** Ares Killing Drivers: this vehicle/aircraft can be reclaimed. */
    declare canBeDriven: boolean;
    /** Ares restored Vehicle Thief: infantry can take eligible enemy vehicles. */
    declare vehicleThief: boolean;
    /** Optional Ares custom SHP/frame selection by veterancy rank. */
    declare aresInsignia?: AresInsigniaRules;
    /** Effective Ares [General]/[TechnoType] insignia enemy visibility. */
    declare insigniaShowEnemy: boolean;
    /** Optional generic Ares bounty behavior for this TechnoType. */
    declare aresBounty?: AresBountyTechnoRules;
    /** Ares customizable-veterancy source attribution rules. */
    declare aresVeterancy: AresVeterancyRules;
    /** Ares VehicleThief target-side opt-out. */
    declare hijackerAllowed: boolean;
    /** Ares VehicleThief: whether mind control may be broken during hijacking. */
    declare hijackerBreakMindControl: boolean;
    /** Ares VehicleThief: consume the thief permanently instead of recovering it. */
    declare hijackerOneTime: boolean;
    /** Ares VehicleThief: number of crew/pilots removed before survivor handling. */
    declare hijackerKillPilots: number;
    declare hijackerEnterSound?: string;
    declare hijackerLeaveSound?: string;
    declare prerequisite: string[];
    /** Ares alternative prerequisite lists; list entries are ANDed. */
    declare prerequisiteLists: string[][];
    declare negativePrerequisite: string[];
    declare requiredTheaters: string[];
    declare stolenTechs: number[];
    declare factoryOwners: string[];
    declare factoryOwnersForbidden: string[];
    /** BuildingType: grants all factory plans of its initial owner while held. */
    declare factoryOwnersHasAllPlans: boolean;
    /** BuildingType: captured plans remain available after the building is lost. */
    declare factoryOwnersPermanent: boolean;
    /** Ares BuildingType: enables reverse-engineering in a Grinding facility. */
    declare reverseEngineersVictims: boolean;
    /** Ares InfantryType/VehicleType: permits this unit to be reversed. */
    declare canBeReversed: boolean;
    /** Ares reverse-engineering output override; undefined means the unit itself. */
    declare reversedAs?: string;
    /** Ares custom spy effect that clears the target player's reverse plans. */
    declare spyEffectCustom: boolean;
    declare spyEffectUndoReverseEngineer: boolean;
    declare soylent: number;
    declare crateGoodie: boolean;
    declare buildCat: BuildCat;
    declare adjacent: number;
    declare baseNormal: boolean;
    declare buildLimit: number;
    declare airRangeBonus: number;
    declare guardRange: number;
    declare defaultToGuardArea: boolean;
    declare eligibileForAllyBuilding: boolean;
    declare numberImpassableRows: number;
    declare bridgeRepairHut: boolean;
    declare constructionYard: boolean;
    declare refinery: boolean;
    declare dockUnload: boolean;
    declare enslaves?: string;
    declare slavesNumber: number;
    declare slaved: boolean;
    declare unitRepair: boolean;
    declare unitReload: boolean;
    declare unitSell: boolean;
    declare isBaseDefense: boolean;
    declare superWeapon?: string;
    /** Ares/vanilla second superweapon provider slot. */
    declare superWeapon2?: string;
    /** Ares ordered additional superweapon provider slots. */
    declare superWeapons: string[];
    declare chargedAnimTime: number;
    declare naval: boolean;
    declare underwater: boolean;
    declare waterBound: boolean;
    declare orePurifier: boolean;
    declare cloning: boolean;
    declare grinding: boolean;
    declare nukeSilo: boolean;
    declare repairable: boolean;
    declare clickRepairable: boolean;
    declare unsellable: boolean;
    declare returnable: boolean;
    declare gdiBarracks: boolean;
    declare nodBarracks: boolean;
    declare numberOfDocks: number;
    declare factory: FactoryType;
    declare weaponsFactory: boolean;
    declare helipad: boolean;
    declare hospital: boolean;
    declare landTargeting: LandTargeting;
    declare navalTargeting: NavalTargeting;
    declare tooBigToFitUnderBridge: boolean;
    declare bunker: boolean;
    declare canBeOccupied: boolean;
    declare maxNumberOccupants: number;
    declare occupantsPowerBonus: number;
    declare leaveRubble: boolean;
    declare undeploysInto: string;
    declare deploysInto: string;
    declare deployTime: number;
    declare capturable: boolean;
    declare spyable: boolean;
    declare needsEngineer: boolean;
    declare c4: boolean;
    declare canC4: boolean;
    declare eligibleForDelayKill: boolean;
    declare produceCashStartup: number;
    declare produceCashAmount: number;
    declare produceCashDelay: number;
    declare explosion: string[];
    declare explodes: boolean;
    declare ifvMode: number;
    declare turretIndexesByIfvMode: Map<number, number>;
    /** Optional Ares TechnoType data; absent when no Ares Techno fields are authored. */
    declare ares?: AresTechnoExtensions;
    /** Optional generic Ares Urban Combat and advanced-rubble data. */
    declare aresUrbanCombat?: AresUrbanCombatBuildingRules;
    /** Optional generic Ares AttachEffect data authored on this TechnoType. */
    declare aresAttachEffect?: AresAttachEffectDefinition;
    /** Optional Ares Chronoshift eligibility data authored on this TechnoType. */
    declare aresChronoshift?: AresChronoshiftRules;
    /** Generic Ares Chrono Prison eligibility and turret behavior. */
    declare aresChronoPrison: AresChronoPrisonTechnoRules;
    /** Optional Ares damage-particle precedence resolved from this TechnoType. */
    declare aresDamageParticles?: AresDamageParticleSelection;
    /** Resolved vanilla DamageParticleSystems with their Ares definitions. */
    declare damageParticleSystemDefinitions: AresParticleSystemRules[];
    /** Smoke candidates after the retail/Ares BehavesLike filter. */
    declare damageSmokeParticleSystemDefinitions: AresParticleSystemRules[];
    /** Spark candidates after the retail/Ares BehavesLike filter. */
    declare damageSparksParticleSystemDefinitions: AresParticleSystemRules[];
    /** Effective DamageSparks flag, including the infantry/Cyborg default. */
    declare damageSparksEnabled: boolean;
    declare turret: boolean;
    declare turretCount: number;
    declare turretAnim: string;
    declare turretAnimIsVoxel: boolean;
    declare turretAnimX: number;
    declare turretAnimY: number;
    declare turretAnimZAdjust: number;
    declare isChargeTurret: boolean;
    declare overpowerable: boolean;
    declare freeUnit: string;
    declare primary?: string;
    declare secondary?: string;
    declare elitePrimary?: string;
    declare eliteSecondary?: string;
    declare weaponCount: number;
    declare isGattling: boolean;
    declare weaponStages: number;
    declare rateUp: number;
    declare rateDown: number;
    declare deathWeapon?: string;
    declare deathWeaponDamageModifier: number;
    declare occupyWeapon?: string;
    declare eliteOccupyWeapon?: string;
    declare veteranAbilities: Set<VeteranAbility>;
    declare eliteAbilities: Set<VeteranAbility>;
    declare selfHealing: boolean;
    declare wall: boolean;
    /** Ares Firestorm.Wall; separate from ordinary wall terrain/connection rules. */
    declare firestormWall: boolean;
    declare gate: boolean;
    declare armor: ArmorType;
    declare strength: number;
    declare immune: boolean;
    declare immuneToRadiation: boolean;
    declare immuneToPsionics: boolean;
    /** Antares Firestorm contact immunity for FootClass objects. */
    declare ignoresFirestorm: boolean;
    /** Ares EMP immunity and target-specific duration modifier. */
    declare immuneToEMP: boolean;
    declare empModifier: number;
    /** Ares EMP.Threshold; destruction handling is integrated separately. */
    declare empThreshold: number;
    /** Ares BuildingType flag for the default EMPulse launch-site path. */
    declare empulseCannon: boolean;
    declare typeImmune: boolean;
    declare warpable: boolean;
    declare isTilter: boolean;
    declare walkRate: number;
    declare idleRate: number;
    declare noSpawnAlt: boolean;
    declare crusher: boolean;
    declare consideredAircraft: boolean;
    declare crashable: boolean;
    declare landable: boolean;
    declare airportBound: boolean;
    declare balloonHover: boolean;
    declare hoverAttack: boolean;
    declare omniFire: boolean;
    declare fighter: boolean;
    declare flightLevel?: number;
    declare locomotor: LocomotorType;
    /** Authored CLSID, retained when the generic runtime does not support it. */
    declare locomotorClsId?: string;
    /** Ares Tunnel locomotor dig-in presentation override. */
    declare digIn?: string;
    /** Ares Tunnel locomotor dig-out presentation override. */
    declare digOut?: string;
    /** Ares Tunnel locomotor dig-in sound override. */
    declare digInSound?: string;
    /** Ares Tunnel locomotor dig-out sound override. */
    declare digOutSound?: string;
    declare speedType?: SpeedType;
    declare speed: number;
    declare movementZone: MovementZone;
    declare fearless: boolean;
    declare deployer: boolean;
    declare deployFire: boolean;
    declare deployFireWeapon: number;
    declare undeployDelay: number;
    declare fraidycat: boolean;
    declare isHuman: boolean;
    declare organic: boolean;
    declare occupier: boolean;
    declare engineer: boolean;
    declare ivan: boolean;
    declare civilian: boolean;
    declare agent: boolean;
    declare infiltrate: boolean;
    declare threatPosed: number;
    declare specialThreatValue: number;
    declare canPassiveAquire: boolean;
    declare canRetaliate: boolean;
    declare preventAttackMove: boolean;
    declare opportunityFire: boolean;
    declare distributedFire: boolean;
    declare radialFireSegments: number;
    declare attackCursorOnFriendlies: boolean;
    declare bombable: boolean;
    declare trainable: boolean;
    declare crewed: boolean;
    declare parasiteable: boolean;
    declare suppressionThreshold: number;
    declare reselectIfLimboed: boolean;
    declare rejoinTeamIfLimboed: boolean;
    declare weight: number;
    declare accelerates: boolean;
    declare accelerationFactor: number;
    declare teleporter: boolean;
    declare canDisguise: boolean;
    declare disguiseWhenStill: boolean;
    declare permaDisguise: boolean;
    declare detectDisguise: boolean;
    declare detectDisguiseRange: number;
    declare cloakable: boolean;
    declare sensors: boolean;
    declare sensorArray: boolean;
    declare sensorsSight: number;
    declare burstDelay: (number | undefined)[];
    declare vhpScan: VhpScan;
    declare pip: PipColor;
    declare passengers: number;
    declare gunner: boolean;
    declare openTopped: boolean;
    declare ammo: number;
    declare initialAmmo: number;
    declare manualReload: boolean;
    declare storage: number;
    declare spawned: boolean;
    declare spawns: string;
    declare airstrikeTeam: number;
    declare eliteAirstrikeTeam: number;
    declare airstrikeTeamType: string;
    declare eliteAirstrikeTeamType: string;
    /** Ares Hunter Seeker per-Aircraft flight/targeting controls. */
    declare hunterSeekerDetonateProximity: number;
    declare hunterSeekerDescendProximity: number;
    declare hunterSeekerAscentSpeed: number;
    declare hunterSeekerDescentSpeed: number;
    declare hunterSeekerEmergeSpeed: number;
    declare hunterSeekerIgnore: boolean;
    declare spawnsNumber: number;
    declare spawnRegenRate: number;
    declare spawnReloadRate: number;
    declare missileSpawn: boolean;
    declare size: number;
    declare sizeLimit: number;
    declare sight: number;
    /** Ares SW.Designators range; defaults to Sight. */
    declare designatorRange: number;
    /** Ares SW.Inhibitors range; defaults to Sight. */
    declare inhibitorRange: number;
    declare spySat: boolean;
    declare gapGenerator: boolean;
    declare gapRadiusInCells: number;
    declare psychicDetectionRadius: number;
    declare hasRadialIndicator: boolean;
    declare harvester: boolean;
    declare unloadingClass: string;
    declare dock: string[];
    declare radar: boolean;
    declare radarInvisible: boolean;
    declare revealToAll: boolean;
    declare selectable: boolean;
    declare isSelectableCombatant: boolean;
    declare invisibleInGame: boolean;
    declare moveToShroud: boolean;
    declare leadershipRating: number;
    declare unnatural: boolean;
    declare natural: boolean;
    declare buildTimeMultiplier: number;
    declare allowedToStartInMultiplayer: boolean;
    declare rot: number;
    declare jumpjetAccel: number;
    declare jumpjetClimb: number;
    declare jumpjetCrash: number;
    declare jumpjetDeviation: number;
    declare jumpjetHeight: number;
    declare jumpjetNoWobbles: boolean;
    declare jumpjetSpeed: number;
    declare jumpjetTurnRate: number;
    declare jumpjetWobbles: number;
    declare pitchSpeed: number;
    declare pitchAngle: number;
    declare damageParticleSystems: string[];
    declare damageSmokeOffset: Vector3;
    declare minDebris: number;
    declare maxDebris: number;
    declare debrisTypes: string[];
    declare debrisAnims: string[];
    declare isLightpost: boolean;
    declare lightVisibility: number;
    declare lightIntensity: number;
    declare lightRedTint: number;
    declare lightGreenTint: number;
    declare lightBlueTint: number;
    declare ambientSound?: string;
    declare createSound?: string;
    declare slamSound?: string;
    declare deploySound?: string;
    declare undeploySound?: string;
    declare voiceSelect?: string;
    declare voiceMove?: string;
    declare voiceAttack?: string;
    declare voiceFeedback?: string;
    declare voiceSpecialAttack?: string;
    declare voiceEnter?: string;
    declare voiceCapture?: string;
    declare voiceCrashing?: string;
    declare crashingSound?: string;
    declare impactLandSound?: string;
    declare auxSound1?: string;
    declare auxSound2?: string;
    declare dieSound?: string;
    declare moveSound?: string;
    declare enterWaterSound?: string;
    declare leaveWaterSound?: string;
    declare turretRotateSound?: string;
    declare workingSound?: string;
    declare notWorkingSound?: string;
    declare chronoInSound?: string;
    declare chronoOutSound?: string;
    declare enterTransportSound?: string;
    declare leaveTransportSound?: string;
    constructor(e: any, t: any, i: any, r: any, armorRegistry?: ArmorRegistry, sideRegistry?: AresSideRegistry) {
        super(e, t, i, r, armorRegistry);
        this.sideRegistry = sideRegistry;
    }
    private sideRegistry?: AresSideRegistry;
    parse(): void {
        super.parse();
        this.owner = this.ini.getArray("Owner");
        this.aresInsignia = parseAresInsigniaRules(
            this.ini,
            this.generalRules?.enemyInsignia ?? true,
        );
        this.insigniaShowEnemy = resolveAresInsigniaShowEnemy(
            this.ini,
            this.generalRules?.enemyInsignia ?? true,
        );
        const aiBasePlanningValue = this.ini.getNumber("AIBasePlanningSide", -1);
        const planningSide = this.sideRegistry?.resolveByIndex(aiBasePlanningValue);
        if (planningSide) {
            this.aiBasePlanningSideId = planningSide.id;
            // Keep the authored index for legacy sort/order consumers. The
            // stable ID is the authoritative value for extension runtime.
            this.aiBasePlanningSide = planningSide.index ?? planningSide.order;
        }
        else if (!this.sideRegistry && aiBasePlanningValue >= 0 && void 0 !== SideType[aiBasePlanningValue]) {
            // Standalone/unit tests that construct TechnoRules without the
            // Rules-owned registry retain the historical vanilla behavior.
            this.aiBasePlanningSide = aiBasePlanningValue;
        }
        else {
            this.aiBasePlanningSide = undefined;
            this.aiBasePlanningSideId = undefined;
        }
        this.requiredHouses = this.ini.getArray("RequiredHouses");
        this.forbiddenHouses = this.ini.getArray("ForbiddenHouses");
        this.requiresStolenAlliedTech = this.ini.getBool("RequiresStolenAlliedTech");
        this.requiresStolenSovietTech = this.ini.getBool("RequiresStolenSovietTech");
        this.requiresStolenThirdTech = this.ini.getBool("RequiresStolenThirdTech");
        this.techLevel = this.ini.getNumber("TechLevel", -1);
        this.cost = this.ini.getNumber("Cost");
        this.points = this.ini.getNumber("Points");
        this.power = this.ini.getNumber("Power");
        this.powered = this.ini.getBool("Powered");
        // Retail YR: [ROBO] PoweredUnit=yes, [GAROBO] PowersUnit=ROBO.
        this.poweredUnit = this.ini.getBool("PoweredUnit");
        this.powersUnit = this.ini.getString("PowersUnit") || undefined;
        const operatorTypes = this.ini.getArray("Operator");
        this.operatorAny = operatorTypes.some((value) => value.trim().toLocaleLowerCase("en-US") === "_any_");
        this.operator = operatorTypes.filter((value) => value.trim() && value.trim().toLocaleLowerCase("en-US") !== "_any_");
        this.protectedDriver = this.ini.getBool("ProtectedDriver");
        this.protectedDriverMinHealth = this.ini.has("ProtectedDriver.MinHealth")
            ? this.ini.getNumber("ProtectedDriver.MinHealth")
            : undefined;
        this.canDrive = this.ini.getBool("CanDrive");
        this.canBeDriven = this.ini.getBool("CanBeDriven", true);
        this.vehicleThief = this.ini.getBool("VehicleThief");
        this.hijackerAllowed = this.ini.getBool("VehicleThief.Allowed", true);
        this.hijackerBreakMindControl = this.ini.getBool("VehicleThief.BreakMindControl", true);
        this.hijackerOneTime = this.ini.getBool("VehicleThief.OneTime");
        this.hijackerKillPilots = this.ini.getNumber("VehicleThief.KillPilots", 0);
        this.hijackerEnterSound = this.ini.getString("VehicleThief.EnterSound") || undefined;
        this.hijackerLeaveSound = this.ini.getString("VehicleThief.LeaveSound") || undefined;
        this.aresBounty = parseAresBountyTechnoRules(this.ini);
        this.aresVeterancy = parseAresVeterancyRules(this.ini);
        this.aresChronoPrison = parseAresChronoPrisonTechno(this.ini);
        const prerequisiteRules = parseAresPrerequisiteRules(this.ini);
        this.prerequisiteLists = prerequisiteRules.alternativeLists;
        this.prerequisite = this.prerequisiteLists[0] ?? [];
        this.negativePrerequisite = prerequisiteRules.negative;
        this.requiredTheaters = prerequisiteRules.requiredTheaters;
        this.stolenTechs = prerequisiteRules.stolenTechs;
        this.factoryOwners = prerequisiteRules.factoryOwners;
        this.factoryOwnersForbidden = prerequisiteRules.factoryOwnersForbidden;
        this.factoryOwnersHasAllPlans = this.ini.getBool("FactoryOwners.HasAllPlans");
        this.factoryOwnersPermanent = this.ini.getBool("FactoryOwners.Permanent");
        this.reverseEngineersVictims = this.type === ObjectType.Building &&
            this.ini.getBool("ReverseEngineersVictims");
        this.canBeReversed = [ObjectType.Infantry, ObjectType.Vehicle].includes(this.type)
            ? this.ini.getBool("CanBeReversed", true)
            : false;
        const reversedAs = this.ini.getString("ReversedAs").trim();
        this.reversedAs = reversedAs && reversedAs.toLocaleLowerCase("en-US") !== "none"
            ? reversedAs
            : undefined;
        this.spyEffectCustom = this.type === ObjectType.Building &&
            this.ini.getBool("SpyEffect.Custom");
        this.spyEffectUndoReverseEngineer = this.type === ObjectType.Building &&
            this.ini.getBool("SpyEffect.UndoReverseEngineer");
        this.soylent = this.ini.getNumber("Soylent");
        this.crateGoodie = this.ini.getBool("CrateGoodie");
        this.buildCat = this.ini.getEnum("BuildCat", BuildCat, BuildCat.Combat);
        this.adjacent = this.ini.getNumber("Adjacent", 1);
        this.baseNormal = this.ini.getBool("BaseNormal", true);
        this.buildLimit = this.ini.getNumber("BuildLimit", Number.POSITIVE_INFINITY);
        this.airRangeBonus = this.ini.getNumber("AirRangeBonus");
        this.guardRange = this.ini.getNumber("GuardRange");
        this.defaultToGuardArea = this.ini.getBool("DefaultToGuardArea");
        this.eligibileForAllyBuilding = this.ini.getBool("EligibileForAllyBuilding");
        this.numberImpassableRows = this.ini.getNumber("NumberImpassableRows");
        this.bridgeRepairHut = this.ini.getBool("BridgeRepairHut");
        this.constructionYard = this.ini.getBool("ConstructionYard");
        this.refinery = this.ini.getBool("Refinery");
        this.unitRepair = this.ini.getBool("UnitRepair");
        this.unitReload = this.ini.getBool("UnitReload");
        this.unitSell = this.ini.getBool("UnitSell");
        this.isBaseDefense = this.ini.getBool("IsBaseDefense");
        this.superWeapon = this.parseWeaponName(this.ini.getString("SuperWeapon"));
        this.superWeapon2 = this.parseWeaponName(this.ini.getString("SuperWeapon2"));
        this.superWeapons = getAresSuperWeaponProviderNames({
            superWeapons: this.ini.getArray("SuperWeapons"),
        });
        this.chargedAnimTime = this.ini.getNumber("ChargedAnimTime");
        const naval = this.ini.getBool("Naval");
        this.naval = naval;
        this.underwater = this.ini.getBool("Underwater");
        this.waterBound = this.ini.getBool("WaterBound");
        this.orePurifier = this.ini.getBool("OrePurifier");
        this.cloning = this.ini.getBool("Cloning");
        this.grinding = this.ini.getBool("Grinding");
        this.nukeSilo = this.ini.getBool("NukeSilo");
        this.repairable = this.ini.getBool("Repairable", this.type === ObjectType.Building);
        this.clickRepairable = this.ini.getBool("ClickRepairable", this.type === ObjectType.Building);
        this.unsellable = this.ini.getBool("Unsellable", this.type !== ObjectType.Building && this.generalRules.unitsUnsellable);
        this.returnable = this.ini.getBool("Returnable", this.generalRules.returnStructures);
        this.gdiBarracks = this.ini.getBool("GDIBarracks");
        this.nodBarracks = this.ini.getBool("NODBarracks");
        this.numberOfDocks = this.ini.getNumber("NumberOfDocks");
        if (this.unitRepair && !this.numberOfDocks) {
            this.numberOfDocks = 1;
        }
        this.factory = this.ini.getEnum("Factory", FactoryType, FactoryType.None);
        if (this.factory === FactoryType.UnitType && naval) {
            this.factory = FactoryType.NavalUnitType;
        }
        this.weaponsFactory = this.ini.getBool("WeaponsFactory");
        this.helipad = this.ini.getBool("Helipad");
        this.hospital = this.ini.getBool("Hospital");
        this.landTargeting = this.ini.getEnumNumeric("LandTargeting", LandTargeting, LandTargeting.LandOk);
        this.navalTargeting = this.ini.getEnumNumeric("NavalTargeting", NavalTargeting, NavalTargeting.UnderwaterNever);
        this.tooBigToFitUnderBridge = this.ini.getBool("TooBigToFitUnderBridge", this.type === ObjectType.Building);
        this.bunker = this.ini.getBool("Bunker");
        this.canBeOccupied = this.ini.getBool("CanBeOccupied");
        this.maxNumberOccupants = this.ini.getNumber("MaxNumberOccupants");
        // Yuri's Bio Reactor battery is hardcoded in the retail exe: rulesmd.ini
        // gives YAPOWR no occupancy keys at all, yet it holds 5 infantry at
        // +100 power each.
        this.occupantsPowerBonus = 0;
        if (this.name === "YAPOWR") {
            this.canBeOccupied = true;
            if (!this.maxNumberOccupants) {
                this.maxNumberOccupants = 5;
            }
            this.occupantsPowerBonus = 100;
        }
        this.leaveRubble = this.ini.getBool("LeaveRubble");
        this.undeploysInto = this.ini.getString("UndeploysInto");
        this.deploysInto = this.ini.getString("DeploysInto");
        this.deployTime = this.ini.getNumber("DeployTime");
        this.capturable = this.ini.getBool("Capturable");
        this.spyable = this.ini.getBool("Spyable");
        this.needsEngineer = this.ini.getBool("NeedsEngineer");
        this.c4 = this.ini.getBool("C4");
        this.canC4 = this.ini.getBool("CanC4", true);
        this.eligibleForDelayKill = this.ini.getBool("EligibleForDelayKill");
        this.produceCashStartup = this.ini.getNumber("ProduceCashStartup");
        this.produceCashAmount = this.ini.getNumber("ProduceCashAmount");
        this.produceCashDelay = this.ini.getNumber("ProduceCashDelay");
        this.explosion = this.ini.getArray("Explosion");
        this.explodes = this.ini.getBool("Explodes");
        this.ifvMode = this.ini.getNumber("IFVMode");
        this.turretIndexesByIfvMode = this.parseTurretIndexes();
        const hasAresTechnoFields = [...this.ini.entries.keys()].some((key: string) => {
            const normalized = key.trim().toLocaleLowerCase("en-US");
            return normalized === "poweredby" ||
                normalized === "voiceifvrepair" ||
                normalized === "parachute.anim" ||
                normalized === "nomanualfire" ||
                normalized === "noselfguardarea" ||
                /^weaponturretindex\d+$/.test(normalized) ||
                /^weaponuiname\d+$/.test(normalized);
        });
        this.ares = hasAresTechnoFields ? parseAresTechnoExtensions(this.ini) : undefined;
        const normalizedAresKeys = [...this.ini.entries.keys()].map((key: string) =>
            key.trim().toLocaleLowerCase("en-US"));
        const findAresEntryKey = (key: string): string | undefined => {
            const expected = key.trim().toLocaleLowerCase("en-US");
            let matched: string | undefined;
            for (const entryKey of this.ini.entries.keys()) {
                if (entryKey.trim().toLocaleLowerCase("en-US") === expected) {
                    matched = entryKey;
                }
            }
            return matched;
        };
        const getAresArray = (key: string): string[] | undefined => {
            const entryKey = findAresEntryKey(key);
            return entryKey === undefined ? undefined : this.ini.getArray(entryKey);
        };
        const getAresBool = (key: string): boolean | undefined => {
            const entryKey = findAresEntryKey(key);
            return entryKey === undefined ? undefined : this.ini.getBool(entryKey);
        };
        const hasAresUrbanCombatFields = normalizedAresKeys.some((key: string) =>
            key === "uc.passthrough" ||
            key === "uc.fatalrate" ||
            key === "uc.damagemultiplier" ||
            key === "bunker.raidable" ||
            key === "istrench" ||
            key === "canbeoccupiedby" ||
            key === "rubble.destroyed" ||
            key.startsWith("rubble.destroyed.") ||
            key === "rubble.intact" ||
            key.startsWith("rubble.intact."));
        this.aresUrbanCombat = hasAresUrbanCombatFields
            ? parseAresUrbanCombatBuildingRules(this.ini)
            : undefined;
        const hasAresAttachEffectFields = normalizedAresKeys.some((key: string) =>
            key.startsWith("attacheffect."));
        this.aresAttachEffect = hasAresAttachEffectFields
            ? parseAresAttachEffectDefinition(this.ini)
            : undefined;
        const hasAresChronoshiftFields = normalizedAresKeys.some((key: string) =>
            key === "chronoshift.allow" ||
            key === "chronoshift.isvehicle" ||
            key === "chronoshift.crushable");
        this.aresChronoshift = hasAresChronoshiftFields
            ? parseAresChronoshiftRules(this.ini)
            : undefined;
        this.turret = this.ini.getBool("Turret");
        this.turretCount = this.ini.getNumber("TurretCount", this.turret ? 1 : 0);
        this.turretAnim = this.ini.getString("TurretAnim");
        this.turretAnimIsVoxel = this.ini.getBool("TurretAnimIsVoxel");
        this.turretAnimX = this.ini.getNumber("TurretAnimX");
        this.turretAnimY = this.ini.getNumber("TurretAnimY");
        this.turretAnimZAdjust = this.ini.getNumber("TurretAnimZAdjust");
        this.isChargeTurret = this.ini.getBool("IsChargeTurret");
        this.overpowerable = this.ini.getBool("Overpowerable");
        this.freeUnit = this.ini.getString("FreeUnit");
        this.primary = this.parseWeaponName(this.ini.getString("Primary"));
        this.secondary = this.parseWeaponName(this.ini.getString("Secondary"));
        this.elitePrimary = this.parseWeaponName(this.ini.getString("ElitePrimary"));
        this.eliteSecondary = this.parseWeaponName(this.ini.getString("EliteSecondary"));
        this.weaponCount = this.ini.getNumber("WeaponCount");
        // Gattling weapons (YTNK, YAGGUN): WeaponCount slots split into
        // WeaponStages pairs — odd slots anti-ground, even slots anti-air —
        // escalating while firing (RateUp/frame) and spinning down when idle.
        this.isGattling = this.ini.getBool("IsGattling");
        this.weaponStages = this.ini.getNumber("WeaponStages", 1);
        this.rateUp = this.ini.getNumber("RateUp", 1);
        this.rateDown = this.ini.getNumber("RateDown", 50);
        this.deathWeapon = this.parseWeaponName(this.ini.getString("DeathWeapon"));
        this.deathWeaponDamageModifier = this.ini.getNumber("DeathWeaponDamageModifier", 1);
        this.occupyWeapon = this.parseWeaponName(this.ini.getString("OccupyWeapon"));
        this.eliteOccupyWeapon = this.parseWeaponName(this.ini.getString("EliteOccupyWeapon"));
        this.veteranAbilities = new Set(this.ini.getEnumArray("VeteranAbilities", VeteranAbility));
        this.eliteAbilities = new Set([
            ...this.veteranAbilities,
            ...this.ini.getEnumArray("EliteAbilities", VeteranAbility)
        ]);
        this.selfHealing = this.ini.getBool("SelfHealing");
        this.wall = this.ini.getBool("Wall");
        this.firestormWall = this.ini.getBool("Firestorm.Wall");
        this.gate = this.ini.getBool("Gate");
        this.armor = this.armorRegistry.resolve(this.ini.getString("Armor"), ArmorType.None);
        this.strength = Math.floor(this.ini.getNumber("Strength"));
        this.immune = this.ini.getBool("Immune");
        this.immuneToRadiation = this.ini.getBool("ImmuneToRadiation");
        this.immuneToPsionics = this.ini.getBool("ImmuneToPsionics");
        this.ignoresFirestorm = this.ini.getBool("IgnoresFirestorm");
        this.typeImmune = this.ini.getBool("TypeImmune");
        this.warpable = this.ini.getBool("Warpable", true);
        this.isTilter = this.ini.getBool("IsTilter", true);
        this.walkRate = this.ini.getNumber("WalkRate", 1);
        this.idleRate = this.ini.getNumber("IdleRate", 0);
        this.noSpawnAlt = this.ini.getBool("NoSpawnAlt");
        this.crusher = this.ini.getBool("Crusher");
        this.consideredAircraft = this.ini.getBool("ConsideredAircraft");
        this.crashable = this.ini.getBool("Crashable");
        const landable = this.ini.getBool("Landable");
        this.landable = landable;
        this.airportBound = this.ini.getBool("AirportBound");
        this.balloonHover = this.ini.getBool("BalloonHover");
        this.hoverAttack = this.ini.getBool("HoverAttack");
        this.omniFire = this.ini.getBool("OmniFire");
        this.fighter = this.ini.getBool("Fighter");
        this.flightLevel = this.ini.getNumber("FlightLevel") || void 0;
        const locomotorString = this.ini.getString("Locomotor");
        let defaultLocomotor = this.type === ObjectType.Building ? LocomotorType.Statue : LocomotorType.Chrono;
        if (locomotorString) {
            this.locomotorClsId = locomotorString;
            const locomotorType = resolveLocomotorType(locomotorString);
            if (locomotorType) {
                this.locomotor = locomotorType;
            }
            else {
                console.warn(`Object rules "${this.name}" has unsupported Locomotor "${locomotorString}"`);
                this.locomotor = LocomotorType.Unsupported;
            }
        }
        else {
            this.locomotor = defaultLocomotor;
        }
        if (this.locomotor !== LocomotorType.Statue) {
            let defaultSpeed = (LocomotorType as any).defaultSpeedsByLocomotor?.get(this.locomotor);
            if (void 0 === defaultSpeed) {
                if (this.type === ObjectType.Aircraft || this.consideredAircraft) {
                    defaultSpeed = SpeedType.Winged;
                }
                else if (this.type === ObjectType.Vehicle) {
                    defaultSpeed = this.crusher ? SpeedType.Track : SpeedType.Wheel;
                }
                else if (this.type === ObjectType.Infantry) {
                    defaultSpeed = SpeedType.Foot;
                }
            }
            this.speedType = this.ini.getEnum("SpeedType", SpeedType, defaultSpeed, true);
        }
        const speedMultiplier = [
            LocomotorType.Ship,
            LocomotorType.Vehicle,
            LocomotorType.Chrono,
            LocomotorType.Tunnel,
            LocomotorType.Mech,
        ].includes(this.locomotor) ? 65 : 100;
        this.speed = ObjectRules.iniSpeedToLeptonsPerTick(this.ini.getNumber("Speed"), speedMultiplier);
        this.movementZone = this.ini.getEnum("MovementZone", MovementZone, MovementZone.Normal, false, movementZoneAliases);
        this.digIn = this.ini.getString("DigIn") || undefined;
        this.digOut = this.ini.getString("DigOut") || undefined;
        this.digInSound = this.ini.getString("DigInSound") || undefined;
        this.digOutSound = this.ini.getString("DigOutSound") || undefined;
        this.fearless = this.ini.getBool("Fearless");
        // YR introduced IsSimpleDeployer (Siege Chopper) alongside RA2's
        // Deployer key; both mark a unit that toggles deployed state.
        this.deployer = this.ini.getBool("Deployer") || this.ini.getBool("IsSimpleDeployer");
        this.deployFire = this.ini.getBool("DeployFire");
        this.deployFireWeapon = this.ini.getNumber("DeployFireWeapon", WeaponType.Secondary);
        this.undeployDelay = this.ini.getNumber("UndeployDelay");
        this.fraidycat = this.ini.getBool("Fraidycat", false);
        this.isHuman = !this.ini.getBool("NotHuman");
        this.organic = this.type === ObjectType.Infantry || this.ini.getBool("Organic");
        this.occupier = this.ini.getBool("Occupier");
        this.engineer = this.ini.getBool("Engineer");
        this.ivan = this.ini.getBool("Ivan");
        this.civilian = this.ini.getBool("Civilian");
        this.agent = this.ini.getBool("Agent");
        this.infiltrate = this.ini.getBool("Infiltrate");
        this.threatPosed = this.ini.getNumber("ThreatPosed");
        this.specialThreatValue = this.ini.getNumber("SpecialThreatValue");
        this.canPassiveAquire = this.ini.getBool("CanPassiveAquire", true);
        this.canRetaliate = this.ini.getBool("CanRetaliate", true);
        this.preventAttackMove = this.ini.getBool("PreventAttackMove");
        this.opportunityFire = this.ini.getBool("OpportunityFire");
        this.distributedFire = this.ini.getBool("DistributedFire");
        this.radialFireSegments = this.ini.getNumber("RadialFireSegments");
        this.attackCursorOnFriendlies = this.ini.getBool("AttackCursorOnFriendlies");
        this.bombable = this.ini.getBool("Bombable", true);
        this.trainable = this.ini.getBool("Trainable", this.type !== ObjectType.Building);
        this.crewed = this.ini.getBool("Crewed");
        this.parasiteable = this.ini.getBool("Parasiteable", this.type !== ObjectType.Building);
        this.suppressionThreshold = this.ini.getNumber("SuppressionThreshold");
        this.reselectIfLimboed = this.ini.getBool("ReselectIfLimboed");
        this.rejoinTeamIfLimboed = this.ini.getBool("RejoinTeamIfLimboed");
        this.weight = this.ini.getNumber("Weight");
        this.accelerates = this.ini.getBool("Accelerates", true);
        this.accelerationFactor = this.ini.getNumber("AccelerationFactor", 0.03);
        this.teleporter = this.ini.getBool("Teleporter");
        this.canDisguise = this.ini.getBool("CanDisguise");
        this.disguiseWhenStill = this.ini.getBool("DisguiseWhenStill");
        this.permaDisguise = this.ini.getBool("PermaDisguise");
        this.detectDisguise = this.ini.getBool("DetectDisguise");
        this.detectDisguiseRange = this.ini.getNumber("DetectDisguiseRange");
        this.cloakable = this.ini.getBool("Cloakable");
        this.sensors = this.ini.getBool("Sensors");
        this.sensorArray = this.ini.getBool("SensorArray");
        this.sensorsSight = this.ini.getNumber("SensorsSight");
        this.burstDelay = this.parseBurstDelay();
        this.vhpScan = this.ini.getEnum("VHPScan", VhpScan, VhpScan.None, true);
        this.pip = this.ini.getEnum("Pip", PipColor, PipColor.Green, true);
        this.passengers = this.ini.getNumber("Passengers");
        this.gunner = this.ini.getBool("Gunner");
        this.openTopped = this.ini.getBool("OpenTopped");
        this.ammo = this.ini.getNumber("Ammo", -1);
        this.initialAmmo = this.ini.getNumber("InitialAmmo", -1);
        this.manualReload = this.ini.getBool("ManualReload", this.type === ObjectType.Aircraft);
        this.storage = this.ini.getNumber("Storage");
        this.spawned = this.ini.getBool("Spawned");
        this.spawns = this.ini.getString("Spawns");
        this.airstrikeTeam = this.ini.getNumber("AirstrikeTeam", 2);
        this.eliteAirstrikeTeam = this.ini.getNumber("EliteAirstrikeTeam", this.airstrikeTeam);
        this.airstrikeTeamType = this.ini.getString("AirstrikeTeamType");
        this.eliteAirstrikeTeamType = this.ini.getString("EliteAirstrikeTeamType") || this.airstrikeTeamType;
        this.hunterSeekerDetonateProximity = this.ini.getNumber("HunterSeeker.DetonateProximity");
        this.hunterSeekerDescendProximity = this.ini.getNumber("HunterSeeker.DescendProximity");
        this.hunterSeekerAscentSpeed = this.ini.getNumber("HunterSeeker.AscentSpeed");
        this.hunterSeekerDescentSpeed = this.ini.getNumber("HunterSeeker.DescentSpeed");
        this.hunterSeekerEmergeSpeed = this.ini.getNumber("HunterSeeker.EmergeSpeed");
        this.hunterSeekerIgnore = this.ini.getBool("HunterSeeker.Ignore");
        this.spawnsNumber = this.ini.getNumber("SpawnsNumber");
        this.spawnRegenRate = this.ini.getNumber("SpawnRegenRate");
        this.spawnReloadRate = this.ini.getNumber("SpawnReloadRate");
        this.missileSpawn = this.ini.getBool("MissileSpawn");
        this.size = this.ini.getNumber("Size", 1);
        this.sizeLimit = this.ini.getNumber("SizeLimit");
        this.sight = Math.min(TechnoRules.MAX_SIGHT, this.needsEngineer ? 6 : this.ini.getNumber("Sight", 1));
        this.designatorRange = Math.min(TechnoRules.MAX_SIGHT, Math.max(0, this.ini.getNumber("DesignatorRange", this.sight)));
        this.inhibitorRange = Math.min(TechnoRules.MAX_SIGHT, Math.max(0, this.ini.getNumber("InhibitorRange", this.sight)));
        this.spySat = this.ini.getBool("SpySat");
        this.gapGenerator = this.ini.getBool("GapGenerator");
        this.gapRadiusInCells = this.ini.getNumber("GapRadiusInCells");
        this.psychicDetectionRadius = this.ini.getNumber("PsychicDetectionRadius");
        this.hasRadialIndicator = this.ini.getBool("HasRadialIndicator");
        this.harvester = this.ini.getBool("Harvester");
        this.unloadingClass = this.ini.getString("UnloadingClass");
        this.dock = this.ini.getArray("Dock");
        this.radar = this.ini.getBool("Radar");
        this.radarInvisible = this.ini.getBool("RadarInvisible");
        this.revealToAll = this.ini.getBool("RevealToAll");
        const defaultImmuneToEMP = this.resolveDefaultEmpImmunity();
        this.immuneToEMP = this.ini.has("ImmuneToEMP")
            ? this.ini.getBool("ImmuneToEMP")
            : defaultImmuneToEMP;
        this.empModifier = this.ini.getFixed("EMP.Modifier", 1);
        this.empThreshold = parseAresEmpThreshold(this.ini.getString("EMP.Threshold"));
        this.empulseCannon = this.ini.getBool("EMPulseCannon");
        this.selectable = !(this.type === ObjectType.Aircraft && !landable) && this.ini.getBool("Selectable", true);
        this.isSelectableCombatant = this.ini.getBool("IsSelectableCombatant");
        this.invisibleInGame = this.ini.getBool("InvisibleInGame");
        this.moveToShroud = this.ini.getBool("MoveToShroud", this.type !== ObjectType.Aircraft);
        this.leadershipRating = this.ini.getNumber("LeadershipRating", 5);
        this.unnatural = this.ini.getBool("Unnatural");
        this.natural = this.ini.getBool("Natural");
        this.buildTimeMultiplier = this.ini.getFixed("BuildTimeMultiplier", 1);
        this.allowedToStartInMultiplayer = this.ini.getBool("AllowedToStartInMultiplayer", true);
        this.rot = ObjectRules.iniRotToDegsPerTick(this.ini.getNumber("ROT", 0));
        this.jumpjetAccel = this.ini.getNumber("JumpJetAccel", 2);
        this.jumpjetClimb = this.ini.getNumber("JumpjetClimb", 5);
        this.jumpjetCrash = this.ini.getNumber("JumpjetCrash", 5);
        this.jumpjetDeviation = this.ini.getNumber("JumpjetDeviation", 40);
        this.jumpjetHeight = this.ini.getNumber("JumpjetHeight", 500);
        this.jumpjetNoWobbles = this.ini.getBool("JumpjetNoWobbles");
        this.jumpjetSpeed = this.ini.getNumber("JumpjetSpeed", 14);
        this.jumpjetTurnRate = ObjectRules.iniRotToDegsPerTick(this.ini.getNumber("JumpJetTurnRate", 4));
        this.jumpjetWobbles = this.ini.getNumber("JumpjetWobbles", 0.15);
        this.pitchSpeed = this.ini.getNumber("PitchSpeed", 0.25);
        this.pitchAngle = this.pitchSpeed >= 1 ? 0 : 20;
        this.damageParticleSystems = this.ini.getArray("DamageParticleSystems");
        this.damageParticleSystemDefinitions = resolveAresParticleSystems(
            this.damageParticleSystems,
            this.generalRules?.aresParticleSystemRules,
        );
        const resolvedDamageParticleSelection = resolveAresDamageParticleSelection({
            isInfantry: this.type === ObjectType.Infantry,
            cyborg: this.ini.getBool("Cyborg"),
            damageParticleSystems: this.damageParticleSystemDefinitions,
            damageSmokeParticleSystems: getAresArray("DamageSmokeParticleSystems"),
            damageSparksParticleSystems: getAresArray("DamageSparksParticleSystems"),
            damageSparks: getAresBool("DamageSparks"),
        });
        this.damageSmokeParticleSystemDefinitions = resolvedDamageParticleSelection.damageSmokeParticleSystems;
        this.damageSparksParticleSystemDefinitions = resolvedDamageParticleSelection.damageSparksParticleSystems;
        this.damageSparksEnabled = resolvedDamageParticleSelection.damageSparksEnabled;
        const hasAresDamageParticleFields = normalizedAresKeys.some((key: string) =>
            key === "damagesparks" ||
            key === "damagesmokeparticlesystems" ||
            key === "damagesparksparticlesystems");
        this.aresDamageParticles = hasAresDamageParticleFields
            ? resolvedDamageParticleSelection
            : undefined;
        const damageSmokeOffsetArray = this.ini.getNumberArray("DamageSmokeOffset", undefined, [0, 0, 0]);
        this.damageSmokeOffset = new Vector3(damageSmokeOffsetArray[0], damageSmokeOffsetArray[2] / Math.SQRT2, damageSmokeOffsetArray[1]);
        this.minDebris = this.ini.getNumber("MinDebris");
        this.maxDebris = this.ini.getNumber("MaxDebris");
        this.debrisTypes = this.ini.getArray("DebrisTypes");
        this.debrisAnims = this.ini.getArray("DebrisAnims");
        // Retail semantics: InvisibleInGame (the IN*LAMP/NEGLAMP light posts)
        // means "never draw this building" — it exists only to cast light.
        // The old imageName === "GALITE" check also swallowed the VISIBLE
        // GALITE street lamp, hiding it incorrectly.
        // invisibleInGame is already read in the shared pass above; reuse it.
        this.isLightpost = this.invisibleInGame;
        this.lightVisibility = this.ini.getNumber("LightVisibility", 5000);
        this.lightIntensity = this.ini.getNumber("LightIntensity");
        this.lightRedTint = this.ini.getNumber("LightRedTint", 1);
        this.lightGreenTint = this.ini.getNumber("LightGreenTint", 1);
        this.lightBlueTint = this.ini.getNumber("LightBlueTint", 1);
        this.ambientSound = this.ini.getString("AmbientSound") || undefined;
        this.createSound = this.ini.getString("CreateSound") || undefined;
        this.slamSound = this.ini.getString("SlamSound") || undefined;
        this.deploySound = this.ini.getString("DeploySound") || undefined;
        this.undeploySound = this.ini.getString("UndeploySound") || undefined;
        this.voiceSelect = this.ini.getString("VoiceSelect") || undefined;
        this.voiceMove = this.ini.getString("VoiceMove") || undefined;
        this.voiceAttack = this.ini.getString("VoiceAttack") || undefined;
        this.voiceFeedback = this.ini.getString("VoiceFeedback") || undefined;
        this.voiceSpecialAttack = this.ini.getString("VoiceSpecialAttack") || undefined;
        this.voiceEnter = this.ini.getString("VoiceEnter") || undefined;
        this.voiceCapture = this.ini.getString("VoiceCapture") || undefined;
        this.voiceCrashing = this.ini.getString("VoiceCrashing") || undefined;
        this.crashingSound = this.ini.getString("CrashingSound") || undefined;
        this.impactLandSound = this.ini.getString("ImpactLandSound") || undefined;
        this.auxSound1 = this.ini.getString("AuxSound1") || undefined;
        this.auxSound2 = this.ini.getString("AuxSound2") || undefined;
        this.dieSound = this.ini.getString("DieSound") || undefined;
        this.moveSound = this.ini.getString("MoveSound") || undefined;
        this.enterWaterSound = this.ini.getString("EnterWaterSound") || undefined;
        this.leaveWaterSound = this.ini.getString("LeaveWaterSound") || undefined;
        this.turretRotateSound = this.ini.getString("TurretRotateSound") || undefined;
        this.workingSound = this.ini.getString("WorkingSound") || undefined;
        this.notWorkingSound = this.ini.getString("NotWorkingSound") || undefined;
        this.chronoInSound = this.ini.getString("ChronoInSound") || undefined;
        this.chronoOutSound = this.ini.getString("ChronoOutSound") || undefined;
        this.enterTransportSound = this.ini.getString("EnterTransportSound") || undefined;
        this.leaveTransportSound = this.ini.getString("LeaveTransportSound") || undefined;
        // Yuri's slave miner family. The original engine hardcodes most of the
        // behavior off these two keys, so derive the generic flags it never
        // sets in the ini: a slave (Slaved=yes) IS a harvester, and a slave
        // miner (Enslaves=...) IS a refinery with a dock.
        this.enslaves = this.ini.getString("Enslaves") || undefined;
        this.slavesNumber = this.ini.getNumber("SlavesNumber", 5);
        this.slaved = this.ini.getBool("Slaved");
        if (this.slaved) {
            this.harvester = true;
        }
        if (this.enslaves) {
            this.refinery = true;
            this.dockUnload = true;
            if (!this.numberOfDocks) {
                this.numberOfDocks = 1;
            }
        }
    }
    private parseWeaponName(weaponName: string | undefined): string | undefined {
        return weaponName && weaponName.toLowerCase() !== "none" ? weaponName : undefined;
    }

    /**
     * Ares' default EMP immunity is based on the TechnoType's useful
     * functions, not just its object category.  Keep this calculation at
     * rule-load time so runtime EMP code never has to inspect raw INI keys.
     */
    private resolveDefaultEmpImmunity(): boolean {
        return defaultAresEmpImmunity({
            type: this.type,
            powered: this.powered,
            power: this.power,
            radar: this.radar,
            spySat: this.spySat,
            hasSuperWeapon: hasAresSuperWeaponProvider(this),
            undeploysInto: !!this.undeploysInto,
            powersUnit: !!this.powersUnit,
            gapGenerator: this.gapGenerator,
            sensors: this.sensors,
            sensorArray: this.sensorArray,
            laserFencePost: this.ini.getBool("LaserFencePost"),
            cyborg: this.ini.getBool("Cyborg"),
            organic: this.organic,
        });
    }
    private parseTurretIndexes(): Map<number, number> {
        const turretIndexMap = new Map<number, number>();
        if (this.ini.getBool("Gunner")) {
            this.ini.entries.forEach((value: string, key: string) => {
                const match = key.match(/^(.*)TurretWeapon$/i);
                if (match) {
                    const turretIndexKey = match[1] + "TurretIndex";
                    if (this.ini.has(turretIndexKey)) {
                        turretIndexMap.set(Number(value), this.ini.getNumber(turretIndexKey));
                    }
                }
            });
        }
        return turretIndexMap;
    }
    private parseBurstDelay(): (number | undefined)[] {
        const burstDelays: (number | undefined)[] = [];
        for (let i = 0; i < 4; i++) {
            const key = "BurstDelay" + i;
            burstDelays.push(this.ini.has(key) ? this.ini.getNumber(key) : undefined);
        }
        return burstDelays;
    }
    public hasOwner(house: House): boolean {
        const normalizedHouse = normalizeHouseName(house.name);
        return this.owner.length > 0 && this.owner.some((owner) =>
            normalizeHouseName(owner) === normalizedHouse);
    }
    public isAvailableTo(house: House): boolean {
        const normalizedHouse = normalizeHouseName(house.name);
        const hasRequiredHouse = this.requiredHouses.length === 0 ||
            this.requiredHouses.some((requiredHouse) =>
                normalizeHouseName(requiredHouse) === normalizedHouse);
        const isForbidden = this.forbiddenHouses.some((forbiddenHouse) =>
            normalizeHouseName(forbiddenHouse) === normalizedHouse);
        return hasRequiredHouse && !isForbidden;
    }
    public getWeaponAtIndex(index: number): string | undefined {
        return this.parseWeaponName(this.ini.getString("Weapon" + (index + 1)));
    }
    public getEliteWeaponAtIndex(index: number): string | undefined {
        return this.parseWeaponName(this.ini.getString("EliteWeapon" + (index + 1)));
    }
}
