import { AresFeatureRegistry, createDefaultAresFeatureRegistry, type ExtensionFeature } from "./AresFeatureRegistry";
import type { IniSourceLoader } from "@/engine/IniSourceLoader";
import { getGameProfile, type GameProfileDescriptor } from "@/engine/GameProfile";
import { scanIniDependencies, type IniDependencyGraph } from "./AresDependencyScanner";

export interface IniScanSource {
    name: string;
    contents: string;
}

export const INI_SECTION_KINDS = [
    "General",
    "AudioVisual",
    "CombatDamage",
    "Country",
    "Side",
    "Techno",
    "Infantry",
    "Vehicle",
    "Aircraft",
    "Building",
    "Weapon",
    "Projectile",
    "Warhead",
    "Animation",
    "SuperWeapon",
    "AI",
    "ScriptType",
    "TaskForce",
    "TeamType",
    "Trigger",
    "Event",
    "Action",
    "UI",
    "Sound",
    "Unknown",
] as const;

export type IniSectionKind = typeof INI_SECTION_KINDS[number];

export type IniKeyClassification = "vanilla" | "ares-known" | "mo-content" | "unclassified";

export interface IniKeyReference {
    source: string;
    line: number;
    section: string;
    sectionKind: IniSectionKind;
    key: string;
    value: string;
    classification: IniKeyClassification;
    featureId?: string;
}

export interface IniKeyUsage {
    key: string;
    occurrences: number;
    sourceFiles: string[];
    sectionKinds: IniSectionKind[];
    sampleSections: string[];
    sampleValues: string[];
}

export interface AresFeatureUsage {
    featureId: string;
    occurrences: number;
    /** Number of distinct INI source files contributing this feature. */
    sourceCount: number;
    /** Number of distinct sections containing this feature. */
    sectionCount: number;
    /** Number of distinct definitions affected by this feature. */
    definitionCount: number;
    references: IniKeyReference[];
    support?: ExtensionFeature;
}

export interface MentalOmegaCompatibilityReport {
    sourceCount: number;
    sectionCount: number;
    keyCount: number;
    uniqueKeys: number;
    uniqueAresKeys: number;
    uniqueMoContentKeys: number;
    uniqueUnclassifiedKeys: number;
    aresKnownKeys: number;
    moContentKeys: number;
    unclassifiedKeys: number;
    vanillaKeys: number;
    references: IniKeyReference[];
    featureUsage: AresFeatureUsage[];
    moContentUsage: IniKeyUsage[];
    unclassifiedUsage: IniKeyUsage[];
    dependencyGraph: IniDependencyGraph;
    sideCountryCoverage: {
        sideDefinitions: number;
        sideReferences: number;
        unknownSideReferences: number;
        countryDefinitions: number;
        countryReferences: number;
        unknownCountryReferences: number;
    };
}

const DEFINITION_LIST_SECTION_KINDS: Readonly<Record<string, IniSectionKind>> = {
    armortypes: "Warhead",
    sides: "Side",
    countries: "Country",
    multiplayercountries: "Country",
    aicountries: "Country",
    technotypes: "Techno",
    infantrytypes: "Infantry",
    vehicletypes: "Vehicle",
    aircrafttypes: "Aircraft",
    buildingtypes: "Building",
    animtypes: "Animation",
    weapontypes: "Weapon",
    warheadtypes: "Warhead",
    projectiletypes: "Projectile",
    superweapontypes: "SuperWeapon",
    scripttypes: "ScriptType",
    taskforces: "TaskForce",
    teamtypes: "TeamType",
    triggers: "Trigger",
    events: "Event",
    actions: "Action",
    tags: "Action",
    cels: "Action",
    celltags: "Action",
};

const DIRECT_SECTION_KINDS: Readonly<Record<string, IniSectionKind>> = {
    general: "General",
    audiovisual: "AudioVisual",
    combatdamage: "CombatDamage",
    ai: "AI",
    aitriggertypes: "AI",
    aiscripts: "AI",
    soundlist: "Sound",
    sound: "Sound",
    ui: "UI",
    advancedcommandbar: "UI",
    multiplayeradvancedcommandbar: "UI",
};

