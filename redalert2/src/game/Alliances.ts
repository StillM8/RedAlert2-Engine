import { fnv32a } from '@/util/math';
import { Player } from './Player';
import { PlayerList } from './PlayerList';
export enum AllianceStatus {
    Requested = 0,
    Formed = 1
}
class PlayerPair {
    constructor(public first: Player, public second: Player) { }
    has(player: Player): boolean {
        return this.first === player || this.second === player;
    }
    equals(other: PlayerPair): boolean {
        return ((this.first === other.first && this.second === other.second) ||
            (this.first === other.second && this.second === other.first));
    }
}
interface Alliance {
    players: PlayerPair;
    status: AllianceStatus;
}
export class Alliances {
    private alliances: Alliance[] = [];
    private fixedAlliance: boolean = false;
    constructor(private playerList: PlayerList) { }
    setFixedAlliance(value: boolean): void {
        this.fixedAlliance = Boolean(value);
    }
    isFixedAlliance(): boolean {
        return this.fixedAlliance;
    }
    findByPlayers(player1: Player, player2: Player): Alliance | undefined {
        const pair = new PlayerPair(player1, player2);
        return this.alliances.find(alliance => alliance.players.equals(pair));
    }
    filterByPlayer(player: Player): Alliance[] {
        return this.alliances.filter(alliance => alliance.players.first === player || alliance.players.second === player);
    }
    request(player1: Player, player2: Player): Alliance | undefined {
        if (this.fixedAlliance) {
            return undefined;
        }
        if (!this.canRequestAlliance(player2)) {
            throw new Error(`Player ${player2.name} is not a human combatant.`);
        }
        if (this.canFormAlliance(player1, player2)) {
            if (this.findByPlayers(player1, player2)) {
                throw new Error(`Can't request alliance because an alliance is already pending or formed between ${player1.name} and ${player2.name}.`);
            }
            return this.setAlliance(player1, player2, AllianceStatus.Requested);
        }
    }
    cancelRequest(player1: Player, player2: Player): void {
        const alliance = this.findByPlayers(player1, player2);
        if (!alliance || alliance.status !== AllianceStatus.Requested) {
            throw new Error(`There is no pending alliance request for player ${player2.name} from player ${player1.name}`);
        }
        if (alliance.players.first !== player1) {
            throw new Error(`Can't cancel request initiated by the other player (${player2.name})`);
        }
        this.alliances.splice(this.alliances.indexOf(alliance), 1);
    }
    acceptRequest(player1: Player, player2: Player): void {
        if (this.canFormAlliance(player1, player2)) {
            const alliance = this.findByPlayers(player1, player2);
            if (!alliance || alliance.status !== AllianceStatus.Requested) {
                throw new Error(`There is no pending alliance request for player ${player2.name} from player ${player1.name}`);
            }
            if (alliance.players.first !== player1) {
                throw new Error(`Can't accept own alliance request for player ${player2.name}`);
            }
            alliance.status = AllianceStatus.Formed;
        }
    }
    forceAlliance(player1: Player, player2: Player): Alliance {
        const existing = this.findByPlayers(player1, player2);
        if (existing) {
            return existing;
        }
        const alliance: Alliance = {
            players: new PlayerPair(player1, player2),
            status: AllianceStatus.Formed,
        };
        this.alliances.push(alliance);
        return alliance;
    }
    setAlliance(player1: Player, player2: Player, status: AllianceStatus): Alliance {
        if (!this.canFormAlliance(player1, player2)) {
            throw new Error(`Can't form alliance between players "${player1.name}" and "${player2.name}"`);
        }
        const existing = this.findByPlayers(player1, player2);
        if (existing) {
            throw new Error(`An alliance already exists between players ${player1.name} and ${player2.name}`);
        }
        const alliance: Alliance = {
            players: new PlayerPair(player1, player2),
            status
        };
        this.alliances.push(alliance);
        return alliance;
    }
    breakAlliance(player1: Player, player2: Player): void {
        if (this.fixedAlliance) {
            throw new Error("Fixed alliances cannot be changed");
        }
        const alliance = this.findByPlayers(player1, player2);
        if (!alliance || alliance.status !== AllianceStatus.Formed) {
            throw new Error(`There is no alliance between player ${player1.name} and player ${player2.name}`);
        }
        this.alliances.splice(this.alliances.indexOf(alliance), 1);
    }
    areAllied(player1: Player, player2: Player): boolean {
        const alliance = this.findByPlayers(player1, player2);
        return !!alliance && alliance.status === AllianceStatus.Formed;
    }
    getAllies(player: Player): Player[] {
        return this.filterByPlayer(player)
            .filter(alliance => alliance.status === AllianceStatus.Formed)
            .map(alliance => alliance.players.first === player
            ? alliance.players.second
            : alliance.players.first);
    }
    haveSharedIntel(player1: Player, player2: Player): boolean {
        return (player1.isObserver ||
            player2.isObserver ||
            player1 === player2 ||
            this.areAllied(player1, player2));
    }
    canRequestAlliance(player: Player): boolean {
        return player.isCombatant() && !player.isAi;
    }
    canFormAlliance(player1: Player, player2: Player): boolean {
        const hostilePairs = this.getHostilePlayers();
        if (hostilePairs.filter(pair => pair.has(player1) && !pair.has(player2)).length === 0) {
            return false;
        }
        if (hostilePairs.filter(pair => pair.has(player2) && !pair.has(player1)).length === 0) {
            return false;
        }
        const newPair = new PlayerPair(player1, player2);
        return hostilePairs.filter(pair => !pair.equals(newPair)).length > 0;
    }
    getHostilePlayers(): PlayerPair[] {
        const combatants = this.playerList.getCombatants();
        const hostilePairs: PlayerPair[] = [];
        for (let i = 0; i < combatants.length; i++) {
            for (let j = i + 1; j < combatants.length; j++) {
                if (!this.getAllies(combatants[i]).includes(combatants[j])) {
                    hostilePairs.push(new PlayerPair(combatants[i], combatants[j]));
                }
            }
        }
        return hostilePairs;
    }
    getHash(): number {
        return fnv32a(this.alliances
            .map(alliance => [
            this.playerList.getPlayerNumber(alliance.players.first),
            this.playerList.getPlayerNumber(alliance.players.second),
            alliance.status
        ])
            .flat());
    }
    captureState(): { version: 1; fixed: boolean; alliances: { first: number; second: number; status: number }[] } {
        return {
            version: 1,
            fixed: this.fixedAlliance,
            alliances: this.alliances.map(alliance => ({
                first: this.playerList.getPlayerNumber(alliance.players.first),
                second: this.playerList.getPlayerNumber(alliance.players.second),
                status: alliance.status,
            })),
        };
    }
    restoreState(state: unknown): void {
        if (!state || typeof state !== "object") {
            throw new Error("Invalid alliance state");
        }
        const candidate = state as { version?: unknown; fixed?: unknown; alliances?: unknown };
        if (candidate.version !== 1 || typeof candidate.fixed !== "boolean" || !Array.isArray(candidate.alliances)) {
            throw new Error("Invalid alliance state");
        }
        const players = this.playerList.getAll();
        const resolved = candidate.alliances.map((entry: any) => {
            if (!entry || !Number.isSafeInteger(entry.first) || !Number.isSafeInteger(entry.second) ||
                !Number.isSafeInteger(entry.status) || entry.status < 0 || entry.status > 1 ||
                entry.first === entry.second || !players[entry.first] || !players[entry.second]) {
                throw new Error("Invalid alliance entry");
            }
            return {
                players: new PlayerPair(players[entry.first], players[entry.second]),
                status: entry.status as AllianceStatus,
            };
        });
        const seen = new Set<string>();
        for (const entry of resolved) {
            const key = [this.playerList.getPlayerNumber(entry.players.first), this.playerList.getPlayerNumber(entry.players.second)]
                .sort((a, b) => a - b)
                .join(":");
            if (seen.has(key)) {
                throw new Error("Duplicate alliance entry");
            }
            seen.add(key);
        }
        this.fixedAlliance = candidate.fixed;
        this.alliances = resolved;
    }
    debugGetState(): Array<{
        first: Player;
        second: Player;
        status: AllianceStatus;
    }> {
        return this.alliances.map(alliance => ({
            first: alliance.players.first,
            second: alliance.players.second,
            status: alliance.status
        }));
    }
}
