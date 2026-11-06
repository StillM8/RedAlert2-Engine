export enum TagRepeatType {
    Volatile = 0,
    SemiPersistent = 1,
    Persistent = 2,
    OnceAny = Volatile,
    OnceAll = SemiPersistent,
    Repeat = Persistent
}
