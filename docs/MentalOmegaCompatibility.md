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
| Custom superweapon fields/types | 1,921 authored entries / 1,011 Ares-mapped | 1 | 96 custom types | parser partial, availability and handler gaps remain |
| CustomPalette | 541 | 1 | 541 / 541 | implemented, render certification open |
| EMP fields | 432 | 1 | 392 / 392 | implemented, presentation/persistence gaps remain |
| Projectile Airburst/Splits extensions | 614 | 1 | 232 / 232 | parser/runtime slice implemented; Proximity and target-content flight certification remain open |
| VehicleThief / CanDrive | 271 | 1 | 263 / 263 | core runtime implemented, integration gaps remain |
| Damage particle systems | 590 | 1 | 590 | parser inventory only; generic runtime gap remains |
| PCX cameos | 708 | 1 | 525 | parser/presentation gap remains |
| Reverse engineering | 515 | 1 | 515 | generic eligibility and production gap remains |
| Chronoshift eligibility | 1,042 | 1 | 1,041 | generic object/building semantics remain |

The scanner currently reports a broad unclassified bucket because ordinary
Mental Omega content is not all safely classifiable from INI spelling alone.
That bucket is a diagnostic backlog, not a claim that every entry is an Ares
mechanic. Development follows the report's measured MO usage and dependency
order; only generic Ares capabilities exercised by MO are in scope.

## Compatibility status

This is intentionally not a claim of complete runtime compatibility yet.
The scanner and feature registry are the source of truth for the next phases:

1. keep the canonical profile roots and requirement report current;
2. implement the next MO-used generic Ares capability, beginning with shared
   superweapon availability/grant state;
3. verify each capability with a synthetic fixture and local MO integration
   test;
4. validate skirmish, save/load, deterministic lockstep, LAN, and campaigns.

Proprietary RA2, Yuri's Revenge, and Mental Omega files are not committed to
this repository or bundled in public APKs. Local integration tests should be
run against user-owned installations.
