# Deterministic state coverage

`Game.getHash()` is a simulation fingerprint, not a certification that every
mutable engine subsystem is reconstructible. A field is canonical when a peer
disagreement can change a future simulation result. Canonical fields must be
represented by stable scalar identities, hashed, and included in a validated
snapshot when that subsystem has a restore codec.

| Subsystem | Mutable future-affecting state audited | HASH | SNAPSHOT | RESTORE | QUALIFIED | Status |
| --- | --- | --- | --- | --- | --- | --- |
| PRNG | MT19937 624-word state, index, last emitted value | yes | yes | transactional | 4,537 + 5,000 continuation | closed for codec |
| Players | credits, score, defeat/resign/drop, Firestorm flag, build/kill/loss counters, control-group history, production and AI-trigger gates, owned power/radar traits | yes | yes | transactional | adversarial hash tests, end-to-end world continuation | closed for the world snapshot; per-house AI gating is hashed/snapshotted |
| Production | ordered queue items, quantities, status, spend/fraction/progress, build-speed modifier, veteran factory unlocks, Ares plans | yes | yes | transactional | tick continuation/ready transition, veteran-production decision, and factory rebuild | veteran/history closed; live-world integration closed |
| GameObjects | stable object ID, owner PlayerList index, tile/sub-cell/elevation, limbo membership, core flags, and every registered trait codec | yes | yes | transactional strict | end-to-end restore + continuation against `Game.getHash()` | closed for the snapshot-supported world graph |
| Runtime-attached traits | traits the object factory does not build (Hunter Seeker pursuit) | yes | yes | re-attached from a registered factory, then state-restored | attach round-trip, unknown-key rejection, Hunter Seeker codec tests | closed for registered keys |
| Transport | held order, boarding queue order, crash latch | yes | yes | transactional in strict mode | restore and lifecycle tests | closed for codec |
| Garrison | occupant object IDs, temporary occupation, retained true-owner PlayerList index | yes | yes | transactional | duplicate-name owner and dirty-destination restore tests | closed |
| AttachEffect | instances, scheduler, residual timing/attribution, authored origins | yes | yes | strict and legacy modes | 100-tick continuation | subsystem qualified |
| Standalone animation damage | runtime ID/next ID, frame clock, accumulators, exact position, tile/elevation/zone, player identity | yes | yes | transactional strict mode | 100-tick continuation | subsystem qualified |
| Superweapons | owned charge/status/shot state, Ares ratios/pause timestamp/battery, active effect phase/timers and pending ChronoSphere sources | yes | yes | transactional for the supported effect slice | hash, charge, scheduler, and active-effect restore tests | supported effect slice closed |
| Lightning radar outage | per-effect owner, start/end ticks, relation set, active latch, and jammer refresh tick | yes | yes | transactional strict | round-trip, effect-rebind, and deactivation tests | closed |
| Object-tech overrides | object kind, TechnoType identity, and effective tech-level override | yes | yes | transactional strict | round-trip, identity-rejection, and continuation tests | qualified rules slice; full-world save integration closed |
| Map shroud/radiation/lighting | per-player shroud bitmaps and temporary reveals, visible/discovered sets, rad sites and timers, ambient clock | yes | yes | transactional strict | codec/hash tests | closed |
| Selection/control groups | selected object IDs and per-group membership | yes | yes | transactional strict | selection round-trip and group restore | closed |
| Alliances | pair status and the fixed-alliance latch | yes | yes | transactional strict | pair/duplicate/fixed-state validation | closed |
| Map teams | CreateTeam/DestroyTeam membership by stable object ID | yes | yes | transactional strict | recruit/destroy/state/hash tests | recruitment runtime closed; AI consumption of membership open |
| Secret labs | per-grant serial, building, owner index, boon id, and delivery outcome | yes | yes | transactional strict | bonus parse/eligibility/delivery/restore tests | payout roll closed; presentation and the wider boon vocabulary open |
| Crates | spawned crate object IDs, powerup identity, and lifetime | yes | yes | transactional strict | codec/hash tests | closed |
| Tasks/orders | order type + constructor flags + stable target, queued flags, shared waypoint path, and registered task contracts | yes | yes | transactional strict | order codec, task registry, and MoveTask round-trip tests | orders and movement tasks closed; unregistered task types still refused |
| Locomotors | private phase, path cursor, velocity/turn/transition state, explicit chrono-aftereffect lock, reserved path cells, active waypoint | yes | yes | transactional strict | codec/hash tests and in-flight reservation restore tests | closed |
| Triggers | completion/disabled/destruction marks, remaining targets/attachments, variables, persistent event marks, pending destruction, AllowWin holds, in-flight event queue | yes | partial | transactional strict | hash/codec/lifecycle tests | stable trigger slice closed; in-flight payloads and dynamic attachments open |
| Built-in AI | mission/history/production decision state not derivable from world | no complete coverage | no | no | no | open |

