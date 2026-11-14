import * as THREE from "three";
import type { ModelNode } from "./profiles";

export function updateAnnotations(stage: HTMLElement, model: THREE.Object3D, parts: Map<string, THREE.Object3D>, camera: THREE.Camera, selected: string, nodes: readonly ModelNode[]) {
  const width = stage.clientWidth, height = stage.clientHeight;
  const svg = stage.querySelector("svg.model-guides");
  svg?.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const anchor = new THREE.Vector3();
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  const raycaster = new THREE.Raycaster();
  const occupied: { x: number; y: number }[] = [];
  const clamp = (value: number, limit: number) => Math.max(24, Math.min(limit - 24, value));
  for (const node of nodes) {
    const part = parts.get(node.id);
    const pin = stage.querySelector<HTMLButtonElement>(`.model-pin[data-node="${node.id}"]`);
    const guide = stage.querySelector<SVGGElement>(`[data-guide="${node.id}"]`);
    if (!part || !pin || !guide) continue;
    anchor.fromArray(part.userData.anchorLocal); part.localToWorld(anchor);
    const direction = anchor.clone().sub(cameraPosition);
    raycaster.set(cameraPosition, direction.clone().normalize()); raycaster.far = direction.length() + 0.01;
    const hit = raycaster.intersectObject(model, true).find(hit => {
      let object: THREE.Object3D | null = hit.object;
      for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return false;
      while (object && object !== model && !object.userData.componentId) object = object.parent;
      return object?.userData.componentId;
    });
    let hitPart: THREE.Object3D | null = hit?.object ?? null;
    while (hitPart && !hitPart.userData.componentId) hitPart = hitPart.parent;
    anchor.project(camera);
    const x = (anchor.x * 0.5 + 0.5) * width, y = (-anchor.y * 0.5 + 0.5) * height;
    const visible = part.visible && anchor.z > -1 && anchor.z < 1 && x >= 0 && x <= width && y >= 0 && y <= height && (!hitPart || hitPart.userData.componentId === node.id);
    pin.hidden = !visible; guide.style.display = visible ? "" : "none";
    if (!visible) continue;
    const scale = Math.min(1, width / 650);
    const preferred = { x: clamp(x + node.offset[0] * scale, width), y: clamp(y + node.offset[1] * Math.max(0.7, scale), height) };
    const candidates = [preferred];
    for (const radius of [44, 66, 88, 110]) for (let step = 0; step < 12; step++) {
      const angle = step * Math.PI / 6;
      candidates.push({ x: clamp(preferred.x + Math.cos(angle) * radius, width), y: clamp(preferred.y + Math.sin(angle) * radius, height) });
    }
    const point = candidates.find(candidate => occupied.every(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) >= 46)) ?? preferred;
    occupied.push(point);
    pin.style.left = `${point.x}px`; pin.style.top = `${point.y}px`;
    pin.dataset.anchorX = String(x); pin.dataset.anchorY = String(y);
    pin.setAttribute("aria-pressed", String(node.id === selected));
    guide.classList.toggle("selected", node.id === selected);
    guide.querySelector("path")?.setAttribute("d", `M${point.x} ${point.y}L${x} ${y}`);
    const circle = guide.querySelector("circle"); circle?.setAttribute("cx", String(x)); circle?.setAttribute("cy", String(y));
  }
}
