# Verification, handoff and trial feedback

Use after building or changing geometry. Match claims to evidence, and keep
evidence tied to the model revision, process and conditions it actually covers.

## Check in layers

| Layer               | Useful evidence                                                                                                        | Does not establish                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Script and geometry | Current validation report, finite dimensions/volume, geometry status                                                   | Fit, minimum wall thickness, printability or strength          |
| Functional features | Controlling parameters plus relevant geometric probes: sections, intersections, cut depth, component/cavity inspection | Every unmeasured feature or as-printed dimensions              |
| Appearance          | Inspected captures from useful views, compared to the brief                                                            | Precise clearances or hidden internal geometry                 |
| Print preparation   | Selected process, orientation, supports/cleaning plan, relevant actual slicer or service feedback                      | Successful fabrication or use safety                           |
| Physical trial      | Measured part/coupon, fit observations and known processing conditions                                                 | Untested revisions, different settings or unrelated load cases |

After validation, compare the actual geometry to the user's controlling dimensions,
not merely to arbitrary constants chosen in the code. Separate outer dimensions
from openings, hole spacing, wall/bottom thickness and mating interfaces.
Compare volume with a reasonable estimate when useful.

Interpret `genus` in the context of intended components, handles and cavities.
It is not a count of manufactured parts or a universal through-hole counter.
Use connectivity inspection such as `decompose()` where relevant, but distinguish
surface components from the intended physical parts and internal shells.
Do not union deliberately separate mating parts just to change a topology statistic.

For hidden structure, inspect a relevant section or use an explicit geometric
probe in the snippet. For example, test whether an expected void intersects
material, or whether a slab at the bottom contains the intended floor. Use
supported APIs and report failed assertions explicitly. A few probes establish
those local conditions, not a general minimum-wall analysis.

The current print-related feature-size hint depends on volume and triangle count.
It does not measure the smallest feature: changing tessellation alone can change
it. Neither its absence nor `ok: true` is a print-readiness certificate.
See [validation reports](validation-report.md).

## Publish and inspect a review version

Candidate comparisons and diagnostic runs can remain validation-only. For example,
compare the bbox and volume of 60, 70 and 80 mm bases using validation reports,
then publish only the chosen version if the user wants to see it. A numerical
comparison alone does not require a preview update or capture.

Execute only after resolving errors and reviewing relevant warnings and dimensions.
When publishing a version for review or delivery, capture and inspect at least one
relevant view. Capture renders the last executed model, not an unexecuted candidate.
Add another view or a local geometry check when the first cannot establish the
feature under review; avoid collecting redundant images.

Make a concrete comparison to intent, such as an open top, correct silhouette or
visible separation between parts. If capture or inspection is unavailable, say
which verification is incomplete rather than claiming a visually verified result.
Software capture is not proof of a successful host UI interaction.

Repeat validation for changed geometry. Before publishing a revision, recheck
the affected function and process assumptions. Earlier captures, slicer results
and physical trials cannot automatically validate a new revision.

## Report the actual delivery state

- **Concept:** key dimensions or process decisions remain provisional.
- **Geometry checked; slicing/trial pending:** specified geometric checks and
  captures are complete; identify manufacturing assumptions and remaining checks.
- **Trial evidence available:** describe what was measured or fitted, for which
  revision and printer/material/settings/post-processing conditions.

These are descriptions of evidence, not new tool report fields or a certification
ladder. Mark partial progress explicitly; do not claim every item at a level if
only one has been checked. Never replace missing evidence with "ready to print"
or "strength verified."

Keep the handoff proportional to the part:

- Provide recoverable source and named parameters. Report a saved script/export
  path only if the file was actually created; otherwise supply the source and
  the available export steps.
- State units, critical dimensions and the meaning of any fit allowance.
  Export 3MF for slicing with explicit millimeter units, or GLB for viewing and
  exchange using glTF's meter convention. Confirm physical size after import.
  Both are mesh outputs, not the parametric design; the exported 3MF is not a
  slicer project with printer profiles, plates or toolpaths.
- Identify intended build orientation relative to model axes, material assumptions,
  relevant supports/cleanup and any compensation already applied.
- State what was checked, what is unresolved, and the smallest useful next check.
  Triangle count is useful for complexity problems, not the main success summary.

Do not promise STEP/STL export, slicing, G-code, automatic support generation or strength
analysis through these tools. State manufacturing or use-safety limits when relevant,
not only as a generic disclaimer after claiming success.

## Close the loop with a representative trial

For uncertain fit, propose a small sample of the actual mating feature before a
full print. Keep relevant orientation, adjacent geometry, material and settings.
Ask for nominal and measured dimensions, the fit behavior and processing state.
If measurement is unavailable, record the observation as qualitative, not as an
invented correction in millimeters.

Distinguish causes: an interface design choice, local print deformation, finishing
or systematic process bias require different changes. Adjust the appropriate
parameter, preserve unrelated dimensions and check existing slicer compensation
before adding any in CAD. Repeat the affected checks after the change.

### Example: an organizer with a fitted lid

An unclear request first needs its contents/envelope and how the lid should work.
An established envelope does not determine sliding versus snap-fit behavior.
Once those decisions and the printing process are known, name the mating sizes
and per-side clearance, select an orientation and identify support/assembly access.
Verify the cavity, floor and lid interface rather than only the outer bbox.

If fit is uncertain, propose a short representative rim/lid sample. A report that
the lid is tight triggers measurement or a controlled local trial, not global
scaling of the whole organizer. Record the revised clearance and leave the confirmed
storage envelope unchanged. Do not claim success until the relevant evidence exists.
