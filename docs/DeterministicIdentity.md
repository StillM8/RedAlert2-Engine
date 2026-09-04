# Deterministic identity invariant

The engine has two different player identifiers:

* `Player.name` is a display/session string. It is used at API and protocol
  boundaries that explicitly accept a name, and is not a simulation foreign
  key. Two `Player` instances may have the same name.
* `PlayerList` insertion order is the canonical player identity. Its numeric
  slot is assigned to `playerListIndex` and is the only player key permitted
  in deterministic hashes, snapshots, replay records, and reconstructed-world
  references.

`PlayerList.getPlayerByName` is therefore a boundary lookup, not an identity
resolver. It rejects ambiguous names instead of silently selecting the first
match. Lobby/session code that exposes names must provide unique names for
name-addressed operations; simulation state remains valid even when display
names collide.

Alliances and gameplay relationships retain `Player` references while the
world is live. Snapshot and lockstep codecs convert those references to the
canonical player-list slot and resolve the slot in the destination world.
Replay action/event records continue to use their existing numeric wire field;
the recorder now fills it from PlayerList membership rather than a display
name or an incidental object property. This does not change the replay wire
format.

GameObject references use canonical object IDs. Authored rules are rebound by
stable authored names; neither live JavaScript object identity nor a display
name is serialized as canonical state.

The invariant is exercised by `PlayerIdentity.test.ts` and by the AttachEffect
and animation-damage restore tests, including same-name and empty-name players.
