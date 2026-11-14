# AMS PCP Drawing Reconstruction

The user explicitly selected the real AMS PCP60S12/3 assembly from the supplied drawings for the official application. Build it in the current workspace without subagents. The initial implementation stayed local; the user subsequently requested publication on a new branch.

## Evidence and dimensions

`manuals-017.pdf` page 6 is installation drawing 21031004: overall length 2530mm, frame length 2350mm, frame width 340mm, overall DTS height 759mm, shaft center height 296mm, four foundation holes diameter 13mm on 2100mm by 300mm centers. Product inlet and outlet are DN100 flanges. Page 7 is assembly drawing Du100.01.00.SB, and page 8 is its 23-position specification. The rotor is diameter 74.6mm (position 7). The motor is BRA160M4, gearbox WXRF87-AM160-5.30-M1-flange300. The shaft, two universal joints and rotor are coaxially arranged inside the casing and elastomer stator.

`manuals-001.pdf` page 4 instead states 2742x360x605mm. Preserve those passport values in the catalog and explicitly expose the discrepancy in model provenance. Model shape follows the installation drawing; small undimensioned features are reconstructed from the scan and are not manufacturing tolerances. The model is a reconstruction, not a manufacturer-supplied CAD file.

## Model and interface

Produce a self-contained GLB with separate catalog component IDs, PBR cast-paint/steel/base maps, a hollow casing, HNBR stator with rotor, gearbox, motor, DN100 inlet and outlet, four tie rods, hatch, drain plug, guard and DTS probe. Use the existing brand colors and lighting. Preserve documented materials and physical arrangement. Do not add an unlisted pressure gauge or a centrifugal impeller.

The existing viewer will accept a model profile: file, exterior annotation nodes, provenance and effect controller. For AMS, exterior markers follow the registry's 14 permitted anchors; internal parts are available through an explicitly labeled cutaway and component controls, without exterior AR labels. The cabinet-mounted thermistor relay is accessible in the component list but is not fabricated on the assembly.

Use the model in the existing four PCP passport objects, retaining their separate inspection records. Add a shareable `equipment` URL parameter and keep it on section navigation and reload. Open the real assembly through the official API-served application. Retain the existing N-101 scenario fixture for its existing tests.

## Inspection state

AMS state reads documented `measurements` and `findings`, not the N-101 scenario adapter. DTS heat colors the stator/probe; PTC trip highlights the motor without fabricating a numeric temperature; seal surface temperature highlights seal housing only relative to measured product temperature. Confirmed leakage, missing guard/fasteners, corrosion and boot damage change the corresponding assembly parts. Absent measurements remain unknown. Applying an empty inspection resets all overlays.

## Verification

Failing tests first: selecting PCP renders its own model and 14 exterior markers; original geometry fits phone/tablet/desktop; URL/reload preserves the real object; actual documented inputs update and clear material/visibility effects. Validate GLB dimensions and component provenance with Khronos, run existing catalog and N-101 suites, build, and inspect desktop and phone in one visual batch with at most one confirmation.
