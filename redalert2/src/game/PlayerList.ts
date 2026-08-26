import { Player } from './Player';
export class PlayerList {
    private players: Player[] = [];
    addPlayer(player: Player): void {
        // Canonical identity for hashing and snapshot foreign keys: the
        // insertion order is deterministic across peers and world rebuilds,
        // unlike display names (duplicates possible) or object identity.
        player.playerListIndex = this.players.length;
        this.players.push(player);
    }
    getPlayerAt(index: number): Player {
        if (index >= this.players.length) {
            throw new RangeError(`Player #${index} out of bounds`);
        }
        return this.players[index];
    }
    getPlayerByName(name: string): Player {
        const player = this.players.find(p => p.name === name);
        if (!player) {
            throw new Error(`Player with name "${name}" not found`);
        }
        return player;
    }
    getPlayerNumber(player: Player): number {
        const index = this.players.indexOf(player);
        if (index === -1) {
            throw new Error(`Player ${player.name} not found`);
        }
        return index;
    }
    getCombatants(): Player[] {
        return this.players.filter(p => p.isCombatant());
    }
    getNonNeutral(): Player[] {
        return this.players.filter(p => !p.isNeutral);
    }
    getCivilian(): Player | undefined {
        // side is a numeric SideType enum; the old string comparison never
        // matched, so garrison hand-backs crashed on an undefined new owner.
        return this.players.find(p => p.isNeutral);
    }
    getAll(): Player[] {
        return this.players;
    }
}
