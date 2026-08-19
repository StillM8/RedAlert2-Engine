import { ObjectRules } from './ObjectRules';
import { ObjectType } from '@/engine/type/ObjectType';
export class ProjectileRules extends ObjectRules {
    public acceleration!: number;
    /** Vanilla/YR projectile proximity flag; not part of the Ares ranged extension. */
    public proximity!: boolean;
    /** Ares-restored TS fuel/range behavior. */
    public ranged!: boolean;
    /** Ares projectile SHP animation frames per facing. */
    public animLength!: number;
    /** Ares projectile SHP animation frame interval. */
    public animRate!: number;
    /** Antares legacy cell-fanout behavior. */
    public airburst!: boolean;
    public airburstWeapon?: string;
    public cluster!: number;
    public airburstSpread!: number;
    /** If omitted, Antares defaults this to Splits. */
    public aroundTarget?: boolean;
    /** Antares target-retargeting fanout behavior. */
    public splits!: boolean;
    public retargetAccuracy!: number;
    public retargetSelf!: boolean;
    public arcing!: boolean;
    public courseLockDuration!: number;
    public detonationAltitude!: number;
    public firersPalette!: boolean;
    public flakScatter!: boolean;
    public inaccurate!: boolean;
    public inviso!: boolean;
    public isAntiAir!: boolean;
    public isAntiGround!: boolean;
    public level!: boolean;
    public rot!: number;
    public iniRot!: number;
    public shadow!: boolean;
    public shrapnelWeapon?: string;
    public shrapnelCount!: number;
    public subjectToCliffs!: boolean;
    /** Ares projectile flag; defaults to being blocked by active Firestorm walls. */
    public subjectToFirestorm!: boolean;
    /** Ares Urban Combat projectile flag; defaults to participating in trenches. */
    public subjectToTrenches!: boolean;
    public subjectToElevation!: boolean;
    public subjectToWalls!: boolean;
    public vertical!: boolean;
    /** Ares smoke ParticleSystem emitted continuously while this projectile travels. */
    public attachedSystem?: string;
    constructor(type: ObjectType, ini: any, index: number = -1, generalRules?: any) {
        super(type, ini, index, generalRules);
        this.parse();
    }
    protected parse(): void {
        super.parse();
        const rot = this.ini.getNumber("ROT", 0);
        let acceleration = this.ini.getNumber("Acceleration");
        if (rot === 1 && !acceleration) {
            acceleration = Number.POSITIVE_INFINITY;
        }
        acceleration = acceleration || 3;
        this.acceleration = acceleration;
        this.proximity = this.ini.getBool("Proximity");
        this.ranged = this.ini.getBool("Ranged");
        this.animLength = Math.max(1, Math.floor(this.ini.getNumber("AnimLength", 1)));
        // Ares documents AnimRate as non-zero. Clamp malformed/zero authored
        // values rather than allowing a divide/modulo-by-zero render path.
        this.animRate = Math.max(1, Math.floor(Math.abs(this.ini.getNumber("AnimRate", 1))));
        this.airburst = this.ini.getBool("Airburst");
        this.airburstWeapon = this.ini.getString("AirburstWeapon") || undefined;
        this.cluster = Math.max(0, Math.floor(this.ini.getNumber("Cluster")));
        this.airburstSpread = Math.max(0, this.ini.getNumber("AirburstSpread", 1.5));
        this.aroundTarget = this.ini.has("AroundTarget")
            ? this.ini.getBool("AroundTarget")
            : undefined;
        this.splits = this.ini.getBool("Splits");
        this.retargetAccuracy = Math.max(0, Math.min(1, this.ini.getNumber("RetargetAccuracy")));
        this.retargetSelf = this.ini.getBool("RetargetSelf", true);
        this.arcing = this.ini.getBool("Arcing");
        this.courseLockDuration = this.ini.getNumber("CourseLockDuration");
        this.detonationAltitude = this.ini.getNumber("DetonationAltitude");
        this.firersPalette = this.ini.getBool("FirersPalette");
        this.flakScatter = this.ini.getBool("FlakScatter");
        this.inaccurate = this.ini.getBool("Inaccurate");
        this.inviso = this.ini.getBool("Inviso");
        this.isAntiAir = this.ini.getBool("AA");
        this.isAntiGround = this.ini.getBool("AG", true);
        this.level = this.ini.getBool("Level");
        this.rot = ObjectRules.iniRotToDegsPerTick(rot);
        this.iniRot = rot;
        this.shadow = this.ini.getBool("Shadow", true);
        this.shrapnelWeapon = this.ini.getString("ShrapnelWeapon") || undefined;
        this.shrapnelCount = this.ini.getNumber("ShrapnelCount");
        this.subjectToCliffs = this.ini.getBool("SubjectToCliffs");
        this.subjectToFirestorm = this.ini.getBool("SubjectToFirestorm", true);
        this.subjectToTrenches = this.ini.getBool("SubjectToTrenches", true);
        this.subjectToElevation = this.ini.getBool("SubjectToElevation");
        this.subjectToWalls = this.ini.getBool("SubjectToWalls");
        this.vertical = this.ini.getBool("Vertical");
        this.attachedSystem = this.ini.getString("AttachedSystem") || undefined;
    }
}
