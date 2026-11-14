import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePumpState } from "../../apps/web/src/components/pump3d/state.ts";
import type { Analysis } from "../../apps/web/src/types.ts";

const sample = (changes: Partial<Analysis> = {}): Analysis => ({
  equipment_id: "pump-101", scenario_id: "normal",
  telemetry: { baseline: { temperature: 60 }, samples: [{ at: "2026-11-14T00:00:00Z", temperature: 70, vibration: 4.5, outlet_pressure: 4.7 }] },
  observations: [], evaluation: { alerts: [] }, ...changes,
} as Analysis);

test("aggregate heat is labeled and linked to the affected component", () => {
  const state = derivePumpState(sample());
  assert.deepEqual(state.heatParts, ["bearing"]);
  assert.equal(state.temperature, 70);
  assert.ok(state.messages.some(message => message.includes("Тепловая подсветка")));
});

test("manual absence overrides a synthetic positive observation", () => {
  const state = derivePumpState(sample({ observations: [
    { kind: "liquid_leak", component_id: "seal", present: true, source: "demo", timestamp: "2026-11-14T00:00:00Z" },
    { kind: "liquid_leak", component_id: "seal", present: false, source: "manual", timestamp: "2026-11-14T00:00:01Z" },
  ] }));
  assert.equal(state.leak, false);
});

test("unknown measurements do not acquire a normal gauge reading", () => {
  const state = derivePumpState(sample({
    scenario_id: "missing_data",
    telemetry: { baseline: { temperature: 60 }, samples: [{ at: "2026-11-14T00:00:00Z", temperature: null, vibration: null, outlet_pressure: null }] } as Analysis["telemetry"],
  }));
  assert.equal(state.gaugePressure, null);
  assert.deepEqual(state.heatParts, []);
  assert.equal(state.unknown, true);
});

test("a new normal analysis clears every previously visible defect", () => {
  const faulty = derivePumpState(sample({ observations: [
    { kind: "guard_missing", component_id: "guard", present: true, source: "demo", timestamp: "2026-11-14T00:00:00Z" },
    { kind: "oil_low", component_id: "bearing", present: true, source: "demo", timestamp: "2026-11-14T00:00:00Z" },
  ] }));
  assert.equal(faulty.guardMissing, true);
  assert.equal(faulty.oilLow, true);
  const normal = derivePumpState(sample({ telemetry: { baseline: { temperature: 60 }, samples: [{ at: "2026-11-14T00:00:00Z", temperature: 60, vibration: 2, outlet_pressure: 4.7 }] } as Analysis["telemetry"] }));
  assert.equal(normal.guardMissing, false);
  assert.equal(normal.oilLow, false);
  assert.deepEqual(normal.heatParts, []);
});
