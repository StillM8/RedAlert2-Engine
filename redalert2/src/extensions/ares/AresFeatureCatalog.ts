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
    "new/avoidableinternalerrors.rst",
    "new/chronoprisons.rst",
    "new/chronoshift.rst",
    "new/customanimationandprojectilepalettes.rst",
    "new/custombuildingfoundations.rst",
    "new/customcameopalettes.rst",
    "new/customizableinsignia.rst",
    "new/customizableparachuteanimations.rst",
    "new/customizableveterancy.rst",
    "new/destroyunitsbyemp.rst",
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
    "new/chronoprisons.rst": ["[Weapon]Abductor", "[TechnoType]PassengerTurret"],
    "new/chronoshift.rst": ["[TechnoType]Chronoshift.Allow", "[BuildingType]Chronoshift.IsVehicle"],
    "new/customanimationandprojectilepalettes.rst": ["[Animation]CustomPalette"],
    "new/custombuildingfoundations.rst": ["Foundation=Custom", "Foundation.N", "FoundationOutline.Length", "FoundationOutline.N"],
    "new/customcameopalettes.rst": ["[UnitArt]CameoPalette", "[SuperWeapon]SidebarPalette"],
    "new/customizableinsignia.rst": ["Insignia.Rookie", "Insignia.Veteran", "Insignia.Elite"],
    "new/customizableparachuteanimations.rst": ["Parachute.Anim"],
    "new/customizableveterancy.rst": ["Experience.FromPassengers", "Experience.PromotePassengers", "Experience.PassengerModifier", "Experience.FromAirstrike", "Experience.AirstrikeModifier", "Experience.MindControlSelfModifier"],
    "new/destroyunitsbyemp.rst": ["[TechnoType]EMP.Threshold"],
    "new/include.rst": ["[#include]"],
    "new/killingdrivers.rst": ["[Warhead]KillDriver", "[TechnoType]ProtectedDriver", "[TechnoType]CanDrive"],
    "new/lightningrods.rst": ["[BuildingType]LightningRod", "LightningRod.Modifier"],
    "restored/firestormwall.rst": ["Firestorm.Wall", "SubjectToFirestorm", "FirestormActiveAnim", "FirestormIdleAnim", "FirestormGroundAnim", "FirestormAirAnim", "FirestormWarhead", "DamageToFirestormDamageCoefficient"],
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
    "new/superweapons.rst": ["SW.FireIntoShroud", "SW.AutoFire", "SW.ManualFire", "UseChargeDrain", "ChargeToDrainRatio", "SW.ChargeToDrainRatio", "SW.Unstoppable", "SW.Range", "SW.CreateRadarEvent", "SW.Deferment", "SW.PostDependent", "SW.UseAITargeting", "SW.AITargeting", "SW.AITargeting.Constraints", "SW.AITargeting.Preference", "SW.AIRequiresTarget", "SW.AIRequiresHouse", "SW.InitialReady", "SW.VirtualCharge", "Money.Amount", "Money.DrainAmount", "Money.DrainDelay", "SW.Animation", "EVA.*", "Message.*", "Text.*", "Light.*", "Lightning.*", "Nuke.*", "Dominator.*", "Chronosphere.*", "Protect.*", "Mutate.*", "ParaDrop.*", "SpyPlane.*", "SonarPulse.Delay", "Deliver.Types", "DropPod.Types", "DropPod.Minimum", "DropPod.Maximum", "DropPod.Veterancy", "DropPodWeapon", "DropPodTrailer", "EMPulse.Linked", "EMPulse.TargetSelf", "EMPulse.PulseDelay", "EMPulse.PulseBall", "EMPulse.Cannons", "EMPulseCannon"],
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
    "new/custombuildingfoundations.rst": {
        capabilityId: "ares.custom-foundations",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "complete",
        aiStatus: "complete", presentationStatus: "partial", saveLoadStatus: "partial", multiplayerStatus: "complete",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresFoundation.test.ts"],
        dependencies: ["ares.effective-ini"], targetModUsage: "unknown",
        notes: "Occupied cells and outline cells are distinct; exact placement/occupation paths are covered.",
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
        notes: "KillDriver and ProtectedDriver are implemented through a generic driver-state trait and native owner/passenger handling. CanDrive parsing and driverless-state exposure are present; VehicleThief/reclaim interaction, full veterancy removal, and trigger/script entry points remain open.",
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
        verificationStatus: "synthetic", deterministic: true, tests: ["AresSuperWeapons.test.ts", "AresSuperWeaponTargeting.test.ts", "AresSuperWeaponCharge.test.ts", "AresSuperWeaponChargeDrain.test.ts", "AresSuperWeaponDeferment.test.ts", "AresSuperWeaponPostDependent.test.ts", "AresSuperWeaponRadar.test.ts", "AresSuperWeaponAITargeting.test.ts", "AresSuperWeaponRange.test.ts", "AresUnitDelivery.test.ts", "AresSonarPulse.test.ts", "AresDropPod.test.ts", "AresBattery.test.ts", "AresHunterSeeker.test.ts"],
        dependencies: ["ares.effective-ini", "ares.target-filters"], targetModUsage: "required",
        notes: "Common fields, SW.Range for supported ranged effects, SW.Deferment for supported state machines, Money.Amount launch transactions, charge-drain timer/ratio/money scheduling, manual SW.RequiresTarget/SW.RequiresHouse gates, InitialReady/VirtualCharge timer state, PostDependent stage selection, common radar-event delivery, target filters, GenericWarhead, UnitDelivery, SonarPulse, the EMPulse launch state, the Antares DropPod core placement handler, the Antares Battery power/online/overpower core, and the Antares Hunter Seeker launch/target/detonation core are present; Firestorm presentation, Battery action/persistence, Hunter Seeker flight choreography, animation/presentation, AI, persistence, and the remaining handlers are not complete. Hunter Seeker is tracked here as an Antares 3.0p1 reference capability because it is not a leaf in the current official documentation inventory.",
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
        notes: "Official EMP duration/cap counters, immunity defaults, EMP.Modifier, veteran EMPIMMUNE, movement/attack paralysis, unloading-boundary deferral, power-output blackout, factory/production suspension, spawner/slave suspension, powered-superweapon pause, and aircraft crash entry are implemented. Sparkle presentation and full subsystem notifications remain separate.",
    },
    "new/destroyunitsbyemp.rst": {
        capabilityId: "ares.emp-threshold",
        parserStatus: "complete", normalizedModelStatus: "complete", runtimeStatus: "partial",
        aiStatus: "partial", presentationStatus: "missing", saveLoadStatus: "partial", multiplayerStatus: "partial",
        verificationStatus: "synthetic", deterministic: true, tests: ["AresEMP.test.ts"],
        dependencies: ["ares.emp"], targetModUsage: "unknown",
        notes: "EMP.Threshold is normalized as yes/no/inair/integer and positive/in-air counter crossings destroy non-aircraft Technos through the normal world destruction path. Full hover/aircraft edge coverage, parachute integration, persistence, and network certification remain open.",
    },
};

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
