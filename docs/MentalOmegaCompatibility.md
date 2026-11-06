# Mental Omega compatibility

This branch is the compatibility branch for a user-selected Mental Omega
profile. It uses the Yuri's Revenge simulation engine plus an explicit Ares
extension runtime identifier; vanilla `ra2` and `yr` profiles remain separate.

## Current foundation

- `mental-omega` is an explicit profile and is never inferred by the vanilla
  `detectGameProfile()` function.
- Android has a separate `mo` flavor and rejects a plain Yuri's Revenge folder
  unless Mental Omega rules/art and MO content are present.
- MO archive names such as `expandmo95.mix` are loaded through the profile-aware
  overlay path.
- VFS resolution has explicit layers and provenance diagnostics.
- The Ares scanner reports `vanilla`, `ares-known`, `mo-content`, and
  `unclassified` keys separately. An unknown key never implies Ares support.
- Additional armor types and per-armor warhead verses are normalized through a
  shared armor registry.
- Sides and countries are parsed from data-defined registries rather than
  assuming only the vanilla side/country set.
- Generic Ares prerequisites support custom groups, alternate TechnoTypes,
  alternative lists, negative prerequisites, stolen-tech gates, and theater
  gates when map theater context is available.
- The standard Ares/retail locomotor CLSIDs now resolve case-insensitively,
  including Tunnel, Mech, DropPod, and Levitate, without coercing unknown
  locomotors into Chrono.
- Tunnel locomotion now has a shared long-route underground path, the retail
  subterranean elevation and horizontal speed, Mech's no-acceleration and
  reduced-speed behavior, and generic Ares Dig/DigIn/DigOut presentation
  fields. Full locomotor edge parity and content certification remain open.

## Local Mental Omega 3.3.6 scan checkpoint

The user-owned installation at `/home/ra2 android/RA2 MO` was scanned through
the effective profile roots:

```text
rulesmo.ini
artmo.ini
aimo.ini
uimd.ini
soundmo.ini
```

The include graph resolved 5 roots with 0 missing includes, 0 cycles, and 0
duplicate loads. The raw roots contain 14,137 section headers, 14,129 unique
section names, and 214,282 key entries. The effective scanner representation
contains 214,218 normalized key entries. The highest-impact identified Ares
usage currently is:

| Capability | Occurrences | Source files | Sections/definitions | Runtime status |
| --- | ---: | ---: | ---: | --- |
| Custom ArmorTypes / `Versus.*` | 8,916 | 1 | 640 / 877 | implemented, target integration open |
| Custom foundations / outlines | 2,671 | 1 | 79 / 79 | implemented, target integration open |
| Custom superweapon fields/types | 1,921 authored entries / 1,011 Ares-mapped | 1 | 96 custom types | generic host/AI slices now cover lifecycle messages/EVA/Text/Light, `Nuke.Payload`/`Nuke.SiloLaunch`, the per-weapon Lightning Storm scheduler, multi-weapon AutoFire, EMPulse PulseBall, DropPod infantry/trailer/impact, Hunter Seeker lepton/profile behavior, land/water-aware non-unit targeting, local Dominator/Genetic clusters, ParaDrop free-area/base-point selection, and a supported active-effect snapshot/restore slice; unsupported handlers/effect internals, complete AI, target-content, and live-multiplayer gaps remain |
| CustomPalette | 541 | 1 | 541 / 541 | implemented, render certification open |
| EMP fields | 432 | 1 | 392 / 392 | implemented, presentation/persistence gaps remain |
| Projectile Airburst/Splits/BallisticScatter extensions | 614 | 1 | 232 / 232 | per-projectile BallisticScatter bounds and deterministic child-projectile paths are implemented; Proximity, in-flight persistence, target-content flight certification, and live multiplayer remain open |
| VehicleThief / CanDrive | 271 | 1 | 263 / 263 | generic enemy hijack and neutral DriverKilled reclaim are implemented; CanBeDriven, mind-control, and recovery/recycle semantics are wired, while integration gaps remain |
| AttachEffect combat | 820 | 1 | 218 / 218 | parser/model complete; state, trait, combat modifiers, attached animation visibility, temporary Cloakable source/expiry behavior, animation damage delivery, and EMP/operator/power/robot deactivation suppression for the automatic TechnoType-owned lifecycle are wired; transport/temporal replay, unsupported presentation/AI breadth, target-content, and live multiplayer remain partial/open |
| Bounty | 1,343 | 1 | 626 / 626 | parser/model complete; generic weapon/crush rewards, enablers, country gates, and rank values are wired; amount presentation, full-game persistence, and target-content certification remain |
| Chronoshift eligibility | 1,176 | 1 | 1,141 / 1,141 | parser/model complete; Chronosphere kill/affect controls, vehicle-building relocation, cargo handling, crush rules, and the hashed/restored chrono-aftereffect lock are wired; transport/building edges, target-content, and live multiplayer remain open |
| PCX cameos | 708 | 1 | 525 / 525 | parser/model complete; 60x48 VFS discovery and validated manifest present; SHP-only sidebar display remains partial |
| Damage particle systems | 590 | 1 | 590 | parser/model complete; TechnoRules selection and legacy vehicle smoke gate wired; BehavesLike fallback remains metadata-aware, while ParticleSystem spawn, sparks, and non-vehicle coverage remain partial |
| Customizable insignia | 855 | 1 | 401 | parser/model complete; generic SHP/frame selection and enemy/observer visibility are wired; render-host, missing-asset, save/mod-hash, and multiplayer certification remain |
| Reverse engineering | 515 | 1 | 515 | parser/model complete; grinder entry, production unlocks, prerequisite exceptions, spy reset, and extension persistence are wired; EVA, AI, full-game save/load, and lockstep certification remain |
| Customizable veterancy | 427 | 1 | 427 / 427 | generic deterministic kill-credit attribution now applies passenger gating/modifiers, airstrike modifiers, spawn-owner/spawn modifiers, mind-control victim/self modifiers, and Trainable=no; complete occupier/passenger lifecycle, presentation, persistence, AI, and multiplayer gaps remain |

