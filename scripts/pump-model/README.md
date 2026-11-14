# Pump Model Pipeline

The original parametric model is exported as a self-contained GLB to `apps/web/public/models/pump-assembly.glb`. It has illustrative dimensions and does not reproduce a manufacturer-certified assembly. No cloud generation or secret keys are required

From the repository root:

```powershell
npm run model:textures
npm run model:build
npm run model:validate
npm run build
```

The texture generator requires Pillow. Geometry/material export uses Three.js, MikkTSpace and the existing Playwright Chromium installation. The export script starts and closes its own temporary local HTTP server. Rebuilding the asset requires no application server

The viewer and scenario adapter live under `apps/web/src/components/pump3d/`. They derive reversible visualization from current analysis observations, measurements and rule alerts. Ordinary temperature is displayed as labeled thermal coloring, not physical incandescence. Missing data does not acquire normal readings. Internal wear and coupling conditions use clearly labeled illustrative cutaways. Other catalog objects do not receive pump geometry

Run the UI regression suite against the application, or use `npm run test:model` for the pure state adapter. Do not run the Chromium and WebKit GPU tests concurrently
