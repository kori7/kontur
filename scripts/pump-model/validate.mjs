import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const validator = require('gltf-validator');
const bytes = fs.readFileSync(path.join(root, 'apps/web/public/models/pump-assembly.glb'));
const result = await validator.validateBytes(new Uint8Array(bytes), { uri: 'pump-assembly.glb' });
const reportDirectory = path.join(root, '.cache/3d-integration');
fs.mkdirSync(reportDirectory, {recursive:true});
fs.writeFileSync(path.join(reportDirectory, 'gltf-validation.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ errors: result.issues.numErrors, warnings: result.issues.numWarnings, info: result.info }));
assert.equal(result.issues.numErrors, 0, 'GLB passes Khronos validation');
assert.equal(result.issues.numWarnings, 0, 'GLB has no validation warnings');
assert.ok(result.info.hasTextures, 'GLB contains actual surface textures');

const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
for (const id of ['motor','guard','bearing','seal','pump','gauge','base','inlet']) assert.ok(gltf.nodes.some(node => node.extras?.componentId===id), `Model contains the ${id} component`);
assert.ok(gltf.materials.filter(material => material.normalTexture && material.pbrMetallicRoughness?.metallicRoughnessTexture).length >= 4, 'Paint, base, guard and steel have PBR data maps');
const binaryOffset = 20 + jsonLength + 8;
function vectorAt(accessorId, index) {
  const accessor = gltf.accessors[accessorId];
  assert.equal(accessor.componentType, 5126, 'Geometry uses floating point accessors');
  const view = gltf.bufferViews[accessor.bufferView];
  const offset = binaryOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + index * (view.byteStride ?? 12);
  return [0, 4, 8].map(step => bytes.readFloatLE(offset + step));
}
const volute = gltf.nodes.find(node => node.name === 'spiral_volute_casting');
const primitive = gltf.meshes[volute.mesh].primitives[0];
const count = gltf.accessors[primitive.attributes.POSITION].count;
let outward = 0;
let inward = 0;
for (let index = 0; index < count; index++) {
  const point = vectorAt(primitive.attributes.POSITION, index);
  const normal = vectorAt(primitive.attributes.NORMAL, index);
  const dy = point[1] - 1.18;
  const dz = point[2];
  if (Math.hypot(dy, dz) < 0.53 || Math.abs(normal[0]) > 0.6) continue;
  if (dy * normal[1] + dz * normal[2] > 0) outward++;
  else inward++;
}
console.log(JSON.stringify({ voluteExteriorNormals: { outward, inward } }));
assert.ok(outward > 0 && outward / (outward + inward) > 0.95, 'Volute exterior faces point outward');
console.log('GLB validation: zero errors; volute exterior normals passed');