const COMMON_VANILLA_KEYS = /^(?:name|uiname|image|art|cost|power|strength|health|armor|speed|sight|range|rof|primary|secondary|eliteprimary|elitesec|weapon|warhead|projectile|owner|prerequisite|techlevel|buildlimit|category|locomotor|movementzone|size|foundation|ammo|burst|damage|verses|cellspread|percent|anim|report|sound|sounds|volume|control|delay|fshift|cloak|cloakable|capturable|spyable|passengers|passengersexits|opentopped|open topped|naval|type|action|palette|superweapons|newtheater|theater|normalized|points|rate|maxdebris|mindebris|min_debris|usenormallight|layer|explosion|insignificant|height|occupyheight|loopcount|loopstart|loopend|chronoshift\.allow|shadow|nominal|canbehidden|canhide|canhidethings|basenormal|remapable|threatposed|damagefireoffset\d+|damagesmokeoffset|debrisanims|start|clickrepairable|voiceselect|voicemove|voiceattack|soylent|bright|allowedtostartinmultiplayer|priority|vshift|wall|translucent|wood|voxel|animlist|infdeath|canbeoccupied|canoccupyfire|isselectablecombatant|die|diesound|deathweapon|voices?|rot|crew|crewed|crushsound|leaverubble|primaryfireflh|turret|movesound|zadjust|weight|radarinvisible|crategoodie|subjecttoelevation|subjecttocliffs|subjecttowalls|conventional|activeanim|activeanimzadjust|activeanimpowered|activeanimdamaged|crusher|damagesound|muzzleflash\d+|eliteabilities|veteranabilities|selectable|radarcolor|specialthreatvalue|aibaseplanningside|fireup|addoccupy\d+|minimumrange|maxnumberoccupants|translucency|ysortadjust|zfudgecolumn|zfudgetunnel|aa|ag|powered|accelerates|adjacent|percentatmax|sparky|immunetopsionics|buildcat|bounty\.value)$/i;

const SECTION_VANILLA_KEYS: Readonly<Record<IniSectionKind, RegExp>> = {
    General: /^(?:baseunit|buildspeed|credits|startingunits|startingcredits|timer|unitcount|harvestercount|aislots|walls|water|tiberium|ore|growth|repair|repairbay|forbiddenhouses|requiredhouses|sides|alliances|storage|harvesters|refinery|conyard|radar|cloakable|infiltratable|selectable|voice|theme|scenario|game|map|theater)$/i,
    AudioVisual: /^(?:conditionyellow|conditionred|dropzoneradius|message|shroud|repairanim|moveflash|behind|flyerhelper)$/i,
    CombatDamage: /^(?:conditionyellow|conditionred|healthbar|firepower|armors|veteran|elite)$/i,
    Country: /^(?:0|\d+|name|uiname|side|color|prefix|suffix|loadscreen|flag|multiplayer|selectable|crew|survivordivisor|buildings|units|infantry|vehicles|aircraft)$/i,
    Side: /^(?:0|\d+|name|uiname|side|color|prefix|suffix|loadscreen|flag|multiplayer|selectable|crew|survivordivisor|buildings|units|infantry|vehicles|aircraft)$/i,
    Techno: COMMON_VANILLA_KEYS,
    Infantry: COMMON_VANILLA_KEYS,
    Vehicle: COMMON_VANILLA_KEYS,
    Aircraft: COMMON_VANILLA_KEYS,
    Building: COMMON_VANILLA_KEYS,
    Weapon: COMMON_VANILLA_KEYS,
    Projectile: COMMON_VANILLA_KEYS,
    Warhead: COMMON_VANILLA_KEYS,
    Animation: COMMON_VANILLA_KEYS,
    SuperWeapon: COMMON_VANILLA_KEYS,
    AI: /^(?:0|\d+|name|uiname|side|country|house|team|taskforce|script|trigger|event|action|priority|weight|autocreate|prebuild|reinforcements|annoyance|whiner)$/i,
    ScriptType: /^(?:0|\d+|name|script|team|taskforce|priority|house|trigger|event|action|teamtype|waypoint|count|condition|parameter|recruiter|transports|autocreate|whiner|annoyance|prebuild|reinforcements)$/i,
    TaskForce: /^(?:0|\d+|name|techno|count|weight|group)$/i,
    TeamType: /^(?:0|\d+|name|script|taskforce|house|priority|autocreate|whiner|annoyance|prebuild|reinforcements)$/i,
    Trigger: /^(?:0|\d+|name|event|action|tag|team|house)$/i,
    Event: /^(?:0|\d+|name|event|action|tag|team|house|parameter)$/i,
    Action: /^(?:0|\d+|name|event|action|tag|team|house|parameter|waypoint)$/i,
    UI: /^(?:0|\d+|name|image|art|button|text|x|y|width|height|color|font|sound|command|list)$/i,
    Sound: /^(?:0|\d+|name|sound|report|voice|volume|limit|range|type|prio|priority|control)$/i,
    Unknown: /a^/,
};

