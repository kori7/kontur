import * as THREE from 'three';

export async function createMaterials() {
  const loader = new THREE.TextureLoader();
  const profiles = await Promise.all(['cast', 'brushed', 'base'].map(async profile => {
    const [map, roughnessMap, normalMap] = await Promise.all(['color', 'roughness', 'normal'].map(channel => loader.loadAsync(`/textures/${profile}-${channel}.png`)));
    map.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [map, roughnessMap, normalMap]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2, 2);
    }
    return { map, roughnessMap, normalMap };
  }));
  return {
    paint: new THREE.MeshStandardMaterial({ name: 'kst_blue_cast_metal', color: 0x135AA6, metalness: 0.12, roughness: 0.90, normalScale: new THREE.Vector2(0.55, 0.55), ...profiles[0] }),
    navy: new THREE.MeshStandardMaterial({ name: 'navy_base_steel', color: 0x273B4C, metalness: 0.58, roughness: 0.64, normalScale: new THREE.Vector2(0.16, 0.16), ...profiles[2] }),
    steel: new THREE.MeshStandardMaterial({ name: 'machined_steel', color: 0xCED3D7, metalness: 0.92, roughness: 0.30, normalScale: new THREE.Vector2(0.15, 0.15), ...profiles[1] }),
    guardMetal: new THREE.MeshStandardMaterial({ name: 'perforated_guard_steel', color: 0x9AA8B2, metalness: 0.88, roughness: 0.47, side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.12, 0.12), ...profiles[1] }),
    black: new THREE.MeshStandardMaterial({ name: 'rubber_and_dark_recesses', color: 0x111A24, roughness: 0.92, metalness: 0 }),
    brass: new THREE.MeshStandardMaterial({ name: 'instrument_brass', color: 0xAD9265, metalness: 0.82, roughness: 0.40 }),
  };
}
