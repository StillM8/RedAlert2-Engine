/**
 * Machine-readable inventory of the public Ares documentation tree.
 *
 * This catalog is intentionally separate from AresFeatureRegistry.  The
 * registry describes the small set of capabilities currently wired into the
 * runtime, while this file describes the complete documented surface so that
 * missing parser/runtime/persistence work remains visible.
 *
 * The documentation paths are relative to the official Ares-docs repository:
 * https://github.com/Ares-Developers/Ares-docs
 */

export type AresCapabilityStatus = "missing" | "partial" | "complete";
export type AresVerificationStatus = "unverified" | "synthetic" | "integration" | "target-content";
export type AresDocumentationCategory = "new" | "restored" | "bugfix" | "ui";

export interface AresCapability {
    id: string;
    title: string;
    category: AresDocumentationCategory;
    sourceDocuments: readonly string[];
    documentedKeys: readonly string[];
    documentedSections: readonly string[];
    parserStatus: AresCapabilityStatus;
    normalizedModelStatus: AresCapabilityStatus;
    runtimeStatus: AresCapabilityStatus;
    aiStatus: AresCapabilityStatus;
    presentationStatus: AresCapabilityStatus;
    saveLoadStatus: AresCapabilityStatus;
    multiplayerStatus: AresCapabilityStatus;
    deterministic: boolean;
    verificationStatus: AresVerificationStatus;
    tests: readonly string[];
    dependencies: readonly string[];
    targetModUsage: "unknown" | "required" | "optional" | "not-applicable";
    notes?: string;
}

export interface AresDocumentationDocument {
    path: string;
    category: AresDocumentationCategory;
    capabilityId: string;
}

/** Non-capability pages are tracked separately so the leaf-document count is auditable. */
export const ARES_DOCUMENTATION_ROOTS = [
    "index.rst",
    "intro.rst",
    "comparison.rst",
    "glossary.rst",
    "todo.rst",
    "new/index.rst",
    "restored/index.rst",
    "bugfixes/index.rst",
    "ui-features/index.rst",
] as const;

const DOCUMENTATION_PATHS: readonly string[] = [
    "new/additionalarmortypesandverses.rst",
    "new/alternatetheaterart.rst",
    "new/attacheffect.rst",
    "new/avoidableinternalerrors.rst",
    "new/chronoprisons.rst",
    "new/chronoshift.rst",
    "new/customanimationandprojectilepalettes.rst",
    "new/custombuildingfoundations.rst",
    "new/customcameopalettes.rst",
    "new/customizableinsignia.rst",
    "new/customizableparachuteanimations.rst",
    "new/customizableveterancy.rst",
    "new/damageparticlesystems.rst",
    "new/destroyunitsbyemp.rst",
    "new/gunner.rst",
    "new/hardcodedunitproperties.rst",
    "new/include.rst",
    "new/infantryelectrocuted.rst",
    "new/killingdrivers.rst",
    "new/lightningrods.rst",
    "new/listlengths.rst",
    "new/looseaudiofiles.rst",
    "new/makeinfantryowner.rst",
    "new/miscellaneousmoddingenhancements.rst",
    "new/mixloadingorder.rst",
    "new/mousesha.rst",
    "new/newpoweredunitlogic.rst",
    "new/operator.rst",
    "new/pcxcameos.rst",
    "new/prerequisites.rst",
    "new/prismforwarding.rst",
    "new/radarjammers.rst",
    "new/reverseengineerlogic.rst",
    "new/secretlabs.rst",
    "new/sidescountries.rst",
    "new/solidbuildings.rst",
    "new/spybehavior.rst",
    "new/stringtableenhancements.rst",
    "new/superweapons.rst",
    "new/survivors.rst",
    "new/urbancombattrenches.rst",
    "new/warheads.rst",
    "new/weapons.rst",
    "restored/actionsellunit.rst",
    "restored/actiontogglepower.rst",
    "restored/amphibiousimagechanges.rst",
    "restored/emp.rst",
    "restored/firestormwall.rst",
    "restored/laserfences.rst",
    "restored/multiengineer.rst",
    "restored/multiengineercheckbox.rst",
    "restored/spotlights.rst",
    "restored/vehicle-thief.rst",
    "ui-features/bitmapscreenshots.rst",
    "ui-features/campaignlist.rst",
    "ui-features/campaignloadscreentextcolor.rst",
    "ui-features/commandlinearguments.rst",
    "ui-features/customizablecampaignbuttons.rst",
    "ui-features/customizabledropdowncolors.rst",
    "ui-features/graphicssurfacedrawing.rst",
    "ui-features/internalerrorsdebugging.rst",
    "ui-features/keyboardcommandshotkeys.rst",
    "ui-features/loadingscreen.rst",
    "ui-features/loneplayerskirmish.rst",
    "ui-features/menubuttoncustomization.rst",
    "ui-features/newgameresolutions.rst",
    "ui-features/randommapgenerator.rst",
    "ui-features/userinterfacecolors.rst",
    "bugfixes/type1/aitargetingcloakedobjectswithmajorsuperweapons.rst",
    "bugfixes/type1/animatedsuperweaponcursor.rst",
    "bugfixes/type1/chronoshiftwillsinkjumpjetunits.rst",
    "bugfixes/type1/enemyharvesterguardmodeexploit.rst",
    "bugfixes/type1/firingvoicesandveterancy.rst",
    "bugfixes/type1/frozenmutationmakeinfantryanimations.rst",
    "bugfixes/type1/loadscreencolors.rst",
    "bugfixes/type1/misleadingveterannavalcameos.rst",
    "bugfixes/type1/parasitesinairborneunits.rst",
    "bugfixes/type1/prismsupportbugs.rst",
    "bugfixes/type1/secretlabboonweighting.rst",
    "bugfixes/type1/temporalwarheadsandpotentialoccupationtargets.rst",
    "bugfixes/type1/temporalwarheadsearnexperiencebykillingfriendlyunits.rst",
    "bugfixes/type1/toomanysecretlabs.rst",
    "bugfixes/type1/unitsoundsplayedatinappropriatetimes.rst",
    "bugfixes/type1/warheadversesspecialvalues.rst",
    "bugfixes/type2/aircrafttypesandrailguns.rst",
    "bugfixes/type2/airtoaircombat.rst",
    "bugfixes/type2/alternatetheaterartforbuildingtypes.rst",
    "bugfixes/type2/amphibiousobjectssinkwhenchronoshiftedontowater.rst",
    "bugfixes/type2/animationdamagewarheads.rst",
    "bugfixes/type2/baseunit.rst",
    "bugfixes/type2/buildableconstructionyards.rst",
    "bugfixes/type2/buildablesecretlabs.rst",
    "bugfixes/type2/buildconst.rst",
    "bugfixes/type2/buildingtypesandinfantrytypesdonotreloadammoproperly.rst",
    "bugfixes/type2/buildingtypeupgradesarenotviableprerequisites.rst",
    "bugfixes/type2/cloakableaircrafttypesandbuildingtypes.rst",
    "bugfixes/type2/custompalettes.rst",
    "bugfixes/type2/destroyanimscausereconnectionerrors.rst",
    "bugfixes/type2/destroyanimsdontremap.rst",
    "bugfixes/type2/digsound.rst",
    "bugfixes/type2/factoryloadsharing.rst",
    "bugfixes/type2/hardcodedwallgateinteractions.rst",
    "bugfixes/type2/hijackersarereimbursedwhenaunitisgrinded.rst",
    "bugfixes/type2/infantrylostinspecialfunctionbuildings.rst",
    "bugfixes/type2/initialveterancameos.rst",
    "bugfixes/type2/ivanbombscanonlybefiredbyinfantrytypes.rst",
    "bugfixes/type2/jumpjetshadows.rst",
    "bugfixes/type2/mindcontrollerparasites.rst",
    "bugfixes/type2/miragelogicwithturretsbarrels.rst",
    "bugfixes/type2/movingalphalights.rst",
    "bugfixes/type2/multipleaifactoriescloneunits.rst",
    "bugfixes/type2/negativelydamagingweaponswithanimlist.rst",
    "bugfixes/type2/newconstructionoptions.rst",
    "bugfixes/type2/opentoppedtransportsdonotdecloaktofire.rst",
    "bugfixes/type2/overridingmissionsmdpkt.rst",
    "bugfixes/type2/pktduplication.rst",
    "bugfixes/type2/radbeamsandwavesusingthewrongflh.rst",
    "bugfixes/type2/reinforcementsandmultiplayermaptriggers.rst",
    "bugfixes/type2/remappablewalls.rst",
    "bugfixes/type2/sonicwaveambientdamage.rst",
    "bugfixes/type2/specialweaponsnowfunctioninsecondaryslots.rst",
    "bugfixes/type2/spyplanecountdecoupledfromallyparadropnum.rst",
    "bugfixes/type2/summonedairstrikesnolongerdependentonsovparadropinf.rst",
    "bugfixes/type2/temporalwarheadsstillaffectobjectsthatarenotwarpable.rst",
    "bugfixes/type2/the100unitbug.rst",
    "bugfixes/type2/unitinstancesnotcountingtowardsbuildlimit.rst",
    "bugfixes/type2/unitsoundsplayedatinappropriatetimes.rst",
    "bugfixes/type2/unitsoverpoweringbuildings.rst",
    "bugfixes/type2/vehicleparadropoffset.rst",
    "bugfixes/type3.rst",
] as const;