const MO_CONTENT_SECTION_KINDS = new Set<IniSectionKind>([
    "AI", "ScriptType", "TaskForce", "TeamType", "Trigger", "Event", "Action", "UI", "Sound",
]);

interface ParsedIniEntry {
    source: string;
    line: number;
    section: string;
    key: string;
    value: string;
}

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function parseIniEntries(source: IniScanSource): ParsedIniEntry[] {
    const entries: ParsedIniEntry[] = [];
    let section = "(global)";
    const lines = source.contents.replace(/^\uFEFF/, "").split(/\r?\n/);
    lines.forEach((rawLine, index) => {
        const line = rawLine.trim();
        if (!line || line.startsWith(";") || line.startsWith("#")) return;
        const sectionMatch = line.match(/^\[([^\]]+)\]/);
        if (sectionMatch) {
            section = sectionMatch[1].trim();
            return;
        }
        const equals = line.indexOf("=");
        if (equals <= 0) return;
        const key = line.slice(0, equals).trim();
        const value = line.slice(equals + 1).trim().replace(/\s+[;#].*$/, "");
        entries.push({ source: source.name, line: index + 1, section, key, value });
    });
    return entries;
}

function directSectionKind(section: string): IniSectionKind {
    const normalized = normalize(section);
    return DIRECT_SECTION_KINDS[normalized] ?? DEFINITION_LIST_SECTION_KINDS[normalized] ??
        (/^specialweapons$/i.test(section) ? "SuperWeapon" : "Unknown");
}

function buildSectionKinds(sources: readonly IniScanSource[]): Map<string, IniSectionKind> {
    const sectionKinds = new Map<string, IniSectionKind>();
    const setKind = (name: string, kind: IniSectionKind): void => {
        const key = normalize(name);
        const previous = sectionKinds.get(key);
        if (!previous || previous === "Unknown") {
            sectionKinds.set(key, kind);
        }
        else if (previous !== kind) {
            sectionKinds.set(key, "Unknown");
        }
    };

    for (const source of sources) {
        const entries = parseIniEntries(source);
        const listSections = new Map<string, IniSectionKind>();
        for (const entry of entries) {
            const kind = directSectionKind(entry.section);
            if (kind !== "Unknown") setKind(entry.section, kind);
            const listKind = DEFINITION_LIST_SECTION_KINDS[normalize(entry.section)];
            if (listKind) listSections.set(normalize(entry.section), listKind);
        }
        for (const entry of entries) {
            const listKind = listSections.get(normalize(entry.section));
            if (!listKind || /^\d+$/.test(entry.key) === false) continue;
            for (const definition of entry.value.split(",")) {
                if (definition.trim()) setKind(definition, listKind);
            }
        }
    }
    return sectionKinds;
}

function sectionKindFor(section: string, sectionKinds: Map<string, IniSectionKind>): IniSectionKind {
    return sectionKinds.get(normalize(section)) ?? directSectionKind(section);
}

function isDefinitionListSection(section: string): boolean {
    return Object.prototype.hasOwnProperty.call(DEFINITION_LIST_SECTION_KINDS, normalize(section));
}

const VANILLA_SUPERWEAPON_TYPES = new Set([
    "airstrike", "amerparadrop", "chronosphere", "chronoshift", "forceshield", "geneticmutator",
    "ironcurtain", "lightningstorm", "multimissile", "nuke", "paradrop", "psychicdominator",
    "psychicreveal", "spyplane",
]);

function isVanillaKey(section: string, sectionKind: IniSectionKind, key: string, value: string): boolean {
    if (isDefinitionListSection(section) && (/^\d+$/.test(key) || /^(?:name|uiname)$/i.test(key))) {
        return true;
    }
    if (/^type$/i.test(key) && sectionKind === "SuperWeapon") {
        return VANILLA_SUPERWEAPON_TYPES.has(normalize(value));
    }
    // A common base-game field remains vanilla even when the surrounding
    // art/sound/object section is not present in one of the definition lists.
    // This is intentionally checked before the Unknown guard: unknown context
    // must not imply Ares, but it also must not turn ordinary shared schema
    // fields into false extension candidates.
    if (COMMON_VANILLA_KEYS.test(key)) return true;
    if (sectionKind === "Unknown") return false;
    return SECTION_VANILLA_KEYS[sectionKind].test(key);
}

function isMoContentKey(section: string, sectionKind: IniSectionKind, key: string): boolean {
    return MO_CONTENT_SECTION_KINDS.has(sectionKind) ||
        /^mo(?:[._-]|$)/i.test(section) ||
        /^mo(?:[._-]|$)/i.test(key);
}

const ARES_SUPERWEAPON_TYPE_FEATURES: Readonly<Record<string, string>> = {
    genericwarhead: "ares.custom-superweapons",
    unitdelivery: "ares.custom-superweapons",
    firestorm: "ares.firestorm-wall",
    hunterseeker: "ares.superweapon-hunter-seeker",
    droppod: "ares.superweapon-drop-pod",
    empulse: "ares.superweapon-empulse",
    battery: "ares.superweapon-battery",
    sonarpulse: "ares.custom-superweapons",
    chronowarp: "ares.custom-superweapons",
};

function featureForKey(section: string, sectionKind: IniSectionKind, key: string, value: string): string | undefined {
    if (/^attacheffect\./i.test(key)) {
        return "ares.status-effects";
    }
    if (/^(?:ifvmode|weaponturretindex\d+|weaponuiname\d+|voiceifvrepair)$/i.test(key)) {
        return "ares.ifv-modes";
    }
    if (/^poweredby$/i.test(key)) {
        return "ares.powered-by";
    }
    if (/^(?:abductor(?:\.(?:temporal|anim|changeowner|abductbelowpercent|maxhealth))?)$/i.test(key) &&
        sectionKind === "Weapon") {
        return "ares.chrono-prisons";
    }
    if (/^(?:passengerturret|immunetoabduction)$/i.test(key) &&
        ["Techno", "Infantry", "Vehicle", "Aircraft", "Building"].includes(sectionKind)) {
        return "ares.chrono-prisons";
    }
    if ((/^(?:uc\.(?:passthrough|fatalrate|damagemultiplier)|bunker\.raidable|rubble\.(?:destroyed|intact)(?:\.(?:remove|owner|strength|anim))?|istrench|canbeoccupiedby)$/i.test(key) &&
            sectionKind === "Building") ||
        (/^subjecttotrenches$/i.test(key) && sectionKind === "Projectile")) {
        return "ares.urban-combat";
    }
    if (/^(?:insignia\.(?:rookie|veteran|elite)|insigniaframe\.(?:rookie|veteran|elite)|insignia\.showenemy|enemyinsignia)$/i.test(key)) {
        return "ares.customizable-insignia";
    }
    if (/^(?:bounty(?:\.(?:display|value|rookievalue|veteranvalue|elitevalue))?|bountyenablers|bountydisplay|givesbounty)$/i.test(key)) {
        return "ares.bounty";
    }
    if (/^trainable$/i.test(key) && /^(?:techno|infantry|vehicle|aircraft|building)$/i.test(sectionKind)) {
        return "ares.customizable-veterancy";
    }
    if (/^chronoshift\.(?:allow|isvehicle|crushable)$/i.test(key)) {
        return "ares.chronoshift";
    }
    if (/^(?:damageparticlesystems|damagesparks|damagesmokeparticlesystems|damagesparksparticlesystems)$/i.test(key)) {
        return "ares.damage-particle-systems";
    }
    if (/^(?:cameopcx|altcameopcx|sidebarpcx)$/i.test(key)) {
        return "ares.pcx-cameos";
    }
    if (/^canbereversed$/i.test(key)) {
        return "ares.reverse-engineer";
    }
    if (sectionKind === "SuperWeapon" && /^type$/i.test(key)) {
        const typeFeature = ARES_SUPERWEAPON_TYPE_FEATURES[normalize(value)];
        if (typeFeature) return typeFeature;
    }
    if (/^emp\.threshold$/i.test(key)) {
        return "ares.emp-threshold";
    }
    if (/^empulsecannon$/i.test(key)) {
        return "ares.superweapon-empulse";
    }
    if (/^(?:emp\.(?:duration|cap|sparkles)|immuneToEMP|emp\.modifier)$/i.test(key)) {
        return "ares.emp";
    }
    if (/^genericprerequisites$/i.test(section)) {
        return "ares.generic-prerequisites";
    }
    if (/^factoryowners(?:\.(?:forbidden|hasallplans|permanent))?$/i.test(key)) {
        return "ares.factory-owner-prerequisites";
    }
    if (/^prerequisite\.(?:list\d+|lists|negative|requiredtheaters|stolentechs)$/i.test(key) ||
        (/^general$/i.test(section) && /^prerequisite.+alternate$/i.test(key))) {
        return "ares.generic-prerequisites";
    }
    if (/^armortypes$/i.test(section) || /^versus\./i.test(key)) {
        return "ares.additional-armor-types";
    }
    if (/^operator$/i.test(key)) {
        return "ares.operator";
    }
    if (/^(?:killdriver|killdriver\.(?:killbelowpercent|chance|owner|removeveterancy))$/i.test(key) ||
        /^(?:protecteddriver|protecteddriver\.minhealth|candrive)$/i.test(key)) {
        return "ares.killing-drivers";
    }
    if (/^(?:vehiclethief|vehiclethief\.(?:entersound|leavesound|killpilots|breakmindcontrol|allowed|onetime))$/i.test(key)) {
        return "ares.vehicle-thief";
    }
    if (/^custompalette$/i.test(key)) {
        return "ares.custom-animation-palettes";
    }
    if (/^empulse\./i.test(key) || /^empulsecannon$/i.test(key)) {
        return "ares.superweapon-empulse";
    }
    if (/^droppod\./i.test(key) ||
        (/^general$/i.test(section) && /^droppod(?:types|minimum|maximum|trailer)$/i.test(key)) ||
        (/^type$/i.test(key) && /^droppod$/i.test(value))) {
        return "ares.superweapon-drop-pod";
    }
    if (/^sw\.(?:requirestarget|requireshouse)$/i.test(key)) {
        return "ares.superweapon-target-requirements";
    }
    if (/^sw\.fireintoshroud$/i.test(key)) {
        return "ares.superweapon-shroud-targeting";
    }
    if (/^sw\.(?:autofire|manualfire)$/i.test(key)) {
        return "ares.superweapon-fire-mode";
    }
    if (/^sw\.(?:initialready|virtualcharge)$/i.test(key)) {
        return "ares.superweapon-charge-state";
    }
    if (/^firestorm\.wall$/i.test(key) || /^subjecttofirestorm$/i.test(key) || /^ignoresfirestorm$/i.test(key)) {
        return "ares.firestorm-wall";
    }
    if (/^(?:usechargedrain|chargetodrainratio)$/i.test(key) ||
        /^sw\.(?:chargetodrainratio|unstoppable)$/i.test(key)) {
        return "ares.superweapon-charge-drain";
    }
    if (/^sw\.deferment$/i.test(key)) {
        return "ares.superweapon-deferment";
    }
    if (/^sw\.postdependent$/i.test(key)) {
        return "ares.superweapon-post-dependent";
    }
    if (/^sw\.createradarevent$/i.test(key)) {
        return "ares.superweapon-radar-event";
    }
    if (/^sw\.(?:range|rangeminimum|rangemaximum)$/i.test(key)) {
        return "ares.superweapon-range";
    }
    if (/^sw\.(?:aitargeting|aitargeting\.constraints|aitargeting\.preference|airequirestarget|airequireshouse|useaitargeting)$/i.test(key)) {
        return "ares.superweapon-ai-targeting";
    }
    if (/^money\.(?:drainamount|draindelay)$/i.test(key)) {
        return "ares.superweapon-charge-drain";
    }
    if (/^money\.amount$/i.test(key)) {
        return "ares.superweapon-money";
    }
    if (/^(?:sw\.(?:requiredhouses|forbiddenhouses|auxbuildings|negbuildings|allowplayer|allowai|shots|alwaysgranted|showcameo|timervisibility|group))$/i.test(key)) {
        return "ares.superweapon-availability";
    }
    if (/^sw\.(?:affectshouse|affectstarget)$/i.test(key)) {
        return "ares.target-filters";
    }
    if (/^battery\./i.test(key) ||
        (/^type$/i.test(key) && /^battery$/i.test(value))) {
        return "ares.superweapon-battery";
    }
    if (/^hunterseeker\./i.test(key) ||
        (/^specialweapons$/i.test(section) && /^hsbuilding$/i.test(key)) ||
        (/^general$/i.test(section) && /^hunterseeker(?:detonateproximity|descendproximity|ascentspeed|descentspeed|emergespeed)$/i.test(key)) ||
        // Antares reads the side-level HunterSeeker value from the authored
        // side section itself; side names are data-defined, so do not restrict
        // this to literal [Side]/[Sides] section names.
        (/^hunterseeker$/i.test(key) && !/^(?:general|specialweapons)$/i.test(section)) ||
        (/^type$/i.test(key) && /^hunterseeker$/i.test(value))) {
        return "ares.superweapon-hunter-seeker";
    }
    if (/^(?:sw\.(?:inhibitors|designators|animation|animationheight|sound|activationsound|cursor|nocursor|warhead|damage|maxcount)|deliver\.(?:types|owner|basenormal)|droppod\.(?:types|veterancy|minimum|maximum|weapon|trailer)|genericwarhead\.|chronowarp\.|sonarpulse\.)/i.test(key) ||
        /^(?:eva|text)\./i.test(key)) {
        return "ares.custom-superweapons";
    }
    if (/^type$/i.test(key)) {
        return ARES_SUPERWEAPON_TYPE_FEATURES[normalize(value)];
    }
    if (/^foundation$/i.test(key) && /custom/i.test(value)) return "ares.custom-foundations";
    if (/^foundation\.(?:x|y|\d+|outline(?:\.length|\.\d+)?)$/i.test(key)) return "ares.custom-foundations";
    if (/^(splits|airburst(?:weapon|spread)?|cluster|proximity|aroundtarget|retarget(?:accuracy|self)?)\b/i.test(key)) {
        return "ares.projectile-extensions";
    }
    if (/^(stage|weaponstage|burstdelay|charge)\b/i.test(key)) return "ares.staged-weapons";
    if (/^(passengerdelete|passengerconsume|passengerslots?)\b/i.test(key)) return "ares.passenger-extensions";
    if (/^(palette|animpalette|projectilepalette)$/i.test(key) && /anim|projectile|weapon|warhead/i.test(section)) {
        return "ares.custom-animation-palettes";
    }
    return undefined;
}

function referenceIdentity(reference: IniKeyReference): {
    source: string;
    section: string;
    definition: string;
} {
    const source = reference.source.toLocaleLowerCase("en-US");
    const section = reference.section.toLocaleLowerCase("en-US");
    // In list sections, each key/value entry defines a distinct object. In
    // object sections, the section itself is the definition. This keeps the
    // report useful for both [ArmorTypes] tables and [SomeUnit] sections.
    const definition = isDefinitionListSection(reference.section)
        ? `${section}\0${reference.key.toLocaleLowerCase("en-US")}`
        : section;
    return { source, section: `${source}\0${section}`, definition: `${source}\0${definition}` };
}

function parseSource(source: IniScanSource, sectionKinds: Map<string, IniSectionKind>): IniKeyReference[] {
    return parseIniEntries(source).map((entry) => {
        const sectionKind = sectionKindFor(entry.section, sectionKinds);
        const featureId = featureForKey(entry.section, sectionKind, entry.key, entry.value);
        const classification: IniKeyClassification = featureId
            ? "ares-known"
            : isVanillaKey(entry.section, sectionKind, entry.key, entry.value)
                ? "vanilla"
                : isMoContentKey(entry.section, sectionKind, entry.key)
                    ? "mo-content"
                    : "unclassified";
        return {
            source: entry.source,
            line: entry.line,
            section: entry.section,
            sectionKind,
            key: entry.key,
            value: entry.value,
            classification,
            ...(featureId ? { featureId } : {}),
        };
    });
}

function keyUsage(references: readonly IniKeyReference[]): IniKeyUsage[] {
    const usage = new Map<string, {
        key: string;
        occurrences: number;
        sourceFiles: Set<string>;
        sectionKinds: Set<IniSectionKind>;
        sampleSections: Set<string>;
        sampleValues: Set<string>;
    }>();
    for (const reference of references) {
        const identity = normalize(reference.key);
        const existing = usage.get(identity) ?? {
            key: reference.key,
            occurrences: 0,
            sourceFiles: new Set<string>(),
            sectionKinds: new Set<IniSectionKind>(),
            sampleSections: new Set<string>(),
            sampleValues: new Set<string>(),
        };
        existing.occurrences++;
        existing.sourceFiles.add(reference.source);
        existing.sectionKinds.add(reference.sectionKind);
        if (existing.sampleSections.size < 8) existing.sampleSections.add(`[${reference.section}]`);
        if (existing.sampleValues.size < 8 && reference.value) existing.sampleValues.add(reference.value);
        usage.set(identity, existing);
    }
    return [...usage.values()]
        .map((item) => ({
            key: item.key,
            occurrences: item.occurrences,
            sourceFiles: [...item.sourceFiles].sort(),
            sectionKinds: [...item.sectionKinds].sort(),
            sampleSections: [...item.sampleSections].sort(),
            sampleValues: [...item.sampleValues].sort(),
        }))
        .sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key));
}

