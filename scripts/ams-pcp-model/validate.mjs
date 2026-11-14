import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as THREE from 'three';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const bytes=fs.readFileSync(path.join(root,'apps/web/public/models/ams-pcp-21031004.glb'));
const result=await createRequire(import.meta.url)('gltf-validator').validateBytes(new Uint8Array(bytes),{uri:'ams-pcp-21031004.glb'});
fs.writeFileSync(path.join(root,'.cache/ams-pcp/gltf-validation.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({errors:result.issues.numErrors,warnings:result.issues.numWarnings,info:result.info}));
assert.equal(result.issues.numErrors,0);assert.equal(result.issues.numWarnings,0);assert.ok(result.info.hasTextures);
const length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.toString('utf8',20,20+length));
const all=new THREE.Box3(),nodeBounds=new Map();
const visit=(index,parent=new THREE.Matrix4())=>{
  const node=gltf.nodes[index];
  const local=node.matrix?new THREE.Matrix4().fromArray(node.matrix):new THREE.Matrix4().compose(new THREE.Vector3().fromArray(node.translation??[0,0,0]),new THREE.Quaternion().fromArray(node.rotation??[0,0,0,1]),new THREE.Vector3().fromArray(node.scale??[1,1,1]));
  const world=parent.clone().multiply(local);
  if(node.mesh!==undefined)for(const primitive of gltf.meshes[node.mesh].primitives){
    const accessor=gltf.accessors[primitive.attributes.POSITION];
    const box=new THREE.Box3(new THREE.Vector3().fromArray(accessor.min),new THREE.Vector3().fromArray(accessor.max)).applyMatrix4(world);
    all.union(box);nodeBounds.set(node.name,box);
  }
  for(const child of node.children??[])visit(child,world);
};
for(const node of gltf.scenes[gltf.scene??0].nodes)visit(node);
const size=all.getSize(new THREE.Vector3());
assert.ok(Math.abs(size.x-2.530)<.002,`Drawing length: ${size.x}m`);
assert.ok(Math.abs(size.z-.340)<.002,`Frame width: ${size.z}m`);
assert.ok(Math.abs(size.y-.759)<.002,`Drawing height: ${size.y}m`);
const foundation=gltf.nodes.filter(node=>node.extras?.foundationCenter).map(node=>node.extras.foundationCenter);
assert.equal(foundation.length,4);assert.ok(Math.abs(Math.max(...foundation.map(p=>p[0]))-Math.min(...foundation.map(p=>p[0]))-2.1)<1e-6);
assert.ok(Math.abs(Math.max(...foundation.map(p=>p[2]))-Math.min(...foundation.map(p=>p[2]))-.3)<1e-6);
for(const id of ['motor','gearbox','adapter','seal_housing','pump_casing','stator','rotor','connecting_shaft','discharge_flange','frame','dts_sensor','guard','stud','hatch_cover','joint_boot'])assert.ok(gltf.nodes.some(n=>n.extras?.componentId===id),`Contains ${id}`);
assert.equal(gltf.nodes.find(n=>n.name==='single_lobe_helical_rotor_d74_6').extras.nominalDiameterMm,74.6);
assert.ok(!gltf.nodes.some(n=>/gauge|impeller|volute/i.test(n.name??'')),'PCP contains no centrifugal impeller or fabricated pressure gauge');
const metadata=gltf.nodes.find(n=>n.name==='ams_pcp_21031004').extras;
assert.equal(metadata.manufacturer_supplied_cad,false);assert.ok(metadata.dimension_conflict);assert.equal(metadata.dimensional_basis,'manufacturer_drawing');
console.log(JSON.stringify({dimensionsMeters:size.toArray(),foundationCenters:foundation,bytes:bytes.length}));
console.log('AMS PCP: zero validation issues; drawing envelope, foundation centers and part provenance passed');
