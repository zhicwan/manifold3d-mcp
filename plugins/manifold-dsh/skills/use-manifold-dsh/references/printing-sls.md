# Polymer SLS printing

Read only when polymer SLS is selected. Do not generalize this guidance to all
powder processes or metal additive manufacturing. These are design review prompts,
not automated checks in the modeling tools.

## Inputs that change the design

Establish the material and printer/service requirements, intended fits, hollow
regions, moving assemblies and available depowdering/finishing methods.
Confirm service-specific limits before treating them as design constraints.

## Review before detailing

| Concern                       | Check and possible response                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal cavities             | Trace how loose powder leaves each region. Openings need useful placement and access for the actual cleaning method, not just a nominal diameter.              |
| Channels and enclosed volumes | Consider bends, long narrow passages and unreachable surfaces. Split or open the geometry when powder removal cannot be established.                           |
| Walls and thermal behavior    | Review thin walls, long flat areas and abrupt section changes for process-specific distortion. Powder support does not eliminate thermal or strength concerns. |
| Moving parts and fits         | Establish clearances for both motion and removal of intervening powder. Do not assume that a geometrically separate assembly will print free-moving.           |
| Surface and finishing         | Consider the as-printed surface and any blasting, smoothing or coating needed. Evaluate fitted dimensions after the intended finishing process.                |

Powder surrounding a part often removes the need for the supports used in FDM,
but does not make every cavity, orientation or clearance practical.

## Preparation and trial handoff

State the proposed build assumptions, powder escape/cleaning access and critical
fits. Obtain printer/service review where needed. The modeling tools cannot
verify depowdering, thermal distortion, nesting or a production build strategy.

Use representative trials for uncertain fits and inaccessible geometry; record
material, process and finishing conditions with measured outcomes.
Follow [verification and handoff](verification-and-handoff.md).

## Further reading

- [Formlabs: Fuse series SLS design guide](https://formlabs.com/white-papers/fuse-series-sls-design-guide/)
- [Formlabs: Fuse 1 design specifications](https://formlabs.com/support/Design-specifications-for-3D-models-Fuse-1/)

Use the selected process's current requirements; these sources are not universal
minimum dimensions for every SLS machine or material.