export function scanMentalOmegaIniSources(
    sources: readonly IniScanSource[],
    registry: AresFeatureRegistry = createDefaultAresFeatureRegistry(),
): MentalOmegaCompatibilityReport {
    const sectionKinds = buildSectionKinds(sources);
    const references = sources.flatMap((source) => parseSource(source, sectionKinds));
    const uniqueKeys = new Set(references.map((ref) => `${ref.section.toLocaleLowerCase("en-US")}\0${ref.key.toLocaleLowerCase("en-US")}`));
    const aresRefs = references.filter((ref) => ref.classification === "ares-known");
    const moContentRefs = references.filter((ref) => ref.classification === "mo-content");
    const unclassifiedRefs = references.filter((ref) => ref.classification === "unclassified");
    const uniqueByClassification = (items: readonly IniKeyReference[]) => new Set(items.map((ref) =>
        `${ref.section.toLocaleLowerCase("en-US")}\0${ref.key.toLocaleLowerCase("en-US")}`));
    const usage = new Map<string, AresFeatureUsage>();
    const impact = new Map<string, {
        sources: Set<string>;
        sections: Set<string>;
        definitions: Set<string>;
    }>();
    for (const reference of aresRefs) {
        const featureId = reference.featureId!;
        const existing = usage.get(featureId);
        const identity = referenceIdentity(reference);
        if (existing) {
            existing.occurrences++;
            existing.references.push(reference);
        }
        else {
            usage.set(featureId, {
                featureId,
                occurrences: 1,
                sourceCount: 0,
                sectionCount: 0,
                definitionCount: 0,
                references: [reference],
                support: registry.get(featureId),
            });
        }
        const featureImpact = impact.get(featureId) ?? {
            sources: new Set<string>(),
            sections: new Set<string>(),
            definitions: new Set<string>(),
        };
        featureImpact.sources.add(identity.source);
        featureImpact.sections.add(identity.section);
        featureImpact.definitions.add(identity.definition);
        impact.set(featureId, featureImpact);
    }
    for (const [featureId, featureUsage] of usage) {
        const featureImpact = impact.get(featureId)!;
        featureUsage.sourceCount = featureImpact.sources.size;
        featureUsage.sectionCount = featureImpact.sections.size;
        featureUsage.definitionCount = featureImpact.definitions.size;
    }
    const dependencyGraph = scanIniDependencies(sources);
    const sideCoverage = dependencyGraph.coverage.find((coverage) => coverage.kind === "side");
    const countryCoverage = dependencyGraph.coverage.find((coverage) => coverage.kind === "country");
    return {
        sourceCount: sources.length,
        sectionCount: new Set(references.map((ref) => `${ref.source}\0${ref.section.toLocaleLowerCase("en-US")}`)).size,
        keyCount: references.length,
        uniqueKeys: uniqueKeys.size,
        uniqueAresKeys: uniqueByClassification(aresRefs).size,
        uniqueMoContentKeys: uniqueByClassification(moContentRefs).size,
        uniqueUnclassifiedKeys: uniqueByClassification(unclassifiedRefs).size,
        aresKnownKeys: aresRefs.length,
        moContentKeys: moContentRefs.length,
        unclassifiedKeys: unclassifiedRefs.length,
        vanillaKeys: references.filter((ref) => ref.classification === "vanilla").length,
        references,
        featureUsage: [...usage.values()].sort((a, b) => b.occurrences - a.occurrences || a.featureId.localeCompare(b.featureId)),
        moContentUsage: keyUsage(moContentRefs),
        unclassifiedUsage: keyUsage(unclassifiedRefs),
        dependencyGraph,
        sideCountryCoverage: {
            sideDefinitions: sideCoverage?.definitions ?? 0,
            sideReferences: sideCoverage?.references ?? 0,
            unknownSideReferences: sideCoverage?.unresolved ?? 0,
            countryDefinitions: countryCoverage?.definitions ?? 0,
            countryReferences: countryCoverage?.references ?? 0,
            unknownCountryReferences: countryCoverage?.unresolved ?? 0,
        },
    };
}

