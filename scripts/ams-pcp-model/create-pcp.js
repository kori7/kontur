import * as THREE from 'three';
import { createMaterials } from '../pump-model/materials.js';
import { computeMikkTSpaceTangents, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as MikkTSpace from 'three/addons/libs/mikktspace.module.js';
import manifest from './manifest.json';

export async function createPcpModel() {
  const model = new THREE.Group(); model.name = 'ams_pcp_21031004';
  model.userData = { ...manifest, classification: 'Drawing-based visual reconstruction', componentCatalog: 'pcp_pump_unit' };
  const { paint, navy, steel, guardMetal, black, brass } = await createMaterials();
  const axis = .296, x = station => 1.265 - station;
  const parts = {}, cache = new Map();
  const definition = {
    motor:[1,[x(2.25),.435,.10]], gearbox:[2,[x(1.82),.390,.110]], adapter:[3,[x(1.59),.35,.11]],
    mechanical_seal:[4,[x(1.435),axis,0]], pump_casing:[5,[x(1.15),.31,.107]], discharge_flange:[6,[x(.015),axis,.10]],
    rotor:[7,[x(.51),axis,0]], connecting_shaft:[8,[x(1.17),axis,0]], seal_housing:[9,[x(1.45),axis,.105]],
    hatch_cover:[10,[x(1.08),.420,.04]], stator:[11,[x(.50),.310,.10]], stud:[12,[x(.70),.217,.087]],
    frame:[13,[x(1.2),.06,.17]], hollow_shaft:[14,[x(1.54),axis,0]], joint_bush_outer:[15,[x(.965),axis,0]],
    joint_pin:[16,[x(.965),axis,0]], joint_boot:[17,[x(.965),axis,.045]], boot_clamp_ring:[18,[x(.975),axis,0]],
    joint_retaining_ring:[19,[x(.965),axis,0]], joint_rubber_ring:[20,[x(.965),axis,0]], sealing_ring_14:[21,[x(1.41),axis,0]],
    drain_plug:[22,[x(1.08),.18,.045]], dts_sensor:[null,[x(.84),.719,.04]], guard:[null,[x(1.58),.355,.145]],
    sealing_ring_17:[null,[x(1.08),.415,0]]
  };
  for (const [id,[position,anchor]] of Object.entries(definition)) {
    const part = new THREE.Group(); part.name = `pcp_${id}`; part.userData = { componentId:id, anchorLocal:anchor, drawingPosition:position };
    model.add(part); parts[id] = part;
  }
  const mesh = (parent,name,geometry,material,position=[0,0,0],rotation=[0,0,0]) => {
    const item = new THREE.Mesh(geometry,material); item.name = name; item.position.set(...position); item.rotation.set(...rotation);
    item.castShadow = item.receiveShadow = true; parent.add(item); return item;
  };
  const geometry = (key,create) => { if(!cache.has(key))cache.set(key,create()); return cache.get(key); };
  const box = (part,name,size,position,material=paint) => mesh(part,name,geometry(`box:${size}`,()=>new THREE.BoxGeometry(...size)),material,position);
  const cylinder = (part,name,radius,length,position,material=steel,orientation='x',segments=40) => mesh(part,name,geometry(`cyl:${radius}:${length}:${segments}`,()=>new THREE.CylinderGeometry(radius,radius,length,segments)),material,position,orientation==='x'?[0,0,Math.PI/2]:orientation==='z'?[Math.PI/2,0,0]:[0,0,0]);
  const ring = (part,name,outer,inner,length,position,material=steel,orientation='x',holes=[]) => {
    const shape = new THREE.Shape(); shape.absarc(0,0,outer,0,Math.PI*2,false);
    for(const [a,b,r] of [[0,0,inner],...holes]) { const hole=new THREE.Path(); hole.absarc(a,b,r,0,Math.PI*2,true); shape.holes.push(hole); }
    const key=`ring:${outer}:${inner}:${length}:${JSON.stringify(holes)}`;
    return mesh(part,name,geometry(key,()=>{const g=new THREE.ExtrudeGeometry(shape,{depth:length,bevelEnabled:false,curveSegments:24});g.translate(0,0,-length/2);return g;}),material,position,orientation==='x'?[0,Math.PI/2,0]:orientation==='y'?[Math.PI/2,0,0]:[0,0,0]);
  };
  const bolt = (part,name,position,orientation='y',r=.008,length=.009) => {
    const group=new THREE.Group(); group.name=name; part.add(group);
    cylinder(group,`${name}_washer`,r*1.35,.003,position,steel,orientation,24);
    const offset=orientation==='x'?[length/2,0,0]:orientation==='z'?[0,0,length/2]:[0,length/2,0];
    cylinder(group,`${name}_hex`,r,length,position.map((p,i)=>p+offset[i]),steel,orientation,6);
    return group;
  };

  // Frame and foundation centers are dimensioned directly on installation sheet 6.
  for(const z of [-.145,.145])box(parts.frame,`frame_channel_${z}`,[2.35,.09,.05],[x(1.230),.045,z],navy);
  for(const station of [.180,1.0,1.63,2.28])box(parts.frame,`cross_member_${station}`,[.06,.05,.29],[x(station),.035,0],navy);
  for(const station of [.180,2.28])for(const z of [-.15,.15]) {
    const fastener=bolt(parts.frame,`foundation_${station}_${z}`,[x(station),.097,z]);
    fastener.userData = { foundationCenter:[x(station),0,z], holeDiameter:.013 };
  }
  for(const [station,width] of [[.15,.22],[1.45,.22],[1.73,.22],[1.87,.22],[2.16,.26],[2.35,.26]]) {
    box(parts.frame,`equipment_support_${station}`,[.11,.034,width],[x(station),.107,0],navy);
  }

  // BRA160M4 motor and WXRF87-AM160 gearbox form a separate reduction drive.
  cylinder(parts.motor,'bra160_cast_body',.145,.32,[x(2.245),axis,0],paint);
  cylinder(parts.motor,'bra160_fan_shroud',.154,.115,[x(2.4725),axis,0],navy);
  cylinder(parts.motor,'motor_front_cap',.155,.045,[x(2.0625),axis,0],paint);
  ring(parts.motor,'motor_b5_flange',.150,.065,.025,[x(2.03),axis,0],paint);
  for(let i=0;i<30;i++) {
    const angle=i*2*Math.PI/30;
    const rib=box(parts.motor,`motor_fin_${i}`,[.31,.018,.009],[x(2.24),axis+.145*Math.cos(angle),.145*Math.sin(angle)],paint);
    rib.rotation.x=angle;
  }
  for(const station of [2.16,2.35])for(const z of [-.095,.095]) {
    box(parts.motor,`motor_foot_${station}_${z}`,[.10,.08,.05],[x(station),.160,z],paint);
    bolt(parts.motor,`motor_mount_${station}_${z}`,[x(station),.127,z]);
  }
  box(parts.motor,'motor_terminal_base',[.155,.06,.12],[x(2.25),.467,0],paint);
  box(parts.motor,'motor_terminal_box',[.21,.088,.17],[x(2.25),.541,0],paint);
  box(parts.motor,'motor_terminal_lid',[.21,.006,.17],[x(2.25),.585,0],navy);
  for(const station of [2.17,2.33])for(const z of [-.064,.064])bolt(parts.motor,`terminal_lid_${station}_${z}`,[x(station),.580,z],'y',.004,.006);
  cylinder(parts.motor,'motor_cable_gland',.025,.045,[x(2.31),.529,.112],steel,'z',24);
  cylinder(parts.motor,'rear_fan_hub',.035,.012,[x(2.514),axis,0],black);
  for(let i=0;i<18;i++) {
    const a=i*Math.PI*2/18;
    box(parts.motor,`fan_vent_${i}`,[.006,.075,.009],[x(2.527),axis+.09*Math.cos(a),.09*Math.sin(a)],black).rotation.x=a;
  }
  box(parts.gearbox,'wxrf87_helical_gear_housing',[.20,.255,.235],[x(1.80),.2835,0],paint);
  cylinder(parts.gearbox,'gearbox_reducer_round_end',.132,.035,[x(1.67),axis,0],paint);
  mesh(parts.gearbox,'gearbox_motor_bell',new THREE.CylinderGeometry(.13,.10,.14,40),paint,[x(1.945),axis,0],[0,0,Math.PI/2]);
  ring(parts.gearbox,'gearbox_motor_flange',.150,.065,.024,[x(2.018),axis,0],paint);
  for(const station of [1.73,1.87])for(const z of [-.075,.075])box(parts.gearbox,`gearbox_mount_${station}_${z}`,[.07,.07,.05],[x(station),.158,z],paint);
  cylinder(parts.gearbox,'gearbox_fill_plug',.015,.015,[x(1.78),.419,0],steel,'y',6);
  cylinder(parts.gearbox,'gearbox_oil_drain',.014,.008,[x(1.79),.193,.124],steel,'z',6);
  for(let i=0;i<6;i++) {
    const a=i*Math.PI/3; bolt(parts.gearbox,`gearbox_end_bolt_${i}`,[x(1.65),axis+.105*Math.cos(a),.105*Math.sin(a)],'x');
  }

  // Open adapter, gland housing and single mechanical seal around the hollow shaft.
  for(const station of [1.44,1.665])ring(parts.adapter,`adapter_flange_${station}`,.141,.07,.016,[x(station),axis,0],paint);
  for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
    const bar=box(parts.adapter,`adapter_lantern_${angle}`,[.21,.038,.04],[x(1.55),axis+.112*Math.cos(angle),.112*Math.sin(angle)],paint);bar.rotation.x=angle;
  }
  for(const z of [-.067,.067])box(parts.adapter,`adapter_support_${z}`,[.105,.072,.035],[x(1.45),.16,z],paint);
  ring(parts.seal_housing,'seal_housing_casting',.112,.0325,.063,[x(1.43),axis,0],paint);
  ring(parts.mechanical_seal,'single_mechanical_seal_faces',.048,.0325,.016,[x(1.429),axis,0],steel);
  ring(parts.mechanical_seal,'seal_elastomer_seat',.052,.034,.026,[x(1.450),axis,0],black);
  ring(parts.hollow_shaft,'hollow_drive_shaft',.0325,.020,.195,[x(1.555),axis,0],steel);
  for(let i=0;i<8;i++) {const a=i*Math.PI/4;bolt(parts.seal_housing,`housing_stud_${i}`,[x(1.395),axis+.088*Math.cos(a),.088*Math.sin(a)],'x',.006,.009);}
  ring(parts.sealing_ring_14,'housing_o_ring',.0825,.08,.003,[x(1.40),axis,0],black);

  // Hollow inlet casing, DN100 inlet on top, hatch, and G3/4 drain underneath.
  ring(parts.pump_casing,'hollow_inlet_casing',.107,.099,.480,[x(1.18),axis,0],paint);
  ring(parts.pump_casing,'dn100_inlet_neck',.058,.050,.115,[x(1.304),.375,0],paint,'y');
  const flangeHoles=Array.from({length:8},(_,i)=>[.090*Math.cos(i*Math.PI/4),.090*Math.sin(i*Math.PI/4),.009]);
  ring(parts.pump_casing,'dn100_product_inlet_flange',.110,.050,.022,[x(1.304),.445,0],steel,'y',flangeHoles);
  box(parts.hatch_cover,'inspection_hatch_cover',[.145,.018,.116],[x(1.08),.412,0],steel);
  box(parts.sealing_ring_17,'hatch_gasket',[.14,.004,.11],[x(1.08),.401,0],black);
  for(const station of [1.02,1.14])for(const z of [-.042,.042])bolt(parts.hatch_cover,`hatch_bolt_${station}_${z}`,[x(station),.422,z],'y',.005,.006);
  cylinder(parts.drain_plug,'g3_4_drain_plug',.016,.025,[x(1.08),.177,0],steel,'y',6);

  // The rotor is a single helical circular lobe; the stator bore has two lobes.
  const start=.115, end=.940, rotorRadius=.0373, eccentricity=.013, turns=3;
  ring(parts.stator,'stator_outer_steel_jacket',.100,.091,end-start,[x((start+end)/2),axis,0],paint);
  const rows=96, segments=64, positions=[], indices=[];
  for(let row=0;row<=rows;row++) {
    const t=row/rows, phase=t*turns*Math.PI;
    for(let side=0;side<2;side++)for(let i=0;i<=segments;i++) {
      const a=i/segments*Math.PI*2;
      let y=.091*Math.cos(a),z=.091*Math.sin(a);
      if(side) {
        const u=rotorRadius*Math.cos(a)+eccentricity*Math.sign(Math.cos(a)),v=rotorRadius*Math.sin(a);
        y=u*Math.cos(phase)-v*Math.sin(phase);z=u*Math.sin(phase)+v*Math.cos(phase);
      }
      positions.push(x(start+(end-start)*t),axis+y,z);
    }
  }
  const stride=(segments+1)*2;
  for(let row=0;row<rows;row++)for(let side=0;side<2;side++)for(let i=0;i<segments;i++) {
    const a=row*stride+side*(segments+1)+i,b=a+stride;
    indices.push(...(side?[a,a+1,b,a+1,b+1,b]:[a,b,a+1,a+1,b,b+1]));
  }
  for(const row of [0,rows])for(let i=0;i<segments;i++) {
    const a=row*stride+i,b=a+segments+1;
    indices.push(...(row?[a,b,a+1,a+1,b,b+1]:[a,a+1,b,a+1,b+1,b]));
  }
  const rubberGeometry=new THREE.BufferGeometry();rubberGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));rubberGeometry.setIndex(indices);rubberGeometry.computeVertexNormals();
  black.side=THREE.DoubleSide;
  mesh(parts.stator,'hnbr_two_lobed_helical_stator',rubberGeometry,black);
  class RotorCenterline extends THREE.Curve {
    // The center stays on the rotating stator slot, with half its eccentricity.
    getPoint(t,target=new THREE.Vector3()) {const phase=t*turns*Math.PI*2;return target.set(x(start+(end-start)*t),axis+eccentricity/2*(1+Math.cos(phase)),eccentricity/2*Math.sin(phase));}
  }
  const rotor=mesh(parts.rotor,'single_lobe_helical_rotor_d74_6',new THREE.TubeGeometry(new RotorCenterline(),144,rotorRadius,24,false),steel);
  rotor.userData.nominalDiameterMm=74.6;
  cylinder(parts.connecting_shaft,'joint_to_joint_connecting_shaft',.024,.400,[x(1.18),axis,0],steel);
  cylinder(parts.rotor,'rotor_joint_drive_stub',.024,.055,[x(.9675),axis,0],steel);
  cylinder(parts.hollow_shaft,'hollow_shaft_joint_spigot',.0195,.100,[x(1.425),axis,0],steel);
  for(const station of [.975,1.385]) {
    const boot=mesh(parts.joint_boot,`joint_boot_${station}`,new THREE.CylinderGeometry(.046,.052,.075,32),black,[x(station),axis,0],[0,0,Math.PI/2]);
    boot.userData.damageVisual=true;
    cylinder(parts.joint_bush_outer,`universal_joint_outer_bush_${station}`,.046,.048,[x(station),axis,0],steel);
    cylinder(parts.joint_pin,`universal_joint_pin_d25_${station}`,.0125,.084,[x(station),axis,0],steel,'z');
    for(const shift of [-.032,.032])ring(parts.boot_clamp_ring,`boot_clamp_${station}_${shift}`,.054,.049,.006,[x(station+shift),axis,0],steel);
    ring(parts.joint_retaining_ring,`joint_retainer_${station}`,.042,.039,.004,[x(station),axis,0],steel);
    for(const shift of [-.009,.009])ring(parts.joint_rubber_ring,`joint_rubber_ring_${station}_${shift}`,.041,.038,.004,[x(station+shift),axis,0],black);
  }
  for(const station of [start-.009,end+.005])ring(parts.stator,`stator_end_plate_${station}`,.118,.052,.015,[x(station),axis,0],paint);
  for(let i=0;i<4;i++) {
    const a=Math.PI/4+i*Math.PI/2,y=axis+.123*Math.cos(a),z=.123*Math.sin(a);
    cylinder(parts.stud,`stator_tie_rod_${i}`,.006,.865,[x(.525),y,z],steel);
    for(const station of [.08,.955])bolt(parts.stud,`tie_rod_nut_${i}_${station}`,[x(station),y,z],'x',.009,.010);
  }
  ring(parts.discharge_flange,'dn100_discharge_conical_body',.108,.050,.080,[x(.06),axis,0],paint);
  ring(parts.discharge_flange,'dn100_discharge_flange',.110,.050,.020,[x(.01),axis,0],steel,'x',flangeHoles);
  for(const z of [-.08,.08])box(parts.discharge_flange,`pump_front_support_${z}`,[.055,.100,.035],[x(.15),.174,z],paint);

  // DTS is a Pt100 probe, not an analog pressure gauge.
  cylinder(parts.dts_sensor,'pt100_temperature_probe',.009,.100,[x(.84),.420,0],steel,'y');
  cylinder(parts.dts_sensor,'dts_process_connection',.022,.035,[x(.84),.408,0],brass,'y',6);
  cylinder(parts.dts_sensor,'dts_stem_extension',.011,.269,[x(.84),.5745,0],steel,'y');
  box(parts.dts_sensor,'dts_terminal_head',[.095,.09,.08],[x(.84),.714,0],navy);
  cylinder(parts.dts_sensor,'dts_cable_gland',.018,.030,[x(.84),.716,.055],steel,'z',24);
  for(const z of [-.140,.140]) {
    box(parts.guard,`guard_side_${z}`,[.21,.18,.006],[x(1.565),axis,z],guardMetal);
    for(let row=0;row<4;row++)for(let col=0;col<10;col++)cylinder(parts.guard,`guard_vent_${z}_${row}_${col}`,.004,.001,[x(1.465+col*.020),axis-.06+row*.04,z+Math.sign(z)*.004],black,'z',10);
  }
  box(parts.guard,'guard_top',[.21,.006,.280],[x(1.565),.387,0],guardMetal);
  for(const station of [1.47,1.66])for(const z of [-.13,.13])bolt(parts.guard,`guard_mount_${station}_${z}`,[x(station),.39,z],'y',.005,.005);

  model.updateMatrixWorld(true);
  for(const [id,part] of Object.entries(parts)) {
    const batches=new Map();
    part.traverse(object=>{
      if(!object.isMesh||Object.keys(object.userData).length)return;
      const key=`${object.material.uuid}:${Object.keys(object.geometry.attributes).sort()}`;
      if(!batches.has(key))batches.set(key,[]);batches.get(key).push(object);
    });
    for(const meshes of batches.values()) {
      if(meshes.length<2)continue;
      const combined=mergeGeometries(meshes.map(object=>{
        const g=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();g.applyMatrix4(object.matrixWorld);return g;
      }));
      mesh(part,`pcp_${id}_${meshes[0].material.name}`,combined,meshes[0].material);
      for(const object of meshes)object.removeFromParent();
    }
  }
  await MikkTSpace.ready;
  const tangentGeometries=new Map();
  model.traverse(object=>{
    if(!object.isMesh||!object.material.normalMap)return;
    const original=object.geometry;
    if(!tangentGeometries.has(original))tangentGeometries.set(original,computeMikkTSpaceTangents(original,MikkTSpace));
    object.geometry=tangentGeometries.get(original);
  });
  model.updateMatrixWorld(true);return model;
}