`WorldStateSnapshot` is the full-world checkpoint companion to
`ExtensionStateSnapshot`. It captures the canonical core axes (tick, PRNG,
`nextObjectId`, game status), every player with its owned-object membership, and
every spawned and limbo world object with tile/sub-cell/elevation, core flags,
and each registered trait codec. It also captures selection and control groups,
alliance pairs plus the fixed-alliance latch, map-team membership, and the
world-level traits (shroud, radiation, lighting, radar jammer, crates).
Restore validates identities transactionally before mutating live state:
duplicate object IDs, duplicate player slots, unresolved owners, a truncated
player set, a drifted object name/type, an object absent from the snapshot, and
an attached trait with no registered factory are all rejected. Both snapshots
are stored in the replay container (format v3) and are applied in the same order
at the real save/resume and terminal-replay seams, world first.

Restoring position uses the production inputs — tile, sub-cell, and tile
elevation — rather than an absolute world Y, because world Y is derived from
those and includes ramp and bridge height. Restoring an absolute elevation would
discard the ramp contribution and silently shift the object.

`SuperWeaponsTrait` captures the active superweapon-effect list, per-effect
phase/timer state, and pending ChronoSphere sources through a versioned codec.
`ExtensionStateSnapshot` dispatches that slice with strict player, tile, object,
and authored-rule identity checks; `SuperWeaponEffectState.test.ts` covers
round-trip and transactional rejection paths. `RadarTrait`'s active lightning
outage map is now hashed and restored: outages are persisted as an
(owner PlayerList index, effect index) pair and rebound to the effect the codec
reconstructs, so no effect state is duplicated.

Traits that the object factory does not build cannot be re-found by a
constructor-name scan, so they are handled separately. A trait opts in by
declaring a `runtimeAttachKey` static that is registered in
`ObjectTraitFactoryRegistry`; the snapshot stores the attach key, the trait's
immutable launch context, and its state, and restore rebuilds the trait from the
factory, re-attaches it, and only then applies its state. The Hunter Seeker
aircraft trait is the first such entry: its in-flight target and pursuit cell are
captured this way, which is what actually carries the effect's future behavior
once the one-shot launch effect has finished.

The Chronosphere aftereffect latch is explicit state on `MoveTrait`, not an
alias for generic movement disable. It participates in the object hash and the
versioned move-state codec. Strict restore requires a resolved locomotor.

In-flight path state is now restorable rather than refused. `MoveTrait` stores
its reserved path cells and active waypoint as map coordinates plus a bridge
flag, so restore re-resolves each cell, releases the pre-restore world's
reservations, and re-registers them. A version-1 checkpoint that carries only the
legacy counts is still refused, because a count cannot reconstruct the cells.
Unit orders follow the same idea: each order is rebuilt from its `OrderType`
plus the constructor flags that the type does not determine — `PlaceBomb` and
`Attack` both construct an `AttackOrder` and both report `OrderType.Attack`, so
the Ivan-bomb policy is captured explicitly and hashed, and the target is
restored as a stable object id plus map cell. Orders without a registered
constructor-flag contract contribute no flags and default to their factory
values.

The live task graph is the remaining open part of a unit's intent, so tasks opt
in through `TaskStateRegistry`: a task registers a factory for its stable
`deterministicType` and a checkpoint rebuilds it from the captured payload.
`MoveTask` is registered and carries its target cell, path, blocked nodes,
unreachable targets, planning latches, and lepton offsets; blockers and
stop-on targets cross worlds as stable object ids. A task with no registered
contract keeps the explicit `unclassified-task` marker and strict restore
refuses it rather than silently dropping the unit's intent, so the gap stays
visible instead of being papered over.

The trigger codec now carries instance completion/disabled state, remaining
semi-persistent targets, persistent event marks, deferred-destruction marks,
variables, and PlayerList-indexed AllowWin holds. Rememberable temporal event
marks survive only for Persistent tags; Volatile and SemiPersistent marks are
cleared. Pending in-flight event payloads contribute to the hash, but strict
restore rejects a snapshot that contains them instead of fabricating them.
This closes the stable trigger slice; the world graph itself is covered by `WorldStateSnapshot`.