export interface VfsTextReader {
    fileExists(filename: string): boolean;
    openFile(filename: string): { readAsString(): string };
    listFiles?(): string[];
}

export interface EffectiveIniReader {
    loadEffectiveIni(filename: string): {
        ini: { toString(): string };
    } | undefined;
}

/**
 * Scan the active VFS without requiring proprietary MO files in the source
 * tree.  MIX entries are hash-addressable, so the known profile INIs are
 * always queried explicitly; loose files are included when the archive can
 * enumerate them.
 */
export function scanMentalOmegaVfs(
    vfs: VfsTextReader,
    registry: AresFeatureRegistry = createDefaultAresFeatureRegistry(),
    sourceLoader?: EffectiveIniReader | IniSourceLoader,
    profile: GameProfileDescriptor = getGameProfile("mental-omega"),
): MentalOmegaCompatibilityReport {
    const canonicalBases = ["rules.ini", "art.ini", "ai.ini", "ui.ini", "sound.ini"];
    const candidateNames = new Set(canonicalBases.map((baseFileName) =>
        profile.resolveCanonicalFile(baseFileName, (filename) => vfs.fileExists(filename))));
    const sources: IniScanSource[] = [];
    for (const filename of candidateNames) {
        try {
            if (vfs.fileExists(filename)) {
                const effective = sourceLoader?.loadEffectiveIni(filename);
                sources.push({
                    name: effective ? `${filename} (effective)` : filename,
                    contents: effective?.ini.toString() ?? vfs.openFile(filename).readAsString(),
                });
            }
        }
        catch {
            // Missing/hash-only files are reported by the resource diagnostics;
            // one unreadable optional INI must not hide the rest of the scan.
        }
    }
    return scanMentalOmegaIniSources(sources, registry);
}

