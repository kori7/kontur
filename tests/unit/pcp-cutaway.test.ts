import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createPcpEffects } from "../../apps/web/src/components/pump3d/pcp-effects.ts";
import type { PcpVisualState } from "../../apps/web/src/components/pump3d/pcp-state.ts";

const state: PcpVisualState = {
  heatParts: [], heat: 0, dtsTemperature: null, guardMissing: false,
  sealLeak: false, flangeLeak: false, fastenerWarning: false,
  corrosionParts: [], bootDamage: false, unknown: true, messages: [],
};

function fixture() {
  const model = new THREE.Group();
  const parts = new Map<string, THREE.Object3D>();
  for (const id of ["motor", "pump_casing", "stator", "seal_housing", "guard", "rotor", "connecting_shaft", "joint_boot", "joint_bush_outer"]) {
    const part = new THREE.Group();
    part.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    model.add(part);
    parts.set(id, part);
  }
  const effects = createPcpEffects(model, parts);
  const material = (id: string) => (parts.get(id)!.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  effects.apply(state, "");
  return { parts, effects, material };
}

test("PCP cutaway removes upper shells while retaining the lower section and whole rotor", () => {
  const { parts, effects, material } = fixture();
  effects.cutaway(true, "");
  for (const id of ["pump_casing", "stator", "seal_housing", "joint_boot", "joint_bush_outer"]) {
    const shell = material(id);
    assert.ok(shell.clippingPlanes?.length, `${id} must expose its interior rather than fade it`);
    assert.ok(shell.clippingPlanes[0].distanceToPoint(new THREE.Vector3(0, .4, 0)) < 0);
    assert.ok(shell.clippingPlanes[0].distanceToPoint(new THREE.Vector3(0, .2, 0)) > 0);
    assert.equal(shell.opacity, 1);
    assert.equal(shell.clipShadows, true);
  }
  for (const id of ["motor", "rotor", "connecting_shaft"]) {
    assert.equal(material(id).clippingPlanes?.length ?? 0, 0);
    assert.equal(material(id).opacity, 1);
  }
  assert.equal(parts.get("guard")!.visible, false);
  effects.dispose();
});

test("closing the section restores the assembly without clearing a recorded missing guard", () => {
  const { parts, effects, material } = fixture();
  effects.cutaway(true, "");
  effects.cutaway(false, "");
  assert.equal(material("stator").clippingPlanes?.length ?? 0, 0);
  assert.equal(parts.get("guard")!.visible, true);
  effects.apply({ ...state, guardMissing: true }, "");
  effects.cutaway(true, "");
  effects.cutaway(false, "");
  assert.equal(parts.get("guard")!.visible, false);
  effects.dispose();
});
