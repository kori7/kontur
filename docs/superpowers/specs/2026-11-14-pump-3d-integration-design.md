# Pump 3D Integration Design

The user's approved direction is to integrate the existing rotating pump demonstrator into the official KONTUR interface, preserve the KST identity, correct responsive navigation and annotations, and visualize the existing demo scenarios. The initial implementation stayed local; the user subsequently requested publication on a new branch

## Interface

The pump map occupies the full content width immediately, with no expand button. It uses a dark engineering surface, a large responsive WebGL canvas, reset/zoom/annotation controls and clear model provenance. Its eight equally sized component selectors include the pump casing, motor, guard, bearing, seal, gauge, base and suction line. Desktop has four columns; phones have two, so every row is balanced

Annotation leaders connect actual projected 3D anchors to compact numbered markers. Markers and line endpoints move together on camera changes and resize, remain inside the canvas, and are hidden for out-of-view or occluded anchors. The selector grid remains available regardless of viewing angle. A component selection opens the existing component detail dialog

Demo scenarios are accessed through a visible control inside the model section, alongside the active scenario title. The employee profile remains in the header. Main navigation retains six distinct screens on desktop and in the phone bottom bar. The passport gets an explicit page title. Navigation updates the URL screen parameter and reads it on arrival and browser history, so links and reloads restore the chosen screen

## Geometry and materials

The original parametric GLB has coherent separate component groups. It receives reproducible seamless color, roughness and normal maps for cast paint, brushed steel and painted base metal, with restrained lighting, contact shadows and material contrast. Gauge readings are updated from current observations. The assembly includes an oil sight glass to illustrate the existing low-oil scenario

The model remains a demonstrator with illustrative dimensions. Other documented mechanisms keep their current component list, without receiving pump geometry

## Scenario state

A pure adapter derives the visual state from the current analysis observations, telemetry and alerts. Temperature becomes a labeled heat overlay on the affected bearing/seal component; it does not imply that ordinary 70-degree metal physically glows red. Liquid at the seal creates a visible trail and pooling. Missing guard hides its geometry; damaged guard changes its pose. Missing bolts remove the affected foundation fastener. Oil condition changes the sight glass. Contact damage marks the motor terminal box. Cavitation and imbalance use restrained vibration only in demo visualization and respect reduced motion. Internal wear remains an annotated condition rather than fabricated external breakage. Unknown readings are shown as unknown. Returning to normal resets every effect

## Verification

Regression tests cover distinct navigation screens and URL restoration, visible phone labels and demo control, full-width map without expansion, balanced selectors, canvas rendering and rotation, aligned anchors after resize, correct scenario effects and their reset. Existing UI and catalog tests cover readable text and documented equipment behavior. Build, Khronos GLB validation and desktop/phone screenshots are required before completion