export function formatMentalOmegaCompatibilityReport(report: MentalOmegaCompatibilityReport): string {
    const lines = [
        "MENTAL OMEGA EXTENSION REQUIREMENTS",
        `Sources: ${report.sourceCount}`,
        `INI keys: ${report.keyCount} (${report.uniqueKeys} unique)`,
        `Vanilla keys: ${report.vanillaKeys}`,
        `Ares-known keys: ${report.aresKnownKeys} (${report.uniqueAresKeys} unique)`,
        `MO-content keys: ${report.moContentKeys} (${report.uniqueMoContentKeys} unique)`,
        `Unclassified keys: ${report.unclassifiedKeys} (${report.uniqueUnclassifiedKeys} unique)`,
        "",
        "FEATURE USAGE",
    ];
    for (const usage of report.featureUsage) {
        const support = usage.support;
        const status = !support
            ? "unregistered"
            : support.implemented
                ? "verified"
                : support.parserImplemented
                    ? "parsed-only"
                    : "runtime-missing";
        lines.push(`${usage.featureId}: ${usage.occurrences} occurrence(s), ${usage.definitionCount} definition(s), ${usage.sourceCount} source(s), ${status}`);
    }
    const appendKeyUsage = (title: string, usage: readonly IniKeyUsage[]): void => {
        lines.push("", title, "key | count | source files | section kinds | sample sections | sample values", "--- | ---: | --- | --- | --- | ---");
        for (const item of usage) {
            lines.push([
                item.key,
                item.occurrences,
                item.sourceFiles.join(", "),
                item.sectionKinds.join(", "),
                item.sampleSections.join(", "),
                item.sampleValues.join(", "),
            ].join(" | "));
        }
    };
    appendKeyUsage("MO CONTENT KEY USAGE", report.moContentUsage);
    appendKeyUsage("UNCLASSIFIED KEY USAGE", report.unclassifiedUsage);
    lines.push(
        "",
        "SIDES",
        `defined: ${report.sideCountryCoverage.sideDefinitions}`,
        `references: ${report.sideCountryCoverage.sideReferences}`,
        `unknown references: ${report.sideCountryCoverage.unknownSideReferences}`,
        "COUNTRIES",
        `defined: ${report.sideCountryCoverage.countryDefinitions}`,
        `references: ${report.sideCountryCoverage.countryReferences}`,
        `unknown references: ${report.sideCountryCoverage.unknownCountryReferences}`,
    );
    lines.push("", "DEPENDENCY COVERAGE");
    for (const coverage of report.dependencyGraph.coverage) {
        lines.push(`${coverage.kind}: ${coverage.definitions} definition(s), ${coverage.references} reference(s), ${coverage.unresolved} unresolved`);
    }
    if (report.dependencyGraph.unresolved.length) {
        lines.push("", "UNRESOLVED DEFINITIONS");
        for (const edge of report.dependencyGraph.unresolved.slice(0, 50)) {
            lines.push(`${edge.source} [${edge.section}] ${edge.key}=${edge.value} -> ${edge.kind}`);
        }
    }
    return lines.join("\n");
}
