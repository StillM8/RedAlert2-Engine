# Deterministic state coverage

`Game.getHash()` is a simulation fingerprint, not a certification that every
mutable engine subsystem is reconstructible. A field is canonical when a peer
disagreement can change a future simulation result. Canonical fields must be
represented by stable scalar identities, hashed, and included in a validated
snapshot when that subsystem has a restore codec.

| Subsystem | Mutable future-affecting state audited | HASH | SNAPSHOT | RESTORE | QUALIFIED | Status |
| --- | --- | --- | --- | --- | --- | --- |
| PRNG | MT19937 624-word state, index, last emitted value | yes | yes | transactional | 4,537 + 5,000 continuation | closed for codec |
| Players | credits, defeat/score, Firestorm flag, negative BuildLimit history, owned production/SW state | yes | partial | partial | adversarial hash tests | full Player snapshot open |
| Production | ordered queue items, quantities, status, spend/fraction/progress, build-speed modifier, veteran factory unlocks, Ares plans | yes | yes | transactional | tick continuation/ready transition, veteran-production decision, and factory rebuild | veteran/history closed; full-world restore integration open |
| GameObjects | stable object ID, owner PlayerList index, position, registered trait hashes | yes | no full-world codec | no full-world codec | owner/trait negative controls | full-world restore open |
| Transport | held order, boarding queue order, crash latch | yes | yes | transactional in strict mode | restore and lifecycle tests | closed for codec |
| Garrison | occupant object IDs, temporary occupation, retained true-owner PlayerList index | yes | yes | transactional | duplicate-name owner and dirty-destination restore tests | trait codec closed; full-world integration open |
| AttachEffect | instances, scheduler, residual timing/attribution, authored origins | yes | yes | strict and legacy modes | 100-tick continuation | subsystem qualified |
| Standalone animation damage | runtime ID/next ID, frame clock, accumulators, exact position, tile/elevation/zone, player identity | yes | yes | transactional strict mode | 100-tick continuation | subsystem qualified |
| Superweapons | owned charge/status/shot state, Ares ratios/pause timestamp/battery, active effect hashes | yes | partial | partial | hash and charge tests | active-effect full restore open |
| Tasks/orders | bounded descriptors for Wait/Turn and structural queue state | bounded | no general codec | no general codec | negative structural tests | target/closure tasks open |
| Locomotors | private phase, path cursor, velocity/turn/transition state | no uniform coverage | no | no | no | open |
| Triggers | trigger completion/disabled state, remaining targets, variables, pending events | no | no | no | no | open |
| Built-in AI | mission/history/production decision state not derivable from world | no complete coverage | no | no | no | open |

The bounded task descriptor deliberately uses stable explicit type IDs and an
`unclassified-task` marker; it does not use `constructor.name` and does not
pretend that closures or target references are serializable. Similarly,
presentation-only animation/sound timing and wall-clock timestamps remain
outside the simulation fingerprint.

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
owned-building set; matching an ID and factory type is not sufficient. A future
full-world restore must call that entry point before resuming production. The
queue codec does not claim to close that integration. `FactoryTrait`
delivery/status/retry state has the same outstanding full-GameObject closure
obligation.

`GarrisonTrait` now has a small trait-level codec for occupant object IDs,
temporary occupation, and retained owner PlayerList identity. It does not claim
to restore the owning GameObject, player ownership, or the complete world
membership graph; those remain full-world restore responsibilities. Its
`AresGarrisonOccupantTrait` bridge keeps the legacy permissive hostless fallback,
but strict canonical restore rejects an unresolved or ID-mismatched host.

The AttachEffect identity audit also reproduced a shared source-name key when
an automatic TechnoType effect and a Warhead effect use the same identifier.
The Antares `419626d` reference returns early for non-cumulative reapplication
after refreshing the existing effect, so it does not replace the original
invoker; `AresAttachEffectIdentity.test.ts` records that preserved residual
damage attribution. The shared identifier namespace remains unchanged because
the reference behavior does not establish simultaneous cross-origin stacking
as a supported case.
