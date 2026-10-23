# Filament printing: FDM / FFF

Read when filament printing is selected, especially for functional, fitted or
support-sensitive parts. These are design review prompts, not automated checks
performed by the modeling tools.

## Inputs that change the design

Reuse known facts. Ask only for a missing fact that changes the proposal: material,
printer/build envelope, nozzle and intended extrusion width, fit/use conditions,
important visible surfaces, load direction, or available support and finishing
options. A nozzle diameter alone does not specify dimensional accuracy.

## Review before detailing

| Concern                         | Check and possible response                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orientation and strength        | Compare the main load direction with layer orientation. Reducing supports may worsen layer separation or important surfaces. Do not claim strength without appropriate evidence.                                        |
| Overhangs and bridges           | Identify where each new layer is supported and what spans must bridge. Base acceptable spans/angles on the actual process, not a universal cutoff. Consider a changed orientation, chamfer, split or reachable support. |
| Support removal                 | Check access for removing support, including internal passages. A support that can be generated but cannot be removed is not a solved design. Protect fit and cosmetic surfaces from support scars.                     |
| Walls and fine features         | Relate walls, ribs, text and gaps to extrusion width and the intended perimeter strategy. Layer height is not an XY feature-size guarantee. Inspect the sliced result for omitted walls, gaps or merged features.       |
| First layer and warping         | Consider bed contact, long thin areas, sharp footprint corners, shrinkage and first-layer expansion. Keep fit edges away from problematic contact or plan a suitable relief/compensation.                               |
| Holes and fits                  | Establish insertion direction and desired sliding, locating, friction or snap behavior. Hole orientation and material matter. A nominal diameter does not guarantee the printed opening; plan a local fit trial.        |
| Fasteners and flexible features | Use actual hardware dimensions, adequate surrounding material and assembly/tool access. Printed threads, inserts and snap features need process/material-specific trials.                                               |
| Finish and cleanup              | Identify visible/touch surfaces, seam placement and accessible sanding/deburring. Account for how finishing changes a fitted surface.                                                                                   |

For an enclosure, compare an open-top print with a split body rather than assuming
an enclosed roof is harmless. A downward-facing rounded edge can create a worse
overhang than a chamfer. Ribs or a different section may be preferable to thickening
the entire part, but should not be presented as a quantified strength improvement
without analysis or test evidence.

## Slicer and trial handoff

Document the intended build direction relative to the model axes. A camera view
or Viewer/XR placement is not a manufacturing orientation change.

Have the user inspect the relevant layer paths: perimeter continuity, thin-feature
survival, bridges, support interfaces, infill around functional regions and seams.
Do not claim these paths were checked without an actual slicer result. The modeling
tools do not generate supports, toolpaths or G-code.

Use small representative coupons for uncertain fits. Keep the mating feature's
orientation, nearby wall geometry, material and slicer settings representative.
Record nominal and measured sizes, printer/material/settings and model revision;
do not treat one successful coupon as proof for every feature or load case.
Check whether compensation is already active in the slicer before adding it in CAD.

When machine-specific evidence is missing, present any suggested setting or
clearance as a starting hypothesis and name the check needed to accept it.
Follow [verification and handoff](verification-and-handoff.md).

## Further reading

- [Prusa: Modeling with 3D printing in mind](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135)
- [Prusa: Elephant foot compensation](https://help.prusa3d.com/article/elephant-foot-compensation_114487)

Manufacturer examples apply to their stated equipment, material and settings;
do not turn their numbers into global skill thresholds.
