export enum SideType {
    GDI = 0,
    Nod = 1,
    Civilian = 2,
    Mutant = 3,
    // Yuri's Revenge third faction ("ThirdSide" in rulesmd.ini). Countries on
    // this side load and can appear in-game, but the faction is not offered as
    // a player choice until its core mechanics (slave miner etc.) land.
    Yuri = 4,
    // Mental Omega's fourth production side ("FourthSide"). The current HUD
    // falls back to the Soviet presentation, but rules and ownership still
    // need to preserve this side instead of rejecting the mod at load time.
    FourthSide = 5
}