## Remaining MO-used P0 Ares backlog

The official Ares pages define these as separate generic capabilities: [AttachEffect](https://ares-developers.github.io/Ares-docs/new/attacheffect.html), [Chronoshift](https://ares-developers.github.io/Ares-docs/new/chronoshift.html), [PCX Cameos](https://ares-developers.github.io/Ares-docs/new/pcxcameos.html), [Damage Particle Systems](https://ares-developers.github.io/Ares-docs/new/damageparticlesystems.html), [Reverse Engineer logic](https://ares-developers.github.io/Ares-docs/new/reverseengineerlogic.html), [Bounty](https://ares-developers.github.io/Ares-docs/new/bounty.html), and [Customizable Veterancy](https://ares-developers.github.io/Ares-docs/new/customizableveterancy.html).

The local scan records **1,176 Chronoshift occurrences across 1,141 definitions**, second only to Bounty's 1,343 occurrences. The current generic slice covers unit/building eligibility, Chronosphere filtering, authored kill/affect controls, cargo behavior, and foundation-aware building placement. Customizable Veterancy, ChronoWarp/PostDependent, and the MO custom-superweapon host/AI paths now have bounded generic slices; the shared extension snapshot also restores the supported active superweapon-effect slice and pending ChronoSphere sources. None is a claim of complete Ares or Mental Omega compatibility.

| Capability | Exact scan evidence | Official generic boundary | Current gap |
| --- | --- | --- | --- |
| AttachEffect combat | 820 occurrences; 218 definitions | `AttachEffect.SpeedMultiplier`, `ArmorMultiplier`, `FirepowerMultiplier`, `ROFMultiplier` plus existing duration/protection fields | Numeric combat/animation/Cloakable delivery and the automatic lifecycle are wired; EMP, missing-operator, Ares power-off, and robot-control deactivation suppress initial application/renewal and expire only the automatic TechnoType-owned effect. Full transport/temporal replay, unsupported presentation/AI breadth, target-content verification, and live multiplayer remain |
| Chronoshift eligibility | 1,176 occurrences; 1,141 definitions | `ChronoInfantryCrush`, `Chronoshift.*`, and `Chronosphere.*` kill/affect/placement controls | The explicit chrono-aftereffect lock is hashed/restored; transport/building edges, in-flight path references, target-content verification, and live multiplayer remain open |
| Bounty | 1,343 occurrences; 626 definitions | `BountyEnablers`, `Bounty`, `Bounty.Display`, value tiers, `BountyDisplay`, `GivesBounty` | Amount presentation, full-game persistence, multiplayer/lockstep certification, and target-content verification |
| Customizable insignia | 855 occurrences; 401 definitions | `Insignia.*`, `InsigniaFrame.*`, `Insignia.ShowEnemy`, `EnemyInsignia` | Render-host and missing-asset certification, save/mod-hash, and multiplayer verification |
| PCX cameos | 708 occurrences; 525 definitions | `CameoPCX`, `AltCameoPCX`, `SidebarPCX` with Ares's 60x48 256-color asset contract | VFS discovery/validation is wired; SHP-only sidebar display, palette/display certification, save/mod-hash, and multiplayer certification remain |
| Damage particle systems | 590 occurrences; 590 definitions | `DamageSparks`, `DamageSmokeParticleSystems`, `DamageSparksParticleSystems` | TechnoRules selection and legacy vehicle smoke gating are wired; BehavesLike fallback filters only when metadata is supplied, while current TechnoRules lacks metadata lookup. Health-threshold spawning/random selection, complete sparks rendering, non-vehicle coverage, save/load, and multiplayer certification remain |
| Reverse engineering | 515 occurrences; 515 definitions | `ReverseEngineersVictims`, `CanBeReversed`, `ReversedAs`, and reverse-engineering reset | EVA, AI/build-limit certification, full-game save/load, lockstep, and target-content verification |
| Customizable veterancy | 427 occurrences; 427 definitions | `Trainable`, all documented `Experience.*` passenger, airstrike, spawn, and mind-control controls | Generic deterministic kill-credit attribution now applies passenger gating/modifiers, airstrike modifiers, spawn-owner/spawn modifiers, mind-control victim/self modifiers, and `Trainable=no`; complete occupier/passenger lifecycle, presentation, AI, persistence, multiplayer, and target-content verification remain |
| ChronoWarp / `SW.PostDependent` | 3 authored ChronoWarp definitions; 3 `PostClick`/`PreDependent` definitions | Source ChronoSphere selection followed by a dependent ChronoWarp destination | Case-insensitive dependent resolution, ChronoWarp fallback, and the source/destination host path are covered; full dependent graphs, AI, cursor/presentation, persistence, multiplayer, and target-content verification remain |
| MO custom-superweapon host/AI coverage | 96 custom-type definitions; representative handlers covered by focused host fixtures | Generic host dispatch for GenericWarhead, UnitDelivery, EMPulse, SonarPulse, DropPod, HunterSeeker, Battery, Firestorm, MultiMissile payload/silo routing, and ChronoWarp destination; per-weapon Lightning Storm duration/delay/separation/radar scheduling including MO's `Lightning.Seperation` alias; multi-launch AutoFire; bounded AI targeting and P7-decoded preferred cells; lifecycle presentation consumers; and a versioned active-effect/pending-source snapshot slice | Unsupported custom handlers, complete AI selector/scheduling and presentation breadth, unsupported effect internals, target-content verification, and live multiplayer remain |

The scanner currently reports a broad unclassified bucket because ordinary
Mental Omega content is not all safely classifiable from INI spelling alone.
That bucket is a diagnostic backlog, not a claim that every entry is an Ares
mechanic. Development follows the report's measured MO usage and dependency
order; only generic Ares capabilities exercised by MO are in scope.

## Shared runtime audit

The unrelated runtime pass found and fixed several generic failure seams that
could affect both vanilla and Ares matches:

- stale projectile damage now ignores destroyed, disposed, crashing, or
  health-less targets;
- target-cell healing/negative-damage warheads no longer require a concrete
  attacker object, so generic area heals fail safely instead of throwing;
- optional `DropPodWeapon=NotAWeapon`/`None` sentinels are excluded from the
  shared weapon index, so map validation does not reject otherwise valid maps;
- destruction is idempotent when multiple effects converge on one object, and
  kill-notification/score attribution tolerates cleanup paths without a player
  payload;
- map sprite batching creates its parent lazily when streamed map objects arrive
  before the first render frame;
- stale temporal attacker links are released instead of throwing during erase;
- Ares AttachEffect presentation work is cached at factory creation and stays
  idle until a target actually receives an effect.
- Standard Ares locomotor resolution no longer fails at unit creation for
  Tunnel/Mech/DropPod/Levitate CLSIDs. Tunnel movement emits authored dig
  effects, transitions through the configured subterranean elevation, and
  bypasses surface blockers only for long underground orders; short orders
  retain ordinary ground pathing.
- the active superweapon-effect slice now has a versioned capture/restore path,
  including per-effect phase/timer fields, stable player/tile/object references,
  and pending ChronoSphere sources; this is covered by synthetic round-trip and
  strict transactional tests, not by a full-world save claim;
- the shared AI planner applies land/water requirements to non-unit selectors,
  uses local capturable clusters for Psychic Dominator and Genetic Mutator,
  ranks free land areas for ParaDrop, and uses the owning base center/fallback
  for base-oriented modes;
- Psychic Dominator and Force Shield authored per-weapon settings and global
  defaults are consumed by their effects, while authored zero values remain
  distinct from omitted settings;
- laser-fence topology uses each post's `GuardRange`, including asymmetric
  reach, and its runtime state is captured in the extension snapshot;
- Chronosphere selection now uses an explicit chrono-aftereffect lock rather
  than generic movement disable; that lock is hashed and restored with the
  move-state slice, while strict restore still refuses in-flight path references;
- per-weapon Lightning Storm settings now drive indefinite/zero duration,
  independent delay streams, bounded Manhattan-separated scatter, authored
  damage/warhead, and relation-aware radar outage after deferment; the MO
  `Lightning.Seperation` spelling is accepted without overriding canonical
  `Lightning.Separation`;
- MultiMissile honors typed `Nuke.Payload` and `Nuke.SiloLaunch`, and the
  automatic-fire pump can launch multiple ready supported weapons in one
  deterministic pass.

## Current map-trigger and campaign runtime slice

- Trigger lifetimes now use canonical Volatile, SemiPersistent, and Persistent
  semantics. Volatile and semi-persistent firings retire their trigger chain and
  release tag attachments; persistent triggers remain attached and retain
  eligible temporal event marks across frames. Event marks, pending tag
  destruction, variables, remaining targets, and AllowWin holds participate in
  the trigger hash and strict transactional slice. `DestroyTag` is deferred to
  the end of the trigger pass, and ForceTrigger refuses disabled, finished,
  difficulty-gated, or destruction-marked instances.
- The eighth trigger field is retained as `mustTransfer`, but no runtime path
  yet consumes it to transfer dynamically created/team-member attachments.
  Initial map objects and cells are bound, while dynamic attachments remain
  open. Event IDs 3 and 18 remain unregistered and unreachable rather than being
  silently mapped to another event.
- Stock event ID 24 (`ZoneEntryBy`), object/house discovery IDs 4/5, and
  selection ID 33 now consume numeric event-bus records. Selection emits once
  per newly selected object, and discovery events are produced after shroud
  visibility; this is synthetic coverage, not target-content or live-networking
  certification.
- The shared P7 decoder accepts signed integers and spreadsheet columns for
  ordinary map actions, including preferred-cell actions 135/140. Those actions
  set or clear the trigger house's stored offensive/defensive preferred cell.
  Action 106 (`SetObjectTechLevel`) is stricter: it requires object marker 9,
  resolves an unambiguous TechnoType, accepts only `-1` or non-negative integer
  tech levels, validates before mutation, and stores a canonical override that
  is hashed and transactionally restored.
- Action 15 (`AllowWin`) does not end a mission by itself. In campaign mode the
  trigger manager holds the selected house's outcome until the relevant tag
  chain is destroyed; a single volatile/semi-persistent firing keeps its hold,
  whereas destruction with no live linked trigger releases it. Noncampaign
  victory ignores the hold. Holds use PlayerList-indexed snapshot state.
- Action 13 remains an explicit compatibility no-op. Actions 74/75 toggle only
  the selected house's AI-trigger latch; campaign AI defaults to gated/off
  unless explicitly enabled, skirmish defaults on, and a disabled gate consumes
  no PRNG. The latch is now hashed and carried in the world snapshot; broader
  campaign-script integration is still open.
- Generic team/task-force reinforcement lookup is covered, and the campaign
  CreateTeam/DestroyTeam runtime now recruits authored preplaced members by
  `Mission`/`Group`/`Autocreate` with `Min`/`Max` enforcement, hashed and
  snapshotted as stable object IDs. Dynamic team-member trigger attachment,
  `mustTransfer` consumption, AI consumption of team membership, broad
  trigger-script behavior, unsupported presentation breadth, target-content
  verification, and live multiplayer remain explicit gaps.

The remaining `Not implemented`/unsupported guards were audited separately.
Object and renderable factories reject object kinds that are art-only, bridge
ID calculators reject invalid `NotBridge` inputs, CrashableTrait rejects
locomotors without a defined crash trajectory, and MiniLZO compression is
unused by the runtime (only decompression is required). These are explicit
fail-closed boundaries, not silently claimed Ares support. The next real gaps
remain unsupported custom-superweapon presentation/AI breadth and effect
internals, full locomotor transition/targeting edge parity, campaign team and
dynamic attachment runtime, unreachable stock event IDs 3/18, full-world
save/load, target-content verification, and live multiplayer.

## Compatibility status

This is intentionally not a claim of complete runtime compatibility yet.
The scanner and feature registry are the source of truth for the next phases:

1. keep the canonical profile roots and requirement report current;
2. continue by capability boundary: complete the highest-value missing generic features and the remaining runtime slices documented in the registry;
3. verify each capability with a synthetic fixture and local MO integration
   test;
4. validate skirmish, save/load, deterministic lockstep, LAN, and campaigns.

Proprietary RA2, Yuri's Revenge, and Mental Omega files are not committed to
this repository or bundled in public APKs. Local integration tests should be
run against user-owned installations.
