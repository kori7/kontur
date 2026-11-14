# AMS PCP 21031004 Reconstruction

This is a separate progressive-cavity pump assembly for the four documented AMS PCP60S12/3 objects. The official application chooses it from the equipment type; the centrifugal N-101 model remains an independent fixture.

Build and check from the repository root:

```powershell
node scripts/pump-model/build.mjs --ams-pcp
node scripts/ams-pcp-model/validate.mjs
npm run build
npx playwright test tests/e2e/ams-pcp-model.spec.ts
```

`create-pcp.js` constructs the GLB in meters. `manifest.json` records the supplied installation drawing 21031004 (manuals-017 page 6), assembly drawing Du100.01.00.SB (page 7), and its specification (page 8). The installation drawing gives 2530mm length, 340mm frame width and 759mm overall height, 296mm shaft height, and 2100mm x 300mm foundation centers. The rotor is diameter 74.6mm in the assembly specification. The passport instead gives 2742mm x 360mm x 605mm; both values are shown, and the model follows the drawing. Paint, rotor pitch/eccentricity and small undimensioned details are reconstructed; this is not manufacturer-supplied manufacturing CAD.

Separate component IDs match the catalog. The original installation and generic operating-manual specifications use different position numbers, so `drawingPosition` records the installation specification without overwriting the operating-manual catalog positions. The cabinet thermistor relay is not mounted on the model. A DN100 inlet, DN100 outlet and DTS Pt100 are present; a pressure gauge or centrifugal impeller is not invented.

Exterior markers use the 14 registry-approved anchor IDs. The cutaway and complete component list provide access to internal parts. Inspection effects read AMS measurements and findings; unset fields remain unknown. A generic missing/loose fastener highlights the candidate fasteners instead of fabricating the location of an unidentified bolt.

Open the actual passport object in the production application:

`http://127.0.0.1:8000/?equipment=pcp-21031004-1&screen=overview`