function categoryFor(path: string): AresDocumentationCategory {
    if (path.startsWith("new/")) return "new";
    if (path.startsWith("restored/")) return "restored";
    if (path.startsWith("ui-features/")) return "ui";
    return "bugfix";
}

function titleFor(path: string): string {
    const filename = path.slice(path.lastIndexOf("/") + 1).replace(/\.rst$/i, "");
    return filename
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const DOCUMENTED_KEYS: Readonly<Record<string, readonly string[]>> = {
    "new/additionalarmortypesandverses.rst": ["[ArmorTypes]", "[Warhead]Versus.*", "Versus.*.ForceFire", "Versus.*.Retaliate", "Versus.*.PassiveAcquire"],
    "new/attacheffect.rst": ["AttachEffect.Animation", "AttachEffect.Duration", "AttachEffect.TemporalHidesAnim", "AttachEffect.SpeedMultiplier", "AttachEffect.ArmorMultiplier", "AttachEffect.FirepowerMultiplier", "AttachEffect.ROFMultiplier", "AttachEffect.Cloakable", "AttachEffect.ForceDecloak", "AttachEffect.DiscardOnEntry", "AttachEffect.PenetratesIronCurtain", "AttachEffect.Delay", "AttachEffect.InitialDelay", "AttachEffect.Cumulative", "AttachEffect.AnimResetOnReapply"],
    "new/chronoprisons.rst": ["[Weapon]Abductor", "[TechnoType]PassengerTurret"],
    "new/chronoshift.rst": ["[TechnoType]Chronoshift.Allow", "[BuildingType]Chronoshift.IsVehicle", "[TechnoType]Chronoshift.Crushable"],
    "new/customanimationandprojectilepalettes.rst": ["[Animation]CustomPalette"],
    "new/custombuildingfoundations.rst": ["Foundation=Custom", "Foundation.N", "FoundationOutline.Length", "FoundationOutline.N"],
    "new/customcameopalettes.rst": ["[UnitArt]CameoPalette", "[SuperWeapon]SidebarPalette"],
    "new/customizableinsignia.rst": ["Insignia.Rookie", "Insignia.Veteran", "Insignia.Elite", "InsigniaFrame.Rookie", "InsigniaFrame.Veteran", "InsigniaFrame.Elite", "Insignia.ShowEnemy", "[General]EnemyInsignia"],
    "new/customizableparachuteanimations.rst": ["Parachute.Anim"],
    "new/customizableveterancy.rst": ["Trainable", "Experience.FromPassengers", "Experience.PromotePassengers", "Experience.PassengerModifier", "Experience.FromAirstrike", "Experience.AirstrikeModifier", "Experience.SpawnOwnerModifier", "Experience.SpawnModifier", "Experience.MindControlSelfModifier", "Experience.MindControlVictimModifier"],
    "new/damageparticlesystems.rst": ["[TechnoType]DamageSparks", "[TechnoType]DamageSmokeParticleSystems", "[TechnoType]DamageSparksParticleSystems", "DamageParticleSystems"],
    "new/destroyunitsbyemp.rst": ["[TechnoType]EMP.Threshold"],
    "new/gunner.rst": ["IFVMode", "WeaponTurretIndexX", "WeaponUINameX", "[VehicleType]VoiceIFVRepair"],
    "new/include.rst": ["[#include]"],
    "new/killingdrivers.rst": ["[Warhead]KillDriver", "[TechnoType]ProtectedDriver", "[TechnoType]CanDrive", "[TechnoType]CanBeDriven", "[Country]CanBeDriven"],
    "new/lightningrods.rst": ["[BuildingType]LightningRod", "LightningRod.Modifier"],
    "restored/firestormwall.rst": ["Firestorm.Wall", "SubjectToFirestorm", "FirestormActiveAnim", "FirestormIdleAnim", "FirestormGroundAnim", "FirestormAirAnim", "FirestormWarhead", "DamageToFirestormDamageCoefficient"],
    "restored/vehicle-thief.rst": ["[InfantryType]VehicleThief", "VehicleThief.EnterSound", "VehicleThief.LeaveSound", "VehicleThief.KillPilots", "VehicleThief.BreakMindControl", "VehicleThief.Allowed", "VehicleThief.OneTime"],
    "new/makeinfantryowner.rst": ["MakeInfantryOwner"],
    "new/newpoweredunitlogic.rst": ["[UnitType]PoweredBy"],
    "new/operator.rst": ["[TechnoType]Operator"],
    "new/pcxcameos.rst": ["CameoPCX", "AltCameoPCX", "SidebarPCX"],
    "new/prerequisites.rst": ["Prerequisite.RequiredTheaters", "GenericPrerequisites", "Prerequisite.StolenTechs"],
    "new/prismforwarding.rst": ["PrismForwarding", "PrismForwarding.Targets", "PrismForwarding.MaxFeeds", "PrismForwarding.MaxChainLength", "PrismForwarding.SupportModifier", "PrismForwarding.SupportWeapon"],
    "new/radarjammers.rst": ["RadarJamRadius"],
    "new/reverseengineerlogic.rst": ["ReverseEngineersVictims", "SpyEffect.UndoReverseEngineer", "CanBeReversed"],
    "new/secretlabs.rst": ["SecretLab.PossibleBoons", "SecretLab.GenerateOnCapture", "Secret.RequiredHouses", "Secret.ForbiddenHouses"],
    "new/sidescountries.rst": ["File.Flag", "File.LoadScreen", "LoadScreenText.Name", "RandomSelectionWeight", "ListIndex", "AI.PowerPlants", "ParaDrop.Types", "DefaultDisguise", "Crew", "SurvivorDivisor", "AI.BaseDefenses", "Sidebar.MixFileIndex", "Sidebar.YuriFileNames", "EVA.Tag"],
    "new/solidbuildings.rst": ["[Projectile]SubjectToBuildings", "[BuildingArt]SolidHeight"],
    "new/spybehavior.rst": ["SpyEffect.Custom", "SpyEffect.ResetRadar", "SpyEffect.RevealRadar", "SpyEffect.PowerOutageDuration", "SpyEffect.StolenMoneyAmount", "SpyEffect.StolenMoneyPercentage", "SpyEffect.ResetSuperweapons", "SpyEffect.StolenTechIndex", "SpyEffect.UnitVeterancy", "SpyEffect.RevealProduction"],
    "new/superweapons.rst": ["SW.RequiredHouses", "SW.ForbiddenHouses", "SW.AuxBuildings", "SW.NegBuildings", "SW.AllowPlayer", "SW.AllowAI", "SW.Shots", "SW.AlwaysGranted", "SW.ShowCameo", "SW.TimerVisibility", "SW.Group", "SW.FireIntoShroud", "SW.AutoFire", "SW.ManualFire", "UseChargeDrain", "ChargeToDrainRatio", "SW.ChargeToDrainRatio", "SW.Unstoppable", "SW.Range", "SW.CreateRadarEvent", "SW.Deferment", "SW.PostDependent", "SW.UseAITargeting", "SW.AITargeting", "SW.AITargeting.Constraints", "SW.AITargeting.Preference", "SW.AIRequiresTarget", "SW.AIRequiresHouse", "SW.InitialReady", "SW.VirtualCharge", "Money.Amount", "Money.DrainAmount", "Money.DrainDelay", "SW.Animation", "EVA.*", "Message.*", "Text.*", "Light.*", "Lightning.*", "Nuke.*", "Dominator.*", "Chronosphere.*", "Protect.*", "Mutate.*", "ParaDrop.*", "SpyPlane.*", "SonarPulse.Delay", "Deliver.Types", "DropPod.Types", "DropPod.Minimum", "DropPod.Maximum", "DropPod.Veterancy", "DropPodWeapon", "DropPodTrailer", "EMPulse.Linked", "EMPulse.TargetSelf", "EMPulse.PulseDelay", "EMPulse.PulseBall", "EMPulse.Cannons", "EMPulseCannon"],
    "new/survivors.rst": ["Survivor.PilotCount", "Survivor.RookiePilotChance", "Survivor.VeteranPilotChance", "Survivor.ElitePilotChance", "Survivor.VeteranPassengerChance", "Survivor.ElitePassengerChance"],
    "new/urbancombattrenches.rst": ["UC.PassThrough", "UC.FatalRate", "UC.DamageMultiplier", "SubjectToTrenches", "Bunker.Raidable", "Rubble.Destroyed", "Rubble.Intact", "IsTrench", "CanBeOccupiedBy"],
    "new/warheads.rst": ["IronCurtain.Duration", "IronCurtain.Cap", "IronCurtain.Modifier", "MindControl.Permanent", "Temporal.WarpAway", "Ripple.Radius", "Deployed.Damage", "AffectsAllies", "AffectsEnemies", "Malicious", "InfDeathAnim", "PreImpactAnim"],
    "new/weapons.rst": ["[WeaponTypes]", "Beam.Color", "Beam.IsHouseColor", "Beam.Duration", "Beam.Amplitude", "Bolt.Color1", "Bolt.Color2", "Bolt.Color3", "Wave.IsLaser", "Wave.IsBigLaser", "Wave.Color", "Wave.IsHouseColor"],
    "restored/emp.rst": ["EMP.Duration", "EMP.Cap", "ImmuneToEMP", "EMP.Modifier"],
    "restored/multiengineer.rst": ["EngineerCaptureLevel", "EngineerDamage", "EngineerAlwaysCaptureTech", "EngineerDamageCursor.*"],
    "restored/multiengineercheckbox.rst": ["AllowMultiEngineer"],
    "restored/spotlights.rst": ["HasSpotlight", "Spotlight.StartHeight", "Spotlight.Distance", "Spotlight.AttachedTo", "Spotlight.DisableRed", "Spotlight.DisableGreen", "Spotlight.DisableBlue", "Spotlight.DisableColor"],
};

interface CapabilityOverride {
    capabilityId?: string;
    parserStatus?: AresCapabilityStatus;
    normalizedModelStatus?: AresCapabilityStatus;
    runtimeStatus?: AresCapabilityStatus;
    aiStatus?: AresCapabilityStatus;
    presentationStatus?: AresCapabilityStatus;
    saveLoadStatus?: AresCapabilityStatus;
    multiplayerStatus?: AresCapabilityStatus;
    deterministic?: boolean;
    verificationStatus?: AresVerificationStatus;
    tests?: readonly string[];
    dependencies?: readonly string[];
    targetModUsage?: AresCapability["targetModUsage"];
    notes?: string;
}

const OVERRIDES: Readonly<Record<string, CapabilityOverride>> = {
    "new/additionalarmortypesandverses.rst": {
        capabilityId: "ares.additional-armor-types",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "complete",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresArmor.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "unknown",
        notes: "Dynamic armor IDs and separate automatic-acquisition, retaliation, and force-fire gates are verified.",
    },
    "new/attacheffect.rst": {
        capabilityId: "ares.status-effects",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "missing", presentationStatus: "partial", saveLoadStatus: "missing", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true,
        tests: ["AresAttachEffect.test.ts", "AresAttachEffectRuntime.test.ts", "AresAttachEffectTraitBridge.test.ts", "AresAttachEffectObjectFactory.test.ts", "AresAttachEffectCombat.test.ts", "AresAttachEffectCombatCallsites.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "required",
        notes: "AttachEffect fields for TechnoTypes and Warheads are parsed and normalized; ObjectFactory registration and the generic trait cover automatic TechnoType spawn timing, renewal, protection retry, active instances, reapplication/stacking decisions, expiry, entry discard, aggregate numeric modifiers, and the generic combat callsites apply effective Speed/Armor/Firepower/ROF decisions. Authored animations now attach to every techno renderable, loop with the unit, and are removed/recreated across cloak and TemporalHidesAnim transitions. Residual animation damage, full transport/temporal state replay, save/load, and deterministic multiplayer replay remain open.",
    },
    "new/custombuildingfoundations.rst": {
        capabilityId: "ares.custom-foundations",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "complete",
        aiStatus: "complete", presentationStatus: "partial", saveLoadStatus: "partial", multiplayerStatus: "complete",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresFoundation.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "required",
        notes: "Occupied cells and outline cells are distinct; exact placement/occupation paths are covered. The local Mental Omega 3.3.6 scan found 2,671 Foundation-related entries across 79 definitions.",
    },
    "new/customanimationandprojectilepalettes.rst": {
        capabilityId: "ares.custom-animation-palettes",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "complete",
        presentationStatus: "complete", saveLoadStatus: "complete", multiplayerStatus: "complete",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresCustomPalette.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "required",
        notes: "ObjectArt consumes explicit CustomPalette values for animation/projectile art; Theater resolves complete .pal names and the first ~~~ theater replacement. The local Mental Omega 3.3.6 scan found 541 entries in artmo.ini.",
    },
    "new/operator.rst": {
        capabilityId: "ares.operator",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "partial", presentationStatus: "partial", saveLoadStatus: "complete", multiplayerStatus: "complete",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresOperator.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "unknown",
        notes: "Specific InfantryType operators and the _ANY_ sentinel are evaluated from transport/garrison passengers. Missing operators disable movement and weapons without disabling unrelated building services; full AI/presentation parity remains open.",
    },
    "new/killingdrivers.rst": {
        capabilityId: "ares.killing-drivers",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "partial", presentationStatus: "partial", saveLoadStatus: "partial", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresKillingDrivers.test.ts"],
        dependencies: ["ares.effective-ini", "ares.operator"], targetModUsage: "unknown",
        notes: "KillDriver and ProtectedDriver are implemented through a generic driver-state trait and native owner/passenger handling. CanDrive and TechnoType/Country CanBeDriven gates feed the VehicleThief reclaim path, and RemoveVeterancy resets transferred vehicles; broader trigger/script, AI, presentation, save, and multiplayer parity remain open.",
    },
    "restored/vehicle-thief.rst": {
        capabilityId: "ares.vehicle-thief",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "partial", presentationStatus: "partial", saveLoadStatus: "partial", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresVehicleThief.test.ts"],
        dependencies: ["ares.effective-ini", "ares.killing-drivers", "ares.operator"], targetModUsage: "required",
        notes: "VehicleThief/CanDrive share a normalized hijack action path. Enemy hijack, neutral DriverKilled reclaim, TechnoType/Country CanBeDriven gates, operator passenger handling, mind-control cleanup, and absorbed-hijacker recovery/recycle state are implemented; the survivor pilot-count adapter exists but full survivor integration, building hijacks, audio, and trigger/event parity remain open. The local Mental Omega 3.3.6 scan found 271 driver/thief entries across 263 definitions.",
    },
    "new/include.rst": {
        capabilityId: "ares.effective-ini",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "complete",
        presentationStatus: "complete", saveLoadStatus: "complete", multiplayerStatus: "complete",
        verificationStatus: "synthetic", deterministic: true, tests: ["IniSourceLoader.test.ts", "AresCompatibilityScanner.test.ts"],
        dependencies: [], targetModUsage: "required",
        notes: "Depth-first include loading, duplicate/cycle/missing diagnostics, case-insensitive VFS lookup, and provenance are implemented.",
    },
    "new/prerequisites.rst": {
        capabilityId: "ares.generic-prerequisites",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "complete",
        aiStatus: "partial", presentationStatus: "partial", saveLoadStatus: "partial", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresPrerequisites.test.ts"],
        dependencies: ["ares.effective-ini", "ares.dynamic-sides-countries"], targetModUsage: "required",
        notes: "Generic groups, alternatives, negatives, stolen tech, theater requirements, and factory-owner predicates are normalized; permanent plans have a versioned production-extension codec while direct full-game snapshot integration remains open.",
    },
    "new/sidescountries.rst": {
        capabilityId: "ares.dynamic-sides-countries",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "partial", presentationStatus: "partial", saveLoadStatus: "partial", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresSides.test.ts", "AresCountrySelection.test.ts", "CountryIcon.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "required",
        notes: "Stable authored IDs, ordering, selection flags, provenance, and presentation metadata exist; legacy vanilla adapters still need migration.",
    },
    "new/superweapons.rst": {
        capabilityId: "ares.superweapons",
        parserStatus: "partial", normalizedModelStatus: "partial", runtimeStatus: "partial",
        aiStatus: "missing", presentationStatus: "partial", saveLoadStatus: "missing", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresSuperWeapons.test.ts", "AresSuperWeaponTargeting.test.ts", "AresSuperWeaponAvailability.test.ts", "AresSuperWeaponPresentationAdapter.test.ts", "AresSuperWeaponPresentationRuntime.test.ts", "AresSuperWeaponCharge.test.ts", "AresSuperWeaponChargeDrain.test.ts", "AresSuperWeaponDeferment.test.ts", "AresSuperWeaponPostDependent.test.ts", "AresSuperWeaponRadar.test.ts", "AresSuperWeaponAITargeting.test.ts", "AresSuperWeaponRange.test.ts", "AresUnitDelivery.test.ts", "AresSonarPulse.test.ts", "AresDropPod.test.ts", "AresBattery.test.ts", "AresHunterSeeker.test.ts"],
        dependencies: ["ares.effective-ini", "ares.target-filters"], targetModUsage: "required",
        notes: "The generic availability sub-capability has complete parser/model/runtime status for RequiredHouses, ForbiddenHouses, AuxBuildings, NegBuildings, AllowPlayer, AllowAI, Shots, AlwaysGranted, provider grant/revoke, and activation gating. SW.ShowCameo now filters the shared sidebar and SW.TimerVisibility filters the shared timer overlay by owner/alliance/enemy/observer relation. Authored SW.Animation and SW.AnimationVisibility are emitted at effect start after SW.Deferment, while SW.Sound and SW.ActivationSound use shared target-cell/activation audio events. SW.Group remains normalized for AI/action consumers. The aggregate superweapon surface remains partial for AI breadth, charge-lifecycle edge coverage, persistence, network certification, and remaining handlers. Hunter Seeker is tracked here as an Antares 3.0p1 reference capability because it is not a leaf in the current official documentation inventory.",
    },
    "restored/firestormwall.rst": {
        capabilityId: "ares.firestorm-wall",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        presentationStatus: "missing", saveLoadStatus: "partial", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresFirestorm.test.ts"],
        dependencies: ["ares.superweapon-charge-drain"], targetModUsage: "unknown",
        notes: "Firestorm wall metadata, same-owner linking, contact immolation, active-charge damage feedback, and hostile projectile interception are implemented; active/idle wall animation presentation and persistent/trigger/network state remain open.",
    },
    "restored/emp.rst": {
        capabilityId: "ares.emp",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "partial", presentationStatus: "partial", saveLoadStatus: "partial", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresEMP.test.ts"],
        dependencies: ["ares.effective-ini", "ares.warhead-effects"], targetModUsage: "unknown",
        notes: "Official EMP duration/cap counters, immunity defaults including SuperWeapon2 providers, same-owner EMP-capable-weapon TypeImmune, EMP.Modifier, veteran EMPIMMUNE, movement/attack paralysis, unloading-boundary deferral, power-output blackout, factory/production suspension, spawner/slave suspension, powered-superweapon pause, and aircraft crash entry are implemented. Sparkle presentation and full subsystem notifications remain separate.",
    },
    "new/destroyunitsbyemp.rst": {
        capabilityId: "ares.emp-threshold",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "partial", presentationStatus: "missing", saveLoadStatus: "partial", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresEMP.test.ts"],
        dependencies: ["ares.emp"], targetModUsage: "unknown",
        notes: "EMP.Threshold is normalized as yes/no/inair/integer and positive/in-air counter crossings destroy non-aircraft Technos through the normal world destruction path. Full hover/aircraft edge coverage, parachute integration, persistence, and network certification remain open.",
    },
    "new/gunner.rst": {
        capabilityId: "ares.ifv-modes",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "missing", presentationStatus: "partial", saveLoadStatus: "missing", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true,
        tests: ["AresTechnoExtensions.test.ts", "AresIfvRuntimeIntegration.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "required",
        notes: "IFVMode, 1-based WeaponTurretIndexX, WeaponUINameX, and VoiceIFVRepair are parsed and normalized; passenger changes re-evaluate the selected weapon, turret, and tooltip through the shared IFV path. Repair-voice consumption, full passenger weapon/turret parity, save/load, and multiplayer synchronization remain open.",
    },
    "new/chronoprisons.rst": {
        capabilityId: "ares.chrono-prisons",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "missing", presentationStatus: "partial", saveLoadStatus: "missing", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true,
        tests: ["AresChronoPrisons.test.ts", "AresChronoPrisonRuntimeDecision.test.ts", "AresChronoPrisonBridge.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "required",
        notes: "Abductor, Abductor.Temporal, Abductor.ChangeOwner, health gates, PassengerTurret, and ImmuneToAbduction are parsed into the shared rules model. Live vehicle holds now absorb eligible units, preserve conventional damage on rejection, complete temporal abduction at erase time, emit the configured animation/events, and switch PassengerTurret by passenger count. Building/infantry passenger-hold edge cases, PSIONICSIMMUNE veteran ability parity, save/load, and multiplayer synchronization remain open.",
    },
    "new/newpoweredunitlogic.rst": {
        capabilityId: "ares.powered-by",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "missing", presentationStatus: "missing", saveLoadStatus: "missing", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true,
        tests: ["AresTechnoExtensions.test.ts", "AresPoweredUnitRuntimeDecision.test.ts", "AresPoweredByTrait.test.ts", "AresPoweredByObjectFactory.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "required",
        notes: "PoweredBy is parsed as a data-defined OR-list; ObjectFactory registration and generic provider matching plus powered-unit transitions are covered by a trait bridge. Power output accounting, superweapon availability coupling, save/load, and multiplayer synchronization remain open.",
    },
    "new/urbancombattrenches.rst": {
        capabilityId: "ares.urban-combat",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "missing", presentationStatus: "missing", saveLoadStatus: "missing", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true,
        tests: ["AresUrbanCombat.test.ts", "AresUrbanCombatRuntimeAdapter.test.ts", "AresUrbanCombatProjectileHook.test.ts", "AresTechnoRulesIntegration.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "required",
        notes: "Urban Combat fields are parsed and normalized; projectile occupant pass-through, fatal-rate, and damage decisions are integrated generically. Trench traversal, raidable capture, rubble transitions, foundation validation, broader projectile/occupant integration, save/load, and multiplayer synchronization remain open.",
    },
};

/**
 * Runtime slices that span multiple official documentation sections. These
 * entries are separate from the 130-leaf official document inventory so the
 * report can distinguish a complete availability service from the still
 * partial aggregate superweapon surface.
 */
export const ARES_IMPLEMENTATION_CAPABILITIES: readonly AresCapability[] = [
    {
        id: "ares.customizable-insignia",
        title: "Generic Ares customizable insignia",
        category: "new",
        sourceDocuments: ["new/customizableinsignia.rst"],
        documentedKeys: ["Insignia.Rookie", "Insignia.Veteran", "Insignia.Elite", "InsigniaFrame.Rookie", "InsigniaFrame.Veteran", "InsigniaFrame.Elite", "Insignia.ShowEnemy", "[General]EnemyInsignia"],
        documentedSections: ["TechnoType", "General"],
        parserStatus: "complete",
        normalizedModelStatus: "complete",
        runtimeStatus: "partial",
        aiStatus: "missing",
        presentationStatus: "partial",
        saveLoadStatus: "missing",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresInsignia.test.ts"],
        dependencies: ["ares.effective-ini"],
        targetModUsage: "required",
        notes: "Rank-specific SHP/frame selection and enemy/observer visibility are wired through TechnoRules and PipOverlay. Render-host certification, missing-asset coverage, save/mod-hash, and multiplayer certification remain open.",
    },
    {
        id: "ares.customizable-veterancy",
        title: "MO-used customizable veterancy attribution",
        category: "new",
        sourceDocuments: ["new/customizableveterancy.rst"],
        documentedKeys: [
            "Trainable",
            "Experience.FromPassengers",
            "Experience.PromotePassengers",
            "Experience.PassengerModifier",
            "Experience.FromAirstrike",
            "Experience.AirstrikeModifier",
            "Experience.SpawnOwnerModifier",
            "Experience.SpawnModifier",
            "Experience.MindControlSelfModifier",
            "Experience.MindControlVictimModifier",
        ],
        documentedSections: ["TechnoType"],
        parserStatus: "complete",
        normalizedModelStatus: "complete",
        runtimeStatus: "partial",
        aiStatus: "missing",
        presentationStatus: "missing",
        saveLoadStatus: "missing",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresCustomizableVeterancy.test.ts"],
        dependencies: ["ares.effective-ini"],
        targetModUsage: "required",
        notes: "Trainable and all documented Experience.* passenger, airstrike, spawn, and mind-control modifiers are normalized and routed through generic deterministic kill attribution. Complete occupier/passenger lifecycle behavior, presentation, AI, persistence, multiplayer, and target-content certification remain open.",
    },
    {
        id: "ares.bounty",
        title: "Generic Ares Bounty rewards",
        category: "new",
        sourceDocuments: ["new/bounty.rst"],
        documentedKeys: ["BountyEnablers", "Bounty", "Bounty.Display", "Bounty.Value", "Bounty.RookieValue", "Bounty.VeteranValue", "Bounty.EliteValue", "BountyDisplay", "GivesBounty"],
        documentedSections: ["General", "AudioVisual", "TechnoType", "Country"],
        parserStatus: "complete",
        normalizedModelStatus: "complete",
        runtimeStatus: "partial",
        aiStatus: "missing",
        presentationStatus: "partial",
        saveLoadStatus: "missing",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresBounty.test.ts"],
        dependencies: ["ares.effective-ini", "ares.dynamic-sides-countries"],
        targetModUsage: "required",
        notes: "Bounty values, enablers, country gating, and weapon/crush destruction awards are wired through the generic Game.destroyObject path. Amount presentation, full-game persistence, multiplayer certification, and target-content verification remain open.",
    },
    {
        id: "ares.reverse-engineer",
        title: "Generic Ares reverse engineering",
        category: "new",
        sourceDocuments: ["new/reverseengineerlogic.rst"],
        documentedKeys: ["ReverseEngineersVictims", "CanBeReversed", "ReversedAs", "SpyEffect.Custom", "SpyEffect.UndoReverseEngineer"],
        documentedSections: ["BuildingType", "InfantryType", "VehicleType"],
        parserStatus: "complete",
        normalizedModelStatus: "complete",
        runtimeStatus: "partial",
        aiStatus: "missing",
        presentationStatus: "partial",
        saveLoadStatus: "partial",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresReverseEngineer.test.ts", "AresFactoryOwnerPersistence.test.ts"],
        dependencies: ["ares.effective-ini", "ares.generic-prerequisites"],
        targetModUsage: "required",
        notes: "Grinder entry, ReversedAs output, production prerequisite exceptions, deterministic production-extension persistence, and spy reset are wired. EVA, AI, full-game save/load, lockstep, and target-content verification remain open.",
    },
    {
        id: "ares.custom-superweapons",
        title: "MO custom-superweapon host handlers",
        category: "new",
        sourceDocuments: ["new/superweapons.rst"],
        documentedKeys: ["Type=GenericWarhead", "Type=UnitDelivery", "Type=EMPulse", "Type=SonarPulse", "Type=DropPod", "Type=HunterSeeker", "Type=Battery", "Type=Firestorm", "Type=ChronoWarp", "SW.Animation", "SW.AnimationHeight", "SW.AnimationVisibility", "SW.Sound", "SW.ActivationSound"],
        documentedSections: ["SuperWeaponTypes"],
        parserStatus: "partial",
        normalizedModelStatus: "partial",
        runtimeStatus: "partial",
        aiStatus: "partial",
        presentationStatus: "partial",
        saveLoadStatus: "missing",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresMentalOmegaSuperWeaponHost.test.ts", "AresSuperWeaponAIHost.test.ts"],
        dependencies: ["ares.effective-ini", "ares.target-filters", "ares.superweapon-ai-targeting"],
        targetModUsage: "required",
        notes: "Representative MO host fixtures reach GenericWarhead, UnitDelivery, EMPulse, SonarPulse, DropPod, HunterSeeker, Battery, Firestorm, and the ChronoWarp destination stage. Authored target-cell animation and activation/impact sound fields use the shared deferred presentation path, with explicit AnimationVisibility relation filtering. This is bounded handler/host coverage, not completion of all 96 custom definitions; unsupported handlers, full AI breadth, persistence, target-content, and multiplayer certification remain open.",
    },
    {
        id: "ares.superweapon-ai-targeting",
        title: "MO custom-superweapon AI host coverage",
        category: "new",
        sourceDocuments: ["new/superweapons.rst"],
        documentedKeys: ["SW.AITargeting", "SW.AITargeting.Constraints", "SW.AITargeting.Preference", "SW.AIRequiresTarget", "SW.AIRequiresHouse", "SW.UseAITargeting", "SW.AllowAI", "EMPulse.TargetSelf", "EMPulse.Cannons"],
        documentedSections: ["SuperWeaponTypes"],
        parserStatus: "complete",
        normalizedModelStatus: "partial",
        runtimeStatus: "partial",
        aiStatus: "partial",
        presentationStatus: "missing",
        saveLoadStatus: "missing",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresSuperWeaponAITargeting.test.ts", "AresSuperWeaponAIHost.test.ts"],
        dependencies: ["ares.effective-ini", "ares.target-filters"],
        targetModUsage: "required",
        notes: "The built-in AI host is covered for EMPulse offensive and self-targeting, UnitDelivery landing areas, and DropPod outer-sector targeting; Firestorm is excluded because it has no target cell. Native YR constraints, specialized selectors, manual UseAITargeting flow, presentation, and target-content certification remain open.",
    },
    {
        id: "ares.superweapon-post-dependent",
        title: "ChronoWarp/PostDependent two-stage host path",
        category: "new",
        sourceDocuments: ["new/superweapons.rst", "new/hardcodedunitproperties.rst"],
        documentedKeys: ["SW.PostDependent", "PreDependent", "PostClick", "Type=ChronoWarp", "SW.AffectsHouse", "SW.AffectsTarget", "SW.AllowAI"],
        documentedSections: ["SuperWeaponTypes"],
        parserStatus: "complete",
        normalizedModelStatus: "complete",
        runtimeStatus: "partial",
        aiStatus: "missing",
        presentationStatus: "partial",
        saveLoadStatus: "missing",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresSuperWeaponPostDependent.test.ts", "AresChronoWarp.test.ts"],
        dependencies: ["ares.effective-ini", "ares.target-filters"],
        targetModUsage: "required",
        notes: "Case-insensitive dependent resolution and ChronoSphere fallback are covered; the first action records the source and the ChronoWarp dependent supplies the destination to the existing ChronoSphere effect. ChronoWarp itself is not treated as a direct teleport/damage handler. Full dependent graphs, cursor/presentation resources, AI, persistence, target-content, and multiplayer certification remain open.",
    },
    {
        id: "ares.chronoshift",
        title: "Generic Ares Chronoshift eligibility",
        category: "new",
        sourceDocuments: ["new/chronoshift.rst"],
        documentedKeys: ["[TechnoType]Chronoshift.Allow", "[BuildingType]Chronoshift.IsVehicle", "[TechnoType]Chronoshift.Crushable"],
        documentedSections: ["Chronoshift"],
        parserStatus: "complete",
        normalizedModelStatus: "complete",
        runtimeStatus: "partial",
        aiStatus: "missing",
        presentationStatus: "missing",
        saveLoadStatus: "missing",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresChronoshift.test.ts", "AresCompatibilityScanner.test.ts"],
        dependencies: ["ares.effective-ini"],
        targetModUsage: "required",
        notes: "Chronoshift.Allow, Chronoshift.IsVehicle, and Chronoshift.Crushable are parsed; pure eligibility decisions cover ReconsiderBuildings and SW.AffectsTarget defaults, unit candidates are filtered through the existing Chronosphere path, and non-crushable collision handling is integrated. Buildings remain outside that lifecycle, while KillCargo, transport side effects, save/load, and multiplayer/lockstep certification remain open.",
    },
    {
        id: "ares.pcx-cameos",
        title: "Generic Ares PCX cameo resolution",
        category: "new",
        sourceDocuments: ["new/pcxcameos.rst"],
        documentedKeys: ["CameoPCX", "AltCameoPCX", "SidebarPCX"],
        documentedSections: ["TechnoType", "SuperWeapon"],
        parserStatus: "complete",
        normalizedModelStatus: "complete",
        runtimeStatus: "partial",
        aiStatus: "missing",
        presentationStatus: "partial",
        saveLoadStatus: "missing",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresPcxCameos.test.ts", "AresSuperWeapons.test.ts", "AresCompatibilityScanner.test.ts"],
        dependencies: ["ares.effective-ini"],
        targetModUsage: "required",
        notes: "CameoPCX, AltCameoPCX, and SidebarPCX are normalized with .pcx validation, 60x48 validation during GameLoader VFS discovery, and legacy fallback precedence. The validated manifest reaches the HUD, which decodes direct PCX surfaces and selects them per sidebar item with a legacy SHP fallback; save/mod-hash coverage and multiplayer certification remain open.",
    },
    {
        id: "ares.damage-particle-systems",
        title: "Generic Ares damage particle-system selection",
        category: "new",
        sourceDocuments: ["new/damageparticlesystems.rst"],
        documentedKeys: ["[TechnoType]DamageSparks", "[TechnoType]DamageSmokeParticleSystems", "[TechnoType]DamageSparksParticleSystems", "DamageParticleSystems"],
        documentedSections: ["TechnoType", "ParticleSystem"],
        parserStatus: "complete",
        normalizedModelStatus: "complete",
        runtimeStatus: "partial",
        aiStatus: "missing",
        presentationStatus: "partial",
        saveLoadStatus: "missing",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresDamageParticles.test.ts", "AresDamageParticlesTechnoIntegration.test.ts", "AresDamageParticlesRenderIntegration.test.ts", "AresCompatibilityScanner.test.ts"],
        dependencies: ["ares.effective-ini"],
        targetModUsage: "required",
        notes: "DamageSparks and explicit Smoke/Spark particle lists are normalized in TechnoRules with Ares defaults. BehavesLike fallback is metadata-aware: the pure adapter filters when ParticleSystem metadata is supplied, while the current TechnoRules path lacks that metadata lookup and preserves the vanilla candidate list. The resolved smoke list reaches the existing vehicle render gate; ParticleSystem metadata lookup, health-threshold spawning/random selection, sparks, infantry/building/aircraft coverage, save/load, and multiplayer certification remain open.",
    },
    {
        id: "ares.superweapon-availability",
        title: "Generic Ares superweapon availability and grant/revoke",
        category: "new",
        sourceDocuments: ["new/superweapons.rst"],
        documentedKeys: [
            "SW.RequiredHouses", "SW.ForbiddenHouses", "SW.AuxBuildings", "SW.NegBuildings",
            "SW.AllowPlayer", "SW.AllowAI", "SW.Shots", "SW.AlwaysGranted",
            "SW.ShowCameo", "SW.TimerVisibility", "SW.Group",
        ],
        documentedSections: ["SuperWeapon"],
        parserStatus: "complete",
        normalizedModelStatus: "complete",
        runtimeStatus: "complete",
        aiStatus: "partial",
        presentationStatus: "partial",
        saveLoadStatus: "partial",
        multiplayerStatus: "partial",
        deterministic: true,
        verificationStatus: "synthetic",
        tests: ["AresSuperWeaponAvailability.test.ts", "AresSuperWeapons.test.ts", "AresSuperWeaponPresentationAdapter.test.ts", "AresCompatibilityScanner.test.ts"],
        dependencies: ["ares.effective-ini", "ares.target-filters"],
        targetModUsage: "required",
        notes: "Parser/evaluator, generic owner adapter, provider-based grant/revoke, AlwaysGranted, finite Shots, activation-time shot gating, shared SW.ShowCameo sidebar filtering, and relation-aware SW.TimerVisibility timer filtering are implemented. SW.Group is retained as normalized data for AI/action consumers; broader AI certification, persistence, and multiplayer/network certification remain partial.",
    },
];

function capabilityIdFor(path: string): string {
    return `ares.docs.${path.replace(/\.rst$/i, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function defaultCapability(path: string): AresCapability {
    const override = OVERRIDES[path] ?? {};
    const category = categoryFor(path);
    return {
        id: override.capabilityId ?? capabilityIdFor(path),
        title: titleFor(path),
        category,
        sourceDocuments: [path],
        documentedKeys: DOCUMENTED_KEYS[path] ?? [],
        documentedSections: [],
        parserStatus: override.parserStatus ?? "missing",
        normalizedModelStatus: override.normalizedModelStatus ?? "missing",
        runtimeStatus: override.runtimeStatus ?? "missing",
        aiStatus: override.aiStatus ?? "missing",
        presentationStatus: override.presentationStatus ?? "missing",
        saveLoadStatus: override.saveLoadStatus ?? "missing",
        multiplayerStatus: override.multiplayerStatus ?? "missing",
        deterministic: override.deterministic ?? false,
        verificationStatus: override.verificationStatus ?? "unverified",
        tests: override.tests ?? [],
        dependencies: override.dependencies ?? ["ares.effective-ini"],
        targetModUsage: override.targetModUsage ?? "unknown",
        notes: override.notes,
    };
}

/** Every non-index leaf in the official Ares documentation tree. */
export const ARES_FEATURE_CATALOG: readonly AresCapability[] = DOCUMENTATION_PATHS.map(defaultCapability);

export const ARES_DOCUMENTATION_DOCUMENTS: readonly AresDocumentationDocument[] = ARES_FEATURE_CATALOG.map((feature) => ({
    path: feature.sourceDocuments[0],
    category: feature.category,
    capabilityId: feature.id,
}));

export function getAresCapability(id: string): AresCapability | undefined {
    return ARES_FEATURE_CATALOG.find((feature) => feature.id === id);
}

export function getAresImplementationCapability(id: string): AresCapability | undefined {
    return ARES_IMPLEMENTATION_CAPABILITIES.find((feature) => feature.id === id);
}

export function getAresCatalogSummary(): {
    documents: number;
    capabilities: number;
    categories: Record<AresDocumentationCategory, number>;
    completeRuntime: number;
    partialRuntime: number;
    missingRuntime: number;
} {
    const categories: Record<AresDocumentationCategory, number> = { new: 0, restored: 0, bugfix: 0, ui: 0 };
    for (const feature of ARES_FEATURE_CATALOG) categories[feature.category]++;
    return {
        documents: ARES_DOCUMENTATION_DOCUMENTS.length,
        capabilities: ARES_FEATURE_CATALOG.length,
        categories,
        completeRuntime: ARES_FEATURE_CATALOG.filter((feature) => feature.runtimeStatus === "complete").length,
        partialRuntime: ARES_FEATURE_CATALOG.filter((feature) => feature.runtimeStatus === "partial").length,
        missingRuntime: ARES_FEATURE_CATALOG.filter((feature) => feature.runtimeStatus === "missing").length,
    };
}
