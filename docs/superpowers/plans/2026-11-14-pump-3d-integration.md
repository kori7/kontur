# Pump 3D Integration Implementation Plan

**Goal:** Integrate the interactive pump into the official interface with usable navigation, responsive annotations, distinct materials and existing scenario effects

**Architecture:** A lazy React component owns the viewer lifecycle. A Three.js controller owns camera, rendering, raycasting and projected anchors. A pure analysis adapter owns scenario state. Original geometry and deterministic texture generation are reproducible under `scripts/`; the self-contained GLB is served from `apps/web/public/models/`

**Tech Stack:** React 19, TypeScript, Vite, Three.js, Python/Pillow texture generation, Playwright and Khronos glTF Validator

Execute inline in the existing workspace to preserve the user's current local edits. The initial implementation stayed local; the user subsequently requested publication on a new branch

## Steps

- [x] Add `tests/e2e/pump-3d.spec.ts` for full-width layout, navigation, mobile demo access, balanced selectors, anchor bounds and scenario resets; run it before implementation and record the failure
- [x] Correct `apps/web/src/App.tsx` screen initialization/history, passport heading and link behavior; preserve existing dialogs and catalog selection
- [x] Add `scripts/pump-model/` with original geometry, deterministic material textures and an isolated browser GLB build; validate the asset and exterior normals
- [x] Add `apps/web/src/components/pump3d/state.ts` mapping real analysis fields to reversible visualization states; verify representative scenario data
- [x] Add `apps/web/src/components/pump3d/viewer.ts` with independent rendering, lighting, resize, projected markers, disposal and live effects
- [x] Add `apps/web/src/components/PumpModel.tsx` with lazy viewer loading, eight balanced selectors, clear loading/fallback and accessible controls
- [x] Integrate the model only for the demo pump and apply `apps/web/src/pump-model.css`; retain documented mechanisms as lists
- [x] Fix initial camera framing using perspective depth of the eight bounding-box corners; verify actual rendered pixel margins at 320, 393, 834 and 1440px
- [x] Run the new UI tests, existing UI/catalog/inspection tests, TypeScript build and GLB validation; inspect desktop and phone together, correct one batch and confirm
- [x] Rebuild the production bundle served by the API and request a browser panel for the official application; provide results without Git publication

Verification commands:

```powershell
npx playwright test tests/e2e/pump-3d.spec.ts
npm run build
npx playwright test
npx playwright test tests/e2e/pump-3d.spec.ts -c playwright.webkit.config.ts
node "scripts/pump-model/validate.mjs"
```

## Verification record

- Production TypeScript/Vite build passed; Three.js is loaded separately through the lazy viewer chunk
- GLB validation: 0 errors, 0 warnings; 69,307 triangles, 79 draw calls, 12,579,356 bytes
- Pure scenario adapter: 4 tests passed
- Original Chromium suite: 49 passed; two ambiguous toast selectors failed and were corrected; the inspection suite then passed all 4 tests
- Initial WebKit suite: 39 tests passed, including all 12 scenarios
- Framing regression initially failed at 1440px with actual pump pixels clipped at the right and bottom edges. Camera fitting now accounts for view angle and perspective depth. The screenshot check ignores 3px of neighboring CSS border caused by fractional DOM bounds
- Updated Chromium 3D suite: 10 tests passed
- Updated WebKit 3D suite: 10 tests passed
- Desktop, tablet and phone inspected in the production application; full camera framing confirmed by the rendered-pixel regression
- `git diff --check` passed; the initial implementation stayed local. The user subsequently authorized publication together with the AMS PCP reconstruction on `codex/ams-pcp-3d`
- The official application browser panel was queued for this thread at `http://127.0.0.1:8000/?screen=overview&design=3d`
