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
| Custom superweapon fields/types | 1,921 authored entries / 1,011 Ares-mapped | 1 | 96 custom types | generic host/AI slices now cover lifecycle messages/EVA/Text/Light, EMPulse PulseBall, DropPod infantry/trailer/impact, and Hunter Seeker lepton/profile behavior; unsupported handlers, complete AI, persistence, and multiplayer gaps remain |
| CustomPalette | 541 | 1 | 541 / 541 | implemented, render certification open |
| EMP fields | 432 | 1 | 392 / 392 | implemented, presentation/persistence gaps remain |
| Projectile Airburst/Splits extensions | 614 | 1 | 232 / 232 | parser/runtime slice implemented; Proximity and target-content flight certification remain open |
| VehicleThief / CanDrive | 271 | 1 | 263 / 263 | generic enemy hijack and neutral DriverKilled reclaim are implemented; CanBeDriven, mind-control, and recovery/recycle semantics are wired, while integration gaps remain |
| AttachEffect combat | 820 | 1 | 218 / 218 | parser/model complete; state, trait, combat modifiers, attached animation visibility, temporary Cloakable source/expiry behavior, attached animation Damage/Delay/Warhead/Weapon delivery, and standalone TriggerAnim/WarheadDetonate animation damage are wired; transport/temporal lifecycle remains partial |
| Bounty | 1,343 | 1 | 626 / 626 | parser/model complete; generic weapon/crush rewards, enablers, country gates, and rank values are wired; amount presentation, full-game persistence, and target-content certification remain |
| Chronoshift eligibility | 1,176 | 1 | 1,141 / 1,141 | parser/model complete; Chronosphere kill/affect controls, vehicle-building relocation, cargo handling, and non-crushable/infantry-crush rules are wired; transport side effects, save/load, and lockstep certification remain partial |
| PCX cameos | 708 | 1 | 525 / 525 | parser/model complete; 60x48 VFS discovery and validated manifest present; SHP-only sidebar display remains partial |
| Damage particle systems | 590 | 1 | 590 | parser/model complete; TechnoRules selection and legacy vehicle smoke gate wired; BehavesLike fallback remains metadata-aware, while ParticleSystem spawn, sparks, and non-vehicle coverage remain partial |
| Customizable insignia | 855 | 1 | 401 | parser/model complete; generic SHP/frame selection and enemy/observer visibility are wired; render-host, missing-asset, save/mod-hash, and multiplayer certification remain |
| Reverse engineering | 515 | 1 | 515 | parser/model complete; grinder entry, production unlocks, prerequisite exceptions, spy reset, and extension persistence are wired; EVA, AI, full-game save/load, and lockstep certification remain |
| Customizable veterancy | 427 | 1 | 427 / 427 | generic deterministic kill-credit attribution now applies passenger gating/modifiers, airstrike modifiers, spawn-owner/spawn modifiers, mind-control victim/self modifiers, and Trainable=no; complete occupier/passenger lifecycle, presentation, persistence, AI, and multiplayer gaps remain |

## Remaining MO-used P0 Ares backlog

