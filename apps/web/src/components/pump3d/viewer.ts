import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createPumpEffects } from "./effects";
import { createPcpEffects } from "./pcp-effects";
import type { PcpVisualState } from "./pcp-state";
import type { ModelProfile } from "./profiles";
import { updateAnnotations } from "./annotations";
import type { PumpVisualState } from "./state";

export interface PumpController {
  state(value: PumpVisualState | PcpVisualState): void;
  cutaway(value: boolean): void;
  select(id: string): void;
  reset(): void;
  zoom(factor: number): void;
  dispose(): void;
}

function disposeScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

export async function mountPump(stage: HTMLElement, onSelect: (id: string) => void, signal: AbortSignal, profile: ModelProfile): Promise<PumpController> {
  // Fetch before allocating WebGL resources, so aborted mounts leave no contexts behind.
  const response = await fetch(profile.file, { signal });
  if (!response.ok) throw new Error("Не удалось загрузить файл 3D-модели");
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
  if (signal.aborted) { disposeScene(gltf.scene); throw new DOMException("Aborted", "AbortError"); }
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); }
  catch (error) { disposeScene(gltf.scene); throw error; }
  const canvas = renderer.domElement;
  canvas.className = "model-canvas"; canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "3D-модель насоса: вращение мышью, пальцем или стрелками");
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = profile.id === "ams-pcp";
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  stage.prepend(canvas);
  const scene = new THREE.Scene();
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = environmentTarget.texture; environment.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xE6F0FA, 0x607486, 1.35));
  const key = new THREE.DirectionalLight(0xFFF8EE, 2.3); key.position.set(-2, 4, 3); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -2.0; key.shadow.camera.right = key.shadow.camera.top = 2.0;
  key.shadow.camera.near = 0.1; key.shadow.camera.far = 10; key.shadow.bias = -0.0003; scene.add(key);
  const rim = new THREE.DirectionalLight(0xC3DFF5, 1.6); rim.position.set(3, 2, -3); scene.add(rim);
  const model = gltf.scene; scene.add(model);
  const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), new THREE.ShadowMaterial({ opacity: 0.30 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = bounds.min.y - 0.005; floor.receiveShadow = true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 40);
  const controls = new OrbitControls(camera, canvas); controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.14;
  controls.target.copy(center); controls.minDistance = 0.55; controls.maxDistance = 8; controls.minPolarAngle = 0.12; controls.maxPolarAngle = Math.PI - 0.12;
  controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.75;
  const parts = new Map<string, THREE.Object3D>();
  model.traverse(object => { if (object.userData.componentId) parts.set(object.userData.componentId, object); });
  const effects = profile.id === "ams-pcp" ? createPcpEffects(model,parts) : createPumpEffects(model, parts);
  const applyEffects = (state: PumpVisualState | PcpVisualState) => {
    if(profile.id === "ams-pcp") (effects as ReturnType<typeof createPcpEffects>).apply(state as PcpVisualState,selected);
    else (effects as ReturnType<typeof createPumpEffects>).apply(state as PumpVisualState,selected);
  };
  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const initialDirection = new THREE.Vector3(1.6, 1.18, 3.2).normalize();
  const corners: THREE.Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    corners.push(new THREE.Vector3(x, y, z).sub(center));
  }
  let selected = profile.initialPart, currentState: PumpVisualState | PcpVisualState | null = null, frame: number | null = null, disposed = false, visible = true, fittedDistance = 1;
  const fitDistance = (direction = initialDirection) => {
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.92;
    // Each corner has a different perspective depth in the oblique view.
    return Math.max(...corners.map(corner => corner.dot(direction) + Math.max(Math.abs(corner.dot(right)) / (tan * camera.aspect), Math.abs(corner.dot(up)) / tan)));
  };
  const render = (milliseconds: number) => {
    frame = null; if (disposed) return;
    const changed = controls.update();
    const animated = effects.animate(milliseconds / 1000, motionQuery.matches);
    renderer.render(scene, camera); updateAnnotations(stage, model, parts, camera, selected,profile.nodes);
    stage.dataset.azimuth = String(controls.getAzimuthalAngle()); stage.dataset.distance = String(camera.position.distanceTo(controls.target));
    if ((changed || animated) && visible && !document.hidden) requestRender();
  };
  const requestRender = () => { if (!disposed && frame === null) frame = requestAnimationFrame(render); };
  const reset = () => {
    const damping = controls.enableDamping; controls.enableDamping = false; controls.update();
    fittedDistance = fitDistance();
    camera.position.copy(center).addScaledVector(initialDirection, fittedDistance);
    controls.target.copy(center); controls.update(); controls.saveState(); controls.enableDamping = damping; requestRender();
  };
  const resize = () => {
    const width = stage.clientWidth, height = stage.clientHeight; if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    const offset = camera.position.clone().sub(controls.target);
    const nextFit = fitDistance(offset.lengthSq() ? offset.clone().normalize() : initialDirection);
    if (offset.length() > 0) camera.position.copy(controls.target).add(offset.multiplyScalar(nextFit / fittedDistance));
    fittedDistance = nextFit; controls.update(); requestRender();
  };
  resize(); reset();
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(stage);
  const visibilityObserver = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) requestRender(); }); visibilityObserver.observe(stage);
  const onMotion = () => { controls.enableDamping = !motionQuery.matches; if (currentState) applyEffects(currentState); requestRender(); };
  onMotion(); motionQuery.addEventListener("change", onMotion); document.addEventListener("visibilitychange", requestRender);
  controls.addEventListener("change", requestRender);
  const zoom = (factor: number) => {
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor).clampLength(controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset); controls.update(); requestRender();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Home") { event.preventDefault(); reset(); return; }
    if (["+", "=", "-", "_"].includes(event.key)) { event.preventDefault(); zoom(["+", "="].includes(event.key) ? 0.83 : 1.2); return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); const sphere = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    sphere.theta += event.key === "ArrowLeft" ? 0.12 : event.key === "ArrowRight" ? -0.12 : 0;
    sphere.phi = THREE.MathUtils.clamp(sphere.phi + (event.key === "ArrowUp" ? -0.10 : event.key === "ArrowDown" ? 0.10 : 0), 0.12, Math.PI - 0.12);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sphere)); controls.update(); requestRender();
  };
  let start: { x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => { start = { x: event.clientX, y: event.clientY }; };
  const onUp = (event: PointerEvent) => {
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) { start = null; return; }
    start = null; const rect = canvas.getBoundingClientRect(), raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    for (const hit of raycaster.intersectObject(model, true)) {
      if (hit.object instanceof THREE.Mesh) {
        const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face?.materialIndex ?? 0] : hit.object.material;
        if (material.clippingPlanes?.some((plane: THREE.Plane) => plane.distanceToPoint(hit.point) < 0)) continue;
      }
      let part: THREE.Object3D | null = hit.object, hidden = false;
      for (let ancestor: THREE.Object3D | null = part; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) hidden = true;
      while (part && !part.userData.componentId) part = part.parent;
      if (!hidden && part?.userData.componentId) { onSelect(part.userData.componentId); break; }
    }
  };
  canvas.addEventListener("keydown", onKey); canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointerup", onUp);
  const controller: PumpController = {
    state(value) { currentState = value; applyEffects(value); effects.reflect(canvas); renderer.shadowMap.needsUpdate = true; requestRender(); },
    select(id) { selected = id; if (currentState) { applyEffects(currentState); effects.reflect(canvas); } requestRender(); },
    cutaway(value) { if(profile.id === "ams-pcp") { (effects as ReturnType<typeof createPcpEffects>).cutaway(value,selected);effects.reflect(canvas);renderer.shadowMap.needsUpdate = true;requestRender(); } },
    reset, zoom,
    dispose() {
      if (disposed) return; disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect(); visibilityObserver.disconnect(); controls.dispose();
      motionQuery.removeEventListener("change", onMotion); document.removeEventListener("visibilitychange", requestRender);
      canvas.removeEventListener("keydown", onKey); canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp);
      effects.dispose(); disposeScene(scene); environmentTarget.dispose(); key.shadow.map?.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
  return controller;
}
