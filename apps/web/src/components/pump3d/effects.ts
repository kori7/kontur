import * as THREE from "three";
import type { PumpVisualState } from "./state";

export function createPumpEffects(model: THREE.Object3D, parts: Map<string, THREE.Object3D>) {
  const assembly = model.getObjectByName("kontur_centrifugal_pump_demo") ?? model;
  const baselines = new Map<THREE.MeshStandardMaterial, { color: THREE.Color; emissive: THREE.Color; roughness: number; opacity: number; transparent: boolean }>();
  const originalMaterials = new Set<THREE.Material>();
  const transforms = new Map([...parts].map(([id, part]) => [id, { position: part.position.clone(), quaternion: part.quaternion.clone() }]));
  for (const part of parts.values()) {
    const replacements = new Map<THREE.Material, THREE.Material>();
    part.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const clone = (material: THREE.Material) => {
        originalMaterials.add(material);
        if (!replacements.has(material)) {
          const next = material.clone();
          replacements.set(material, next);
          if (next instanceof THREE.MeshStandardMaterial) baselines.set(next, { color: next.color.clone(), emissive: next.emissive.clone(), roughness: next.roughness, opacity: next.opacity, transparent: next.transparent });
        }
        return replacements.get(material)!;
      };
      object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
    });
  }
  const leak = new THREE.Group();
  leak.name = "seal_liquid_visualization";
  assembly.add(leak);
  const liquid = new THREE.MeshPhysicalMaterial({ color: 0x8FAFB8, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.76, clearcoat: 1 });
  const trail = new THREE.CatmullRomCurve3([new THREE.Vector3(1.47, 1.12, 0.19), new THREE.Vector3(1.47, 0.95, 0.26), new THREE.Vector3(1.47, 0.49, 0.28), new THREE.Vector3(1.47, 0.23, 0.5)]);
  leak.add(new THREE.Mesh(new THREE.TubeGeometry(trail, 24, 0.015, 8), liquid));
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.28, 48), liquid);
  pool.position.set(1.47, 0.212, 0.53); pool.rotation.x = -Math.PI / 2; pool.scale.set(1.35, 0.6, 1); leak.add(pool);
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.038, 16, 12), liquid);
  drop.position.set(1.47, 0.63, 0.28); drop.scale.y = 1.5; leak.add(drop);
  const gaugeNeedle = model.getObjectByName("gauge_live_needle");
  const oilMesh = model.getObjectByName("oil_sight_glass_readable") as THREE.Mesh;
  const oilMaterial = oilMesh.material as THREE.MeshStandardMaterial;
  const oilCanvas = document.createElement("canvas"); oilCanvas.width = oilCanvas.height = 256;
  const oilTexture = new THREE.CanvasTexture(oilCanvas); oilTexture.colorSpace = THREE.SRGBColorSpace;
  const originalOilTexture = oilMaterial.map;
  oilMaterial.map = oilTexture;
  const bolts: THREE.Object3D[] = [];
  model.traverse(object => { if (object.userData.visualRole === "removable_foundation_bolt") bolts.push(object); });
  const terminalLid = model.getObjectByName("terminal_box_lid");
  const terminalPose = terminalLid ? { position: terminalLid.position.clone(), quaternion: terminalLid.quaternion.clone() } : null;
  const contactMarks = new THREE.Group(); contactMarks.name = "contact_damage_visualization"; assembly.add(contactMarks);
  const scorched = new THREE.MeshStandardMaterial({ color: 0x211A17, roughness: 0.94 });
  for (const x of [-2.08, -1.90, -1.72]) {
    const mark = new THREE.Mesh(new THREE.CircleGeometry(0.053, 20), scorched);
    mark.position.set(x, 2.062, 0.02); mark.rotation.x = -Math.PI / 2; contactMarks.add(mark);
  }
  let current: PumpVisualState | null = null;
  const paintPart = (id: string, color: number, intensity: number, emissive = false) => parts.get(id)?.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || material.name.includes("dial") || material.name === "oil_sight_glass") continue;
      material.color.lerp(new THREE.Color(color), intensity);
      if (emissive) { material.emissive.setHex(color); material.emissiveIntensity = 0.07; }
    }
  });
  const restoreTransforms = () => {
    for (const [id, pose] of transforms) { parts.get(id)!.position.copy(pose.position); parts.get(id)!.quaternion.copy(pose.quaternion); }
  };
  return {
    apply(state: PumpVisualState, selected: string) {
      current = state; restoreTransforms();
      for (const [material, baseline] of baselines) {
        material.color.copy(baseline.color); material.emissive.copy(baseline.emissive); material.emissiveIntensity = 1;
        material.roughness = baseline.roughness; material.opacity = baseline.opacity; material.transparent = baseline.transparent; material.depthWrite = true;
      }
      parts.get("guard")!.visible = !state.guardMissing;
      if (state.guardDamaged && !state.guardMissing) { parts.get("guard")!.position.set(0.11, 0.03, 0.10); parts.get("guard")!.rotation.z = 0.11; }
      for (const bolt of bolts) bolt.visible = !state.missingBolt;
      leak.visible = state.leak; contactMarks.visible = state.contactDamage;
      if (terminalLid && terminalPose) {
        terminalLid.position.copy(terminalPose.position); terminalLid.quaternion.copy(terminalPose.quaternion);
        if (state.contactDamage) { terminalLid.position.y += 0.21; terminalLid.position.x -= 0.12; terminalLid.rotation.z = -0.35; }
      }
      for (const id of state.heatParts) paintPart(id, 0xD54A32, 0.30 + state.heat * 0.62, true);
      if (state.cavitation) paintPart("inlet", 0xD89840, 0.38);
      if (state.misalignment) {
        paintPart("coupling", 0xD89840, 0.7);
        parts.get("guard")?.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.transparent = true; material.opacity = 0.22; material.depthWrite = false; }
        });
      }
      if (state.serviceDue) paintPart("pump", 0xD89840, 0.33);
      if (state.impellerWear) {
        paintPart("impeller", 0x9B7851, 0.65);
        parts.get("pump")?.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.transparent = true; material.opacity = 0.2; material.depthWrite = false; }
        });
      }
      if (selected && !state.heatParts.includes(selected)) paintPart(selected, 0x63B8F1, 0.055);
      if (gaugeNeedle) {
        gaugeNeedle.visible = state.gaugePressure !== null;
        gaugeNeedle.rotation.z = THREE.MathUtils.degToRad(135 - THREE.MathUtils.clamp(state.gaugePressure ?? 0, 0, 10) * 27);
        gaugeNeedle.userData.reading = state.gaugePressure;
      }
      const context = oilCanvas.getContext("2d")!;
      context.fillStyle = "#DCE5E8"; context.fillRect(0, 0, 256, 256);
      if (!state.unknown) {
        const level = state.oilLow ? 0.20 : 0.65;
        context.fillStyle = state.oilDegraded ? "#A39A75" : "#96733B";
        context.fillRect(0, 256 * (1 - level), 256, 256 * level);
      }
      context.strokeStyle = "#172C40"; context.lineWidth = 4; context.beginPath(); context.moveTo(24, 180); context.lineTo(76, 180); context.stroke();
      context.font = "500 27px Geologica, Arial"; context.fillStyle = "#172C40"; context.fillText("MIN", 84, 191);
      oilTexture.needsUpdate = true; oilMesh.userData.low = state.oilLow;
    },
    animate(time: number, reducedMotion: boolean) {
      if (!current) return false;
      if (reducedMotion) return false;
      const frequency = current.cavitation ? 15 : 9;
      const ids = current.baseVibration ? ["base", "motor", "pump", "bearing"] : current.misalignment ? ["coupling", "guard"] : current.cavitation ? ["pump", "inlet"] : [];
      for (const id of ids) {
        const part = parts.get(id); if (!part) continue;
        part.position.y = transforms.get(id)!.position.y + Math.sin(time * frequency) * 0.007;
      }
      if (current.leak) drop.position.y = 1.02 - (time * 0.35 % 0.72);
      return ids.length > 0 || current.leak;
    },
    reflect(canvas: HTMLCanvasElement) {
      canvas.dataset.guardVisible = String(parts.get("guard")!.visible);
      canvas.dataset.leakVisible = String(leak.visible);
      canvas.dataset.missingBolt = String(bolts.length > 0 && bolts.every(bolt => !bolt.visible));
      canvas.dataset.oilLow = String(oilMesh.userData.low ?? false);
      canvas.dataset.gaugeReading = String(gaugeNeedle?.userData.reading ?? "unknown");
      canvas.dataset.contactsVisible = String(contactMarks.visible);
      const partMaterial = (id: string) => {
        let result: THREE.MeshStandardMaterial | undefined;
        parts.get(id)?.traverse(object => { if (!result && object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) result = object.material; });
        return result;
      };
      canvas.dataset.inletColor = partMaterial("inlet")?.color.getHexString() ?? "";
      canvas.dataset.pumpColor = partMaterial("pump")?.color.getHexString() ?? "";
      canvas.dataset.pumpOpacity = String(partMaterial("pump")?.opacity);
      canvas.dataset.guardOpacity = String(partMaterial("guard")?.opacity);
      canvas.dataset.heatParts = [...parts].filter(([, part]) => {
        let heated = false;
        part.traverse(object => { if (object instanceof THREE.Mesh && !Array.isArray(object.material) && object.material instanceof THREE.MeshStandardMaterial && object.material.emissive.r > 0 && object.material.emissive.r > object.material.emissive.g * 2) heated = true; });
        return heated;
      }).map(([id]) => id).join(",");
    },
    dispose() {
      originalOilTexture?.dispose();
      for (const material of originalMaterials) material.dispose();
    },
  };
}