The official Ares pages define these as separate generic capabilities: [AttachEffect](https://ares-developers.github.io/Ares-docs/new/attacheffect.html), [Chronoshift](https://ares-developers.github.io/Ares-docs/new/chronoshift.html), [PCX Cameos](https://ares-developers.github.io/Ares-docs/new/pcxcameos.html), [Damage Particle Systems](https://ares-developers.github.io/Ares-docs/new/damageparticlesystems.html), [Reverse Engineer logic](https://ares-developers.github.io/Ares-docs/new/reverseengineerlogic.html), [Bounty](https://ares-developers.github.io/Ares-docs/new/bounty.html), and [Customizable Veterancy](https://ares-developers.github.io/Ares-docs/new/customizableveterancy.html).

The local scan records **1,176 Chronoshift occurrences across 1,141 definitions**, second only to Bounty's 1,343 occurrences. The current generic slice covers unit/building eligibility, Chronosphere filtering, authored kill/affect controls, cargo behavior, and foundation-aware building placement. Customizable Veterancy, ChronoWarp/PostDependent, and the MO custom-superweapon host/AI paths now have bounded generic slices; none is a claim of complete Ares or Mental Omega compatibility.

| Capability | Exact scan evidence | Official generic boundary | Current gap |
| --- | --- | --- | --- |
| AttachEffect combat | 820 occurrences; 218 definitions | `AttachEffect.SpeedMultiplier`, `ArmorMultiplier`, `FirepowerMultiplier`, `ROFMultiplier` plus existing duration/protection fields | Speed, armor, firepower, ROF callsites, attached animation visibility, temporary Cloakable source/expiry behavior, attached animation Damage/Delay/Warhead/Weapon delivery, and standalone TriggerAnim/WarheadDetonate animation damage are wired; transport/temporal lifecycle, save/load, and lockstep replay remain |
| Chronoshift eligibility | 1,176 occurrences; 1,141 definitions | `ChronoInfantryCrush`, `Chronoshift.*`, and `Chronosphere.*` kill/affect/placement controls | Transport side effects, save/load, and lockstep certification |
| Bounty | 1,343 occurrences; 626 definitions | `BountyEnablers`, `Bounty`, `Bounty.Display`, value tiers, `BountyDisplay`, `GivesBounty` | Amount presentation, full-game persistence, multiplayer/lockstep certification, and target-content verification |
| Customizable insignia | 855 occurrences; 401 definitions | `Insignia.*`, `InsigniaFrame.*`, `Insignia.ShowEnemy`, `EnemyInsignia` | Render-host and missing-asset certification, save/mod-hash, and multiplayer verification |
| PCX cameos | 708 occurrences; 525 definitions | `CameoPCX`, `AltCameoPCX`, `SidebarPCX` with Ares's 60x48 256-color asset contract | VFS discovery/validation is wired; SHP-only sidebar display, palette/display certification, save/mod-hash, and multiplayer certification remain |
| Damage particle systems | 590 occurrences; 590 definitions | `DamageSparks`, `DamageSmokeParticleSystems`, `DamageSparksParticleSystems` | TechnoRules selection and legacy vehicle smoke gating are wired; BehavesLike fallback filters only when metadata is supplied, while current TechnoRules lacks metadata lookup. Health-threshold spawning/random selection, complete sparks rendering, non-vehicle coverage, save/load, and multiplayer certification remain |
| Reverse engineering | 515 occurrences; 515 definitions | `ReverseEngineersVictims`, `CanBeReversed`, `ReversedAs`, and reverse-engineering reset | EVA, AI/build-limit certification, full-game save/load, lockstep, and target-content verification |
| Customizable veterancy | 427 occurrences; 427 definitions | `Trainable`, all documented `Experience.*` passenger, airstrike, spawn, and mind-control controls | Generic deterministic kill-credit attribution now applies passenger gating/modifiers, airstrike modifiers, spawn-owner/spawn modifiers, mind-control victim/self modifiers, and `Trainable=no`; complete occupier/passenger lifecycle, presentation, AI, persistence, multiplayer, and target-content verification remain |
| ChronoWarp / `SW.PostDependent` | 3 authored ChronoWarp definitions; 3 `PostClick`/`PreDependent` definitions | Source ChronoSphere selection followed by a dependent ChronoWarp destination | Case-insensitive dependent resolution, ChronoWarp fallback, and the source/destination host path are covered; full dependent graphs, AI, cursor/presentation, persistence, multiplayer, and target-content verification remain |
| MO custom-superweapon host/AI coverage | 96 custom-type definitions; representative handlers covered by focused host fixtures | Generic host dispatch for GenericWarhead, UnitDelivery, EMPulse, SonarPulse, DropPod, HunterSeeker, Battery, Firestorm, and ChronoWarp destination; bounded AI targeting for EMPulse, UnitDelivery, and DropPod; lifecycle EVA/Message/Text/Light consumers; EMPulse PulseBall at weapon FLH; DropPod infantry/trailer/impact behavior; and Hunter Seeker native-lepton/profile handling | Unsupported custom handlers, complete AI selector parity, full in-flight/save restoration, multiplayer, and target-content certification remain |

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

The remaining `Not implemented`/unsupported guards were audited separately.
Object and renderable factories reject object kinds that are art-only, bridge
ID calculators reject invalid `NotBridge` inputs, CrashableTrait rejects
locomotors without a defined crash trajectory, and MiniLZO compression is
unused by the runtime (only decompression is required). These are explicit
fail-closed boundaries, not silently claimed Ares support. The next real Ares
runtime gaps remain animation damage from direct renderer-only transient
animation callsites,
custom superweapon handler breadth and state persistence, and the transport,
AI, save/load, and multiplayer portions called out in the tables above.

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
