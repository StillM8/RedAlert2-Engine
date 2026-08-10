# Ares compatibility matrix

This branch targets a standalone TypeScript RA2/YR runtime. Ares behavior is
implemented as normalized data and runtime traits; Antares is used as a
semantic reference, not as a dependency or a source of Windows hook code.

Primary references:

- [Ares documentation](https://ares-developers.github.io/Ares-docs/)
- [Ares common superweapon settings](https://ares-developers.github.io/Ares-docs/new/superweapons/general.html)
- [Ares UnitDelivery documentation](https://ares-developers.github.io/Ares-docs/new/superweapons/types/unitdelivery.html)
- [Antares Ares 3.0p1 reconstruction](https://github.com/Phobos-developers/Antares/tree/419626d)

“MO uses?” is intentionally conservative until a local target Mental Omega
installation is available for an effective-INI scan.

| Capability | MO uses? | Parser | Runtime | Tests | Antares/source reference | Verified semantics | Known differences |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Custom ArmorTypes and dynamic Verses | To be confirmed by target scan | yes | yes | `AresArmor.test.ts` | `src/Ext/Warhead/` and `src/Ext/Techno/` | Custom armor IDs, Versus multipliers, and targeting gates are data-driven. | Full MO asset/rules scan has not been run locally. |
| `ForceFire`, `Retaliate`, `PassiveAcquire` | To be confirmed by target scan | yes | yes | `AresArmor.test.ts` | Antares techno/warhead targeting extensions | Automatic acquisition, retaliation, and force-fire remain separate gates. | Antares-specific hook boundaries are represented by engine target-selection services. |
| Custom `Foundation.N` | To be confirmed by target scan | yes | yes | `AresFoundation.test.ts` | [Antares building extension](https://github.com/Phobos-developers/Antares/tree/419626d/src/Ext/Building) | Occupied cells are distinct from outline cells and are used by placement/occupation paths. | Visual and some legacy rectangular factory helpers still use coarse bounds where appropriate. |
| `FoundationOutline.N` | To be confirmed by target scan | yes | yes | `AresFoundation.test.ts` | Antares building placement extensions | Out-of-bounds outline cells are preserved for adjacency/rally-style consumers. | No claim that every Ares outline consumer is complete. |
| Ares `[#include]` graph | likely | yes | yes | `IniSourceLoader.test.ts`, scanner tests | Ares INI extension model | Recursive depth-first loading, ordering, cycles, missing files, duplicates, case-insensitive VFS resolution, and provenance are retained. | Exact target-MO include graph still needs a real install scan. |
| Dynamic sides | likely | yes | yes | `AresSides.test.ts`, scanner tests | Antares side extension data | Authored IDs/order and side-level metadata are retained without adding fixed enum values. | Some legacy simulation/UI adapters still expose vanilla `SideType`. |
| Dynamic countries | likely | yes | yes | `AresSides.test.ts`, `CountryIcon.test.ts` | Antares country/house extension data | Stable country IDs, side IDs, selectable flags, ordering, provenance, and presentation metadata are retained. | Full MO presentation/resource mapping awaits a real install scan. |
| Generic prerequisites | likely | yes | yes | `AresPrerequisites.test.ts` | Antares techno/building prerequisite extensions | Generic groups, alternatives, negatives, stolen tech, theater requirements, and factory-owner checks are normalized. | Permanent captured factory plans are not yet serialized through save/load. |
| `FactoryOwners`, `.Forbidden`, `.HasAllPlans`, `.Permanent` | To be confirmed by target scan | yes | partial | `AresPrerequisites.test.ts` | [Antares factory-owner extension](https://github.com/Phobos-developers/Antares/tree/419626d/src/Ext/Building) | Initial owner, active all-plans buildings, and runtime permanent plans are checked. | Permanent-plan save/load is still missing. |
| `GenericWarhead` | To be confirmed by target scan | yes | partial | `GenericWarheadEffect.test.ts`, `AresSuperWeapons.test.ts` | [Antares GenericWarhead](https://github.com/Phobos-developers/Antares/blob/419626d/src/Misc/SWTypes/GenericWarhead.cpp) | Configured damage/warhead and deterministic house/target filters reach the engine warhead detonation path. | Ares-specific attached effects, EMP, temporal, and other warhead interactions need separate capability work. |
| Ares superweapon target filters | To be confirmed by target scan | yes | yes for filter layer | `AresSuperWeaponFilters.test.ts` | [Antares target eligibility](https://github.com/Phobos-developers/Antares/blob/419626d/src/Ext/SWType/Body.cpp) | Land/water are an inclusive mask; `units` means vehicles/aircraft, not infantry; house relations follow Ares bitmask semantics. | Empty-cell delivery and every custom superweapon handler are not complete. |
| `UnitDelivery` | To be confirmed by target scan | yes | yes for core delivery | `AresUnitDelivery.test.ts`, `AresSuperWeapons.test.ts` | [Ares UnitDelivery docs](https://ares-developers.github.io/Ares-docs/new/superweapons/types/unitdelivery.html), [Antares UnitDelivery](https://github.com/Phobos-developers/Antares/blob/419626d/src/Misc/SWTypes/UnitDelivery.cpp) | Deferred placement, owner modes, infantry/vehicle/aircraft/building delivery, custom foundation cell counts, aircraft elevation, BaseNormal override, and cleanup are covered. | Buildup/audio/power/operated-state details, exact original facing, and broader AI delivery behavior need additional fixtures. |

## Status policy

Each feature should progress through three independent states:

1. Parsed — the effective rules can be understood and provenance retained.
2. Implemented — the standalone runtime has a generic semantic path.
3. Verified — synthetic or legal local-content fixtures prove the behavior.

The table is not a claim of complete Mental Omega compatibility. The next
authoritative step is to run the effective scanner against the selected local
Mental Omega installation and update “MO uses?” and the impact ranking from
actual occurrences.
