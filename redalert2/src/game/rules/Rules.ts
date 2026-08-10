import { Color } from "@/util/Color";
import { ObjectType } from "@/engine/type/ObjectType";
import { CountryRules } from "@/game/rules/CountryRules";
import { SideType } from "@/game/SideType";
import { WeaponRules } from "@/game/rules/WeaponRules";
import { AudioVisualRules } from "@/game/rules/AudioVisualRules";
import { GeneralRules } from "@/game/rules/GeneralRules";
import { MpDialogSettings } from "@/game/rules/MpDialogSettings";
import { LandType } from "@/game/type/LandType";
import { LandRules } from "@/game/rules/LandRules";
import { WarheadRules } from "@/game/rules/WarheadRules";
import { ProjectileRules } from "@/game/rules/ProjectileRules";
import { ObjectRulesFactory } from "@/game/rules/ObjectRulesFactory";
import { CombatDamageRules } from "@/game/rules/CombatDamageRules";
import { TiberiumRules } from "@/game/rules/TiberiumRules";
import { AiRules } from "@/game/rules/AiRules";
import { ElevationModelRules } from "@/game/rules/ElevationModelRules";
import { RadiationRules } from "@/game/rules/RadiationRules";
import { SuperWeaponRules } from "@/game/rules/SuperWeaponRules";
import { resolveSuperWeaponActivationId } from "@/extensions/ares/AresSuperWeapons";
import { SuperWeaponType } from "@/game/type/SuperWeaponType";
import { CrateRules } from "@/game/rules/CrateRules";
import { PowerupsRules } from "@/game/rules/PowerupsRules";
import { mpAllowedColors } from "@/game/rules/mpAllowedColors";
import { isNotNullOrUndefined } from "@/util/typeGuard";
import { Weapon } from "@/game/Weapon";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { AresCountryRegistry, AresSideRegistry } from "@/extensions/ares/AresSides";
interface IniFile {
    getSection(name: string): IniSection | undefined;
    getOrCreateSection(name: string): IniSection;
}
interface IniSection {
    entries: Map<string, any>;
}
interface Logger {
    debug(message: string): void;
}
interface ObjectRules {
    deathWeapon?: string;
    primary?: string;
    secondary?: string;
    elitePrimary?: string;
    eliteSecondary?: string;
    occupyWeapon?: string;
    eliteOccupyWeapon?: string;
    weaponCount?: number;
    getWeaponAtIndex?(index: number): string;
    getEliteWeaponAtIndex?(index: number): string;
}
interface SpecialFlags {
    initialVeteran?: boolean;
}
export class Rules {
    private ini: IniFile;
    private logger?: Logger;
    private buildingTypes = new Map<number, string>();
    private vehicleTypes = new Map<number, string>();
    private infantryTypes = new Map<number, string>();
    private aircraftTypes = new Map<number, string>();
    private terrainTypes = new Map<number, string>();
    private overlayTypes = new Map<number, string>();
    private overlayIdsByType = new Map<string, number>();
    private animationTypes = new Map<number, string>();
    private animationNames = new Set<string>();
    private voxelAnimTypes = new Map<number, string>();
    private smudgeTypes = new Map<number, string>();
    private warheadTypes = new Map<number, string>();
    private tiberiumTypes = new Map<number, string>();
    private superWeaponTypes = new Map<number, string>();
    private countryTypes = new Map<number, string>();
    private countryNetworkIndices = new Map<string, number>();
    readonly weaponTypes = new Map<number, string>();
    private allObjectRules = new Map<ObjectType, Map<string, ObjectRules>>();
    readonly buildingRules = new Map<string, ObjectRules>();
    readonly infantryRules = new Map<string, ObjectRules>();
    readonly vehicleRules = new Map<string, ObjectRules>();
    readonly aircraftRules = new Map<string, ObjectRules>();
    readonly terrainRules = new Map<string, ObjectRules>();
    readonly overlayRules = new Map<string, ObjectRules>();
    private smudgeRules = new Map<string, ObjectRules>();
    private voxelAnimRules = new Map<string, ObjectRules>();
    private countryRules = new Map<string, CountryRules>();
    readonly warheadRules = new Map<string, WarheadRules>();
    public powerups = new PowerupsRules();
    public colors = new Map<string, Color>();
    public general = new GeneralRules();
    public ai = new AiRules();
    public crateRules = new CrateRules();
    public elevationModel = new ElevationModelRules();
    public mpDialogSettings = new MpDialogSettings();
    public audioVisual = new AudioVisualRules();
    public combatDamage = new CombatDamageRules();
    public radiation = new RadiationRules();
    public readonly armorRegistry: ArmorRegistry;
    public readonly sideRegistry: AresSideRegistry;
    public readonly countryRegistry: AresCountryRegistry;
    private landRules = new Map<LandType, LandRules>();
    private tiberiumRules = new Map<string, TiberiumRules>();
    private superWeaponRules = new Map<string, SuperWeaponRules>();
    private cachedWeaponRules = new Map<string, WeaponRules>();
    private cachedProjectileRules = new Map<string, ProjectileRules>();
    constructor(ini: IniFile, logger?: Logger) {
        this.ini = ini;
        this.logger = logger;
        this.armorRegistry = ArmorRegistry.fromIni(ini);
        this.sideRegistry = AresSideRegistry.fromIni(ini);
        this.countryRegistry = AresCountryRegistry.fromIni(ini, this.sideRegistry);
        this.init();
    }
    hasObject(name: string, type: ObjectType): boolean {
        return this.allObjectRules.get(type)?.has(name) ?? false;
    }
    getObject(name: string, type: ObjectType): ObjectRules {
        const rules = this.allObjectRules.get(type)?.get(name);
        if (!rules) {
            throw new Error(`Missing rules for object "${name}"`);
        }
        return rules;
    }
    getTechnoByInternalId(id: number, type: ObjectType): ObjectRules {
        let typeName: string | undefined;
        if (type === ObjectType.Building) {
            typeName = this.buildingTypes.get(id);
        }
        else if (type === ObjectType.Infantry) {
            typeName = this.infantryTypes.get(id);
        }
        else if (type === ObjectType.Vehicle) {
            typeName = this.vehicleTypes.get(id);
        }
        else if (type === ObjectType.Aircraft) {
            typeName = this.aircraftTypes.get(id);
        }
        else {
            throw new Error(`Type ${ObjectType[type]} is not a techno type`);
        }
        if (typeName === undefined) {
            throw new Error(`Object type "${ObjectType[type]}" with ID "${id}" not found`);
        }
        return this.getObject(typeName, type);
    }
    getBuilding(name: string): ObjectRules {
        const rules = this.buildingRules.get(name);
        if (!rules) {
            throw new Error(`Missing rules for building "${name}"`);
        }
        return rules;
    }
    getWeapon(name: string): WeaponRules {
        let rules = this.cachedWeaponRules.get(name);
        if (!rules) {
            const section = this.ini.getSection(name);
            if (!section) {
                throw new Error(`Weapon ${name} is missing ini section`);
            }
            rules = new WeaponRules(section);
            this.cachedWeaponRules.set(name, rules);
        }
        return rules;
    }
    getWeaponByInternalId(id: number): WeaponRules {
        const weaponName = this.weaponTypes.get(id);
        if (!weaponName) {
            throw new RangeError(`Weapon with internal ID "${id}" not found`);
        }
        return this.getWeapon(weaponName);
    }
    getWarhead(name: string): WarheadRules {
        let rules = this.warheadRules.get(name.toLowerCase());
        if (!rules) {
            const section = this.ini.getSection(name);
            if (section) {
                rules = new WarheadRules(section, this.armorRegistry);
                this.warheadRules.set(name.toLowerCase(), rules);
            }
        }
        if (!rules) {
            try {
                const known = Array.from(this.warheadRules.keys());
                const sample = known.slice(0, 20).join(", ");
                const hasSection = !!this.ini.getSection(name);
                console.error(`[Diag] Unknown warhead "${name}". hasSection=${hasSection}. Known warheads (sample): ${sample} ... total=${known.length}`);
            }
            catch (e) {
                console.error('[Diag] Unknown warhead diagnostics failed:', e);
            }
            throw new Error("Unknown warhead " + name);
        }
        return rules;
    }
    getProjectile(name: string): ProjectileRules {
        let rules = this.cachedProjectileRules.get(name);
        if (!rules) {
            let section = this.ini.getSection(name);
            if (!section) {
                // The original engine tolerates weapons referencing projectiles
                // with no ini section (e.g. YR's InvisibleLow) — all flags
                // default. Synthesize an empty section to match.
                this.logger?.debug(`Projectile "${name}" has no ini section; using defaults`);
                section = this.ini.getOrCreateSection(name);
            }
            rules = new ProjectileRules(ObjectType.Projectile, section);
            this.cachedProjectileRules.set(name, rules);
        }
        return rules;
    }
    getOverlayName(id: number): string {
        const name = this.overlayTypes.get(id);
        if (!name) {
            throw new Error("Invalid overlay id " + id);
        }
        return name;
    }
    hasOverlayId(id: number): boolean {
        return this.overlayTypes.has(id);
    }
    getOverlayId(name: string): number {
        const id = this.overlayIdsByType.get(name);
        if (id === undefined) {
            throw new Error("Invalid overlay name " + name);
        }
        return id;
    }
    getOverlay(name: string): ObjectRules {
        const rules = this.overlayRules.get(name);
        if (!rules) {
            throw new Error(`Missing rules for overlay "${name}"`);
        }
        return rules;
    }
    getAnimationName(id: number): string | undefined {
        return this.animationTypes.get(id);
    }
    getCountry(name: string): CountryRules {
        const country = this.countryRules.get(name.toLocaleLowerCase("en-US"));
        if (!country) {
            throw new Error("Unknown country " + name);
        }
        return country;
    }
    getMultiplayerCountries(): CountryRules[] {
        return this.countryRegistry.multiplayerCountries()
            .map((country) => this.getCountry(country.id));
    }
    getCountryByMultiplayerIndex(index: number): CountryRules {
        const country = this.getMultiplayerCountries()[index];
        if (!country) {
            throw new RangeError(`Multiplayer country index "${index}" is out of range`);
        }
        return country;
    }
    getCountryIdByMultiplayerIndex(index: number): string {
        return this.getCountryByMultiplayerIndex(index).id;
    }
    getNeutralCountry(): CountryRules {
        const neutral = [...this.countryRules.values()].find((country) =>
            country.sideId.toLocaleLowerCase("en-US") === "civilian" ||
            country.id.toLocaleLowerCase("en-US") === "civilian" ||
            country.name.toLocaleLowerCase("en-US") === "civilian",
        );
        if (!neutral) {
            throw new Error("Missing neutral country. No country found with Civilian side");
        }
        return neutral;
    }
    getMultiplayerColors(): Map<string, Color> {
        const colors = new Map<string, Color>();
        mpAllowedColors.forEach(colorName => {
            if (!this.colors.has(colorName)) {
                throw new Error(`Multiplayer color "${colorName}" does not exist in the rules [Colors] section.`);
            }
            colors.set(colorName, this.colors.get(colorName)!);
        });
        return colors;
    }
    getLandRules(landType: LandType): LandRules {
        let rules = this.landRules.get(landType);
        if (!rules) {
            const sectionName = landType === LandType.Cliff ? "Rock" : LandType[landType];
            rules = new LandRules().readIni(this.ini.getOrCreateSection(sectionName));
            this.landRules.set(landType, rules);
        }
        return rules;
    }
    getTiberium(id: number): TiberiumRules {
        const typeName = this.tiberiumTypes.get(id);
        if (!typeName) {
            throw new Error("Unknown tiberium type " + id);
        }
        return this.tiberiumRules.get(typeName)!;
    }
    getSuperWeapon(name: string): SuperWeaponRules {
        if (!this.superWeaponRules.has(name)) {
            throw new Error(`Unknown superweapon type "${name}"`);
        }
        return this.superWeaponRules.get(name)!;
    }
    getSuperWeaponByIndex(index: number): SuperWeaponRules | undefined {
        return [...this.superWeaponRules.values()].find(rule => rule.index === index);
    }
    getSuperWeaponActivationId(selector: SuperWeaponType | string | number): number | undefined {
        return resolveSuperWeaponActivationId(this.superWeaponRules.values(), selector);
    }
    getIni(): IniFile {
        return this.ini;
    }
    applySpecialFlags(flags: SpecialFlags): void {
        if (flags.initialVeteran) {
            this.general.veteran.initialVeteran = true;
        }
    }
    private init(): void {
        this.readAudioVisual();
        this.readCombatDamage();
        this.readRadiation();
        this.readGeneral();
        this.general.readGenericPrerequisites(this.ini.getSection("GenericPrerequisites") as any);
        this.readAi();
        this.readCrateRules();
        this.readElevationModel();
        this.readMpDialogSettings();
        this.readObjectTypes("BuildingTypes", this.buildingTypes);
        this.readObjectTypes("InfantryTypes", this.infantryTypes);
        this.readObjectTypes("VehicleTypes", this.vehicleTypes);
        this.readObjectTypes("AircraftTypes", this.aircraftTypes);
        this.readObjectTypes("TerrainTypes", this.terrainTypes);
        this.readObjectTypes("SmudgeTypes", this.smudgeTypes);
        this.readObjectTypes("Animations", this.animationTypes);
        this.animationNames = new Set(this.animationTypes.values());
        this.readObjectTypes("VoxelAnims", this.voxelAnimTypes);
        this.readObjectTypes("OverlayTypes", this.overlayTypes);
        this.overlayTypes.forEach((name, id) => this.overlayIdsByType.set(name, id));
        this.readColors();
        this.readCountryTypes();
        this.readObjectTypes("Warheads", this.warheadTypes);
        this.readObjectTypes("Tiberiums", this.tiberiumTypes);
        this.readObjectTypes("SuperWeaponTypes", this.superWeaponTypes);
        this.allObjectRules
            .set(ObjectType.Building, this.buildingRules)
            .set(ObjectType.Infantry, this.infantryRules)
            .set(ObjectType.Vehicle, this.vehicleRules)
            .set(ObjectType.Aircraft, this.aircraftRules)
            .set(ObjectType.Terrain, this.terrainRules)
            .set(ObjectType.Overlay, this.overlayRules)
            .set(ObjectType.Smudge, this.smudgeRules)
            .set(ObjectType.VoxelAnim, this.voxelAnimRules);
        this.readObjects(ObjectType.Building, this.buildingTypes, this.buildingRules);
        this.readObjects(ObjectType.Infantry, this.infantryTypes, this.infantryRules);
        this.readObjects(ObjectType.Vehicle, this.vehicleTypes, this.vehicleRules);
        this.readObjects(ObjectType.Aircraft, this.aircraftTypes, this.aircraftRules);
        this.readObjects(ObjectType.Terrain, this.terrainTypes, this.terrainRules);
        this.readObjects(ObjectType.Overlay, this.overlayTypes, this.overlayRules);
        this.readObjects(ObjectType.Smudge, this.smudgeTypes, this.smudgeRules);
        this.readObjects(ObjectType.VoxelAnim, this.voxelAnimTypes, this.voxelAnimRules);
        this.readCountries();
        this.readWarheads();
        this.readPowerups();
        this.readTiberiums();
        this.readSuperWeapons();
        this.buildWeaponsList();
    }
    private readAudioVisual(): void {
        const section = this.ini.getSection("AudioVisual");
        if (!section) {
            throw new Error("Missing [AudioVisual] section");
        }
        this.audioVisual.readIni(section);
    }
    private readCombatDamage(): void {
        const section = this.ini.getSection("CombatDamage");
        if (!section) {
            throw new Error("Missing [CombatDamage] section");
        }
        this.combatDamage.readIni(section);
    }
    private readRadiation(): void {
        const section = this.ini.getSection("Radiation");
        if (!section) {
            throw new Error("Missing [Radiation] section");
        }
        this.radiation.readIni(section);
    }
    private readGeneral(): void {
        const section = this.ini.getSection("General");
        if (!section) {
            throw new Error("Missing [General] section");
        }
        this.general.readIni(section as any, this.sideRegistry);
    }
    private readAi(): void {
        const section = this.ini.getSection("AI");
        if (!section) {
            throw new Error("Missing [AI] section");
        }
        this.ai.readIni(section);
    }
    private readCrateRules(): void {
        const section = this.ini.getSection("CrateRules");
        if (!section) {
            throw new Error("Missing [CrateRules] section");
        }
        this.crateRules.readIni(section);
    }
    private readElevationModel(): void {
        const section = this.ini.getSection("ElevationModel");
        if (!section) {
            throw new Error("Missing [ElevationModel] section");
        }
        this.elevationModel.readIni(section);
    }
    private readMpDialogSettings(): void {
        const section = this.ini.getSection("MultiplayerDialogSettings");
        if (!section) {
            throw new Error("Missing [MultiplayerDialogSettings] section");
        }
        this.mpDialogSettings.readIni(section as any);
    }
    private readObjectTypes(sectionName: string, typeMap: Map<number, string>): void {
        const section = this.ini.getSection(sectionName);
        if (!section) {
            throw new Error(`Missing [${sectionName}] section`);
        }
        let index = 0;
        const seenTypes = new Set<string>();
        section.entries.forEach((value, key) => {
            if (typeof value === "string") {
                if (Number.isNaN(Number(key))) {
                    this.logger?.debug(`Non-numeric id "${key}" found in rules section [${sectionName}]. Skipping.`);
                }
                else if (seenTypes.has(value)) {
                    this.logger?.debug(`Duplicate type "${value}" in rules section [${sectionName}]. Skipping.`);
                }
                else {
                    typeMap.set(index++, value);
                    seenTypes.add(value);
                }
            }
            else {
                this.logger?.debug(`Non-string type found in rules section [${sectionName}]. Skipping.`);
            }
        });
    }
    private readColors(): void {
        const section = this.ini.getSection("Colors");
        if (!section) {
            throw new Error("Missing [Colors] section");
        }
        section.entries.forEach((value, name) => {
            const [h, s, v] = (value as string).split(",");
            const color = Color.fromHsv(parseInt(h, 10), parseInt(s, 10), parseInt(v, 10));
            this.colors.set(name, color);
        });
    }
    private readObjects(objectType: ObjectType, typeMap: Map<number, string>, rulesMap: Map<string, ObjectRules>): void {
        typeMap.forEach((typeName, id) => {
            const section = this.ini.getSection(typeName);
            if (section) {
                const rules = new ObjectRulesFactory().create(objectType, section, this.general, id as any, this.armorRegistry, this.sideRegistry);
                rulesMap.set(typeName, rules as any);
            }
            else {
                this.logger?.debug(`${ObjectType[objectType]} type "${typeName}" has no rules section`);
            }
        });
    }
    // Retail instantiates types that are declared in the type list but have no
    // ini section with engine defaults (two official YR co-op maps place such
    // buildings: CALA02, CALOND02). Synthesize a harmless default on demand.
    ensureMapObjectDefaults(name: string, type: ObjectType): boolean {
        if (this.hasObject(name, type)) {
            return true;
        }
        const typeMaps = new Map<ObjectType, Map<number, string>>([
            [ObjectType.Building, this.buildingTypes],
            [ObjectType.Infantry, this.infantryTypes],
            [ObjectType.Vehicle, this.vehicleTypes],
            [ObjectType.Aircraft, this.aircraftTypes],
            [ObjectType.Terrain, this.terrainTypes],
        ]);
        const typeMap = typeMaps.get(type);
        const entry = typeMap && [...typeMap.entries()].find(([, typeName]) => typeName === name);
        if (!entry) {
            return false;
        }
        const section = this.ini.getOrCreateSection(name);
        if (!section.has("Strength")) {
            section.set("Strength", "400");
        }
        if (!section.has("TechLevel")) {
            section.set("TechLevel", "-1");
        }
        if (!section.has("Insignificant")) {
            section.set("Insignificant", "yes");
        }
        const rules = new ObjectRulesFactory().create(type, section, this.general, entry[0] as any, this.armorRegistry, this.sideRegistry);
        this.allObjectRules.get(type)?.set(name, rules as any);
        return true;
    }
    private readCountryTypes(): void {
        const section = this.ini.getSection("Countries");
        if (!section) {
            throw new Error("Missing [Countries] section");
        }
        const seen = new Set<string>();
        section.entries.forEach((value, key) => {
            if (typeof value !== "string" || !/^\d+$/.test(key)) return;
            const name = value.trim();
            const normalized = name.toLocaleLowerCase("en-US");
            if (!name || seen.has(normalized)) return;
            const networkIndex = Number(key);
            this.countryTypes.set(networkIndex, name);
            this.countryNetworkIndices.set(normalized, networkIndex);
            seen.add(normalized);
        });
    }
    private readCountries(): void {
        for (const descriptor of this.countryRegistry.definitionOrder()) {
            const name = descriptor.id;
            const section = this.ini.getSection(name);
            if (!section) {
                throw new Error("Missing ini section for country " + name);
            }
            const rules = new CountryRules(name);
            rules.readIni(section as any, this.sideRegistry, {
                order: descriptor.order,
                networkIndex: this.countryNetworkIndices.get(name.toLocaleLowerCase("en-US")) ?? descriptor.order ?? -1,
            });
            this.countryRules.set(name.toLocaleLowerCase("en-US"), rules);
        }
    }
    private readWarheads(): void {
        this.warheadTypes.forEach(name => {
            const section = this.ini.getSection(name);
            if (section) {
                const rules = new WarheadRules(section, this.armorRegistry);
                this.warheadRules.set(name.toLowerCase(), rules);
            }
            else {
                this.logger?.debug(`Warhead "${name}" has no rules section`);
            }
        });
    }
    private readPowerups(): void {
        const section = this.ini.getSection("Powerups");
        if (!section) {
            throw new Error("Missing [Powerups] section");
        }
        this.powerups.readIni(section.entries);
    }
    private readTiberiums(): void {
        this.tiberiumTypes.forEach(name => {
            const section = this.ini.getSection(name);
            if (!section) {
                throw new Error("Missing rules section for tiberium type " + name);
            }
            this.tiberiumRules.set(name, new TiberiumRules().readIni(section));
        });
    }
    private readSuperWeapons(): void {
        this.superWeaponTypes.forEach((name, id) => {
            const section = this.ini.getSection(name);
            if (!section) {
                throw new Error("Missing rules section for superweapon type " + name);
            }
            this.superWeaponRules.set(name, new SuperWeaponRules(id).readIni(section));
        });
    }
    private buildWeaponsList(): void {
        const weaponNames = new Set<string>();
        weaponNames.add(this.general.dropPodWeapon);
        for (const superWeapon of this.superWeaponRules.values()) {
            if (superWeapon.weaponType) {
                weaponNames.add(superWeapon.weaponType);
            }
        }
        weaponNames.add(Weapon.NUKE_PAYLOAD_NAME);
        const allObjectRules = [
            ...this.buildingRules.values(),
            ...this.aircraftRules.values(),
            ...this.vehicleRules.values(),
            ...this.infantryRules.values(),
        ];
        for (const rules of allObjectRules) {
            const weapons = [
                rules.deathWeapon,
                rules.primary,
                rules.secondary,
                rules.elitePrimary,
                rules.eliteSecondary,
                rules.occupyWeapon,
                rules.eliteOccupyWeapon,
                ...(rules.weaponCount
                    ? new Array(rules.weaponCount)
                        .fill(0)
                        .map((_, index) => [
                        rules.getWeaponAtIndex?.(index),
                        rules.getEliteWeaponAtIndex?.(index),
                    ])
                        .flat()
                    : []),
            ]
                .filter(isNotNullOrUndefined)
                .filter(weapon => weapon !== "");
            for (const weapon of weapons) {
                weaponNames.add(weapon);
            }
        }
        let weaponIndex = 0;
        for (const weaponName of weaponNames) {
            this.weaponTypes.set(weaponIndex++, weaponName);
        }
    }
}
