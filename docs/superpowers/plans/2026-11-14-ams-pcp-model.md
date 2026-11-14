# AMS PCP Model Implementation Plan

**Goal:** Show the real AMS PCP drawing reconstruction in the official passport cards with correct components, materials, annotations and inspection effects.

**Architecture:** A per-equipment profile configures the existing lazy viewer and model controls. A dedicated geometry builder exports the self-contained GLB, and a pure documented-inspection state adapter drives its own effect controller.

**Tech Stack:** Three.js, React/TypeScript, Vite, Playwright, Khronos glTF Validator, supplied scanned PDF drawings.

Execute inline in the existing workspace. The user approved reconstruction of AMS PCP from the supplied drawings. The initial implementation stayed local; the user subsequently requested publication on a new branch. No subagents.

- [x] Add `tests/e2e/ams-pcp-model.spec.ts` for actual PCP model, exterior-only anchors, responsive rendering, documented input effects, and object URL restoration; run before implementation.
- [x] Add `scripts/ams-pcp-model/create-pcp.js`, `export.js` and `manifest.json`; reconstruct installation drawing 21031004 and Du100.01.00.SB with separate part IDs. Extend `scripts/pump-model/build.mjs --ams-pcp` to export `apps/web/public/models/ams-pcp-21031004.glb`.
- [x] Add `scripts/ams-pcp-model/validate.mjs`; check zero Khronos issues, meters, drawing dimensions, four foundation centers, rotor diameter, required parts, and absence of centrifugal/gauge geometry.
- [x] Add `apps/web/src/components/pump3d/profiles.ts`, `pcp-state.ts`, `pcp-effects.ts`; select the correct file and physical effects by equipment type.
- [x] Adapt `viewer.ts`, `annotations.ts`, and `PumpModel.tsx` to the profile; preserve existing N-101 behavior and support labeled PCP cutaway and all component dialogs.
- [x] Adapt `App.tsx` to render PCP profiles and preserve a validated `equipment` parameter in object selection/navigation/reload. Preserve factory passport values and separate histories.
- [x] Run Chromium PCP, catalog and N-101 suites, then the new PCP tests in WebKit sequentially. Run `npm run build` and `node scripts/ams-pcp-model/validate.mjs`.
- [x] Inspect the official PCP page on desktop and phone together, fix any defects in one batch, and confirm `http://127.0.0.1:8000/?equipment=pcp-21031004-1&screen=overview`.

The dimension conflict is documented in the design specification and model manifest. Do not replace passport dimensions with drawing dimensions or assert manufacturer CAD certification.

The first desktop/phone inspection exposed an ineffective transparency-based cutaway. A regression test failed before the fix. The viewer now clips the upper shells at the documented 296mm shaft axis, retains the whole rotor, clips shell shadows and ignores clipped surfaces when selecting a part. Closing the cutaway restores the assembly while preserving recorded missing-guard observations. Both cutaway unit tests pass.

## Final verification

- `npm run build`: exit 0; TypeScript and Vite pass. The lazy viewer chunk is approximately 681KB before gzip; Vite reports its size warning.
- `node scripts/ams-pcp-model/validate.mjs`: zero errors and warnings; drawing envelope 2.530m x 0.340m x 0.759m, four foundation centers, rotor nominal diameter and component provenance pass. GLB size: 8,196,204 bytes.
- `npx playwright test tests/e2e/catalog.spec.ts --max-failures=1`: 8 passed. Source assertions are scoped to the opened component dialog rather than a hidden provenance disclosure.
- `npx playwright test tests/e2e/ams-pcp-model.spec.ts tests/e2e/pump-3d.spec.ts --max-failures=1`: 16 passed after the section fix, including independent mobile navigation and all N-101 scenarios.
- `npx playwright test tests/e2e/ams-pcp-model.spec.ts -c playwright.webkit.config.ts --max-failures=1`: 6 passed after the section fix.
- `node --experimental-strip-types --test tests/unit/pcp-cutaway.test.ts`: 2 passed after the observed regression failure.
- `.cache/ams-pcp/capture.mjs`: production application at 393px and 1440px, no page errors and no horizontal overflow. One combined initial inspection and one confirmation; the rotor/shaft are visible in the final cutaway.

The user subsequently authorized publication on `codex/ams-pcp-3d`, based on the tested local revision `cec8cb6`. Remote `main` has an independent update `86decd7` with authorization and detector work; integrating that update is a separate task.
