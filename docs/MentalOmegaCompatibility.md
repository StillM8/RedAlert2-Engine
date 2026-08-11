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
- The Ares scanner reports vanilla keys, known extension keys, and unknown
  extension keys separately.
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
duplicate loads. It contains 14,104 sections and 214,282 key entries. The
highest-impact identified Ares usage currently is:

| Capability | Occurrences | Source files | Sections/definitions | Runtime status |
| --- | ---: | ---: | ---: | --- |
| Custom ArmorTypes / `Versus.*` | 8,917 | 1 | 640 / 877 | implemented, target integration open |
| Custom foundations / outlines | 2,671 | 1 | 79 / 79 | implemented, target integration open |
| Custom superweapon fields/types | 552 | 1 | 141 / 141 | parser partial, runtime gaps remain |
| CustomPalette | 541 | 1 | 541 / 541 | implemented, render certification open |
| EMP fields | 432 | 1 | 392 / 392 | implemented, presentation/persistence gaps remain |
| Projectile extensions | 385 | 1 | 232 / 232 | not implemented |
| VehicleThief / CanDrive | 271 | 1 | 263 / 263 | core runtime implemented, integration gaps remain |

The scanner currently reports a broad unknown-key bucket because ordinary
Mental Omega keys are not all classified as vanilla or Ares yet. That bucket
is a diagnostic backlog, not a claim that every unknown entry is an Ares
mechanic. Development now follows the identified capability counts and
dependencies.

## Compatibility status

This is intentionally not a claim of complete runtime compatibility yet.
The scanner and feature registry are the source of truth for the next phases:

1. scan the target user's local MO INIs and generate a requirement report;
2. implement each required Ares capability as a normalized parser/runtime
   feature;
3. verify each feature with a synthetic fixture and local MO integration test;
4. validate skirmish, save/load, deterministic lockstep, LAN, and campaigns.

Proprietary RA2, Yuri's Revenge, and Mental Omega files are not committed to
this repository or bundled in public APKs. Local integration tests should be
run against user-owned installations.