Trigger attachment coverage is intentionally narrower. Initial map objects and
cells are bound, and linked trigger chains release deferred tags coherently;
`mustTransfer` is parsed but has no dynamic attachment consumer, and
dynamically created/team-member attachments remain open. Stock event IDs 3 and
18 are still unregistered and unreachable. The per-house campaign AI-trigger
latch is now part of the player hash and the world snapshot.

Secret labs are a good example of why the world snapshot matters: the payout
rolls from the shared PRNG, so it is canonical state rather than cosmetics. If
the granted set were not snapshotted, resuming a save would re-roll and two
peers would disagree about a bonus that has already been paid. The grant records
whether delivery actually succeeded, so a payout with no placement cell is
visible instead of looking like a successful bonus.

`TeamRuntime` implements the campaign CreateTeam/DestroyTeam seam: it recruits
authored preplaced members (by `Mission`/`Group`/`Autocreate` from the map
object records) up to the team type's `Max`, enforces `Min` before committing,
never double-recruits, and destroys membership without destroying units.
Membership is hashed and carried in the world snapshot as stable object IDs.
AI and trigger consumers that would branch on team membership are still open.

AllowWin action 15 is an intentional executor no-op: the trigger manager holds a
campaign outcome for the affected house until its tag chain is destroyed, and
those holds are hashed/restored. Likewise, action 106's validated object-tech
overrides are hashed and carried in the world snapshot, and the full world graph
now restores. Campaign outcome breadth and action/event coverage are still open,
and no live multiplayer or LAN lockstep claim follows from these synthetic
restore tests.

The bounded task descriptor deliberately uses stable explicit type IDs and an
`unclassified-task` marker; it does not use `constructor.name` and does not
pretend that closures or target references are serializable. Every registered
task contract resolves its cells and object references before it mutates
anything, so a rejected checkpoint cannot leave a half-restored task graph
behind. Similarly, presentation-only animation/sound timing and wall-clock
timestamps remain outside the simulation fingerprint.

Strict restore paths reject unresolved authored definitions and required
cross-world references before replacing live state. Legacy save callers may
use permissive modes where retained compatibility requires inert placeholders;
deterministic qualification must use strict mode.

`Production.veteranTypes` is historical canonical state: infiltration changes
whether future units are produced as veterans, so it is included in the
versioned production snapshot and hash. `factoryCounts` is world-derived and
`Production.rebuildFactoryDerivedState()` rebuilds it from canonical owned
factory objects. `primaryFactories` is canonical selection state because the
player can explicitly change the primary factory through the deploy order; its
stable object IDs are included in the production snapshot and hash, then
rebound after the count rebuild. Strict restore additionally requires each
resolved primary factory to be the exact live object in the restoring player's
owned-building set; matching an ID and factory type is not sufficient. The
queue codec does not claim to close live-world production integration.

`GarrisonTrait` has a trait-level codec for occupant object IDs, temporary
occupation, and retained owner PlayerList identity. Its
`AresGarrisonOccupantTrait` bridge keeps the legacy permissive hostless fallback,
but strict canonical restore rejects an unresolved or ID-mismatched host.

Several object traits previously contributed to `GameObject.getHash()` without
any capture path, which meant a hash-blind field could survive a checkpoint. They
now have versioned codecs picked up by the generic world-snapshot walk:
health/project HP, power level and blackout with Ares battery maps, per-house
radar enable state, weapon cooldown and burst counters (through `ArmedTrait`),
attack phase/targets/history, cloak, deployer, EMP paralysis, disguise,
parasitation, magnetron hold, berserk, suppression, robot control, harvester
cargo and timers, temporal beam links, and unit order task structure. Their
`getHash()` implementations were added where the trait previously had none, so
the field is both hashed and restorable.

The AttachEffect identity audit also reproduced a shared source-name key when
an automatic TechnoType effect and a Warhead effect use the same identifier.
The Antares `419626d` reference returns early for non-cumulative reapplication
after refreshing the existing effect, so it does not replace the original
invoker; `AresAttachEffectIdentity.test.ts` records that preserved residual
damage attribution. The shared identifier namespace remains unchanged because
the reference behavior does not establish simultaneous cross-origin stacking
as a supported case. Automatic AttachEffect phase/delay is part of the same
qualified subsystem state. EMP, missing-operator, Ares power-off, and
robot-control deactivation suppress automatic application/renewal and expire
only the automatic TechnoType-owned effect; independently applied Warhead
effects continue. This is runtime behavior, not a claim of complete
transport/temporal replay, AI breadth, target-content parity, or live
multiplayer.
