# Resin printing: SLA / MSLA

Read when resin printing is selected. Do not transfer filament-printing wall,
support or fit assumptions unchanged. These are design review prompts, not
automatic checks in the modeling tools.

## Inputs that change the design

Establish the printer/process and resin when they matter, whether the part is
solid or hollow, the important surfaces and fits, and available washing/support
removal/post-curing procedures. Use the manufacturer's material and handling
guidance; a visually successful print is not evidence of use safety.

## Review before detailing

| Concern                  | Check and possible response                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orientation and support  | Consider islands, overhangs, support attachment marks and cross-section changes through the build. Keep support contacts off critical mating or cosmetic surfaces when practical. |
| Hollow regions           | Identify every cavity and its connections. Consider drainage, venting and the actual build orientation; adding a hole at an arbitrary location is not sufficient.                 |
| Cup-shaped regions       | Consider trapped volumes and pressure/peel effects during the build, not just whether the finished part has an opening. Reorient, open a flow path or split when appropriate.     |
| Cleaning and curing      | Check access for removing uncured resin and washing liquid and for the required post-cure. An inaccessible internal support or residue is not solved by a valid closed mesh.      |
| Walls and small features | Distinguish supported and unsupported walls, small holes, engraved details and fragile features. Use the selected resin/printer's evidence rather than a universal minimum.       |
| Fits and post-processing | Account for support removal, washing and post-cure effects on final dimensions. Test fit in the final processed condition, not only immediately after printing.                   |

Do not hollow a part just to save material if the resulting cavities cannot be
drained, cleaned and processed appropriately. Ask about splitting or keeping it
solid instead. State the corresponding material, finish and processing tradeoff.

## Slicer and trial handoff

Specify proposed orientation and drain/vent paths. Request layer inspection for
islands, cups and supported features, plus confirmation that internal cleanup is
possible. These tools do not simulate peel forces or verify drainage.

Use an appropriate local feature trial when fits or fragile details are uncertain.
Record resin, orientation, relevant settings and post-processing condition with
the measurements. Follow [verification and handoff](verification-and-handoff.md).

## Further reading

- [Formlabs: Form 3 design guide and its test conditions](https://formlabs.com/blog/design-guide-form3/)

That guide's numerical results are specific to the described printer, resin and
resolution, not universal values for SLA or MSLA equipment.
