import * as THREE from 'three';
import { createMaterials } from './materials.js';
import { computeMikkTSpaceTangents } from 'three/addons/utils/BufferGeometryUtils.js';
import * as MikkTSpace from 'three/addons/libs/mikktspace.module.js';

export async function createPumpModel() {
  const model = new THREE.Group();
  model.name = 'kontur_centrifugal_pump_demo';
  model.scale.setScalar(.3);
  model.userData = {
    classification: 'Parametric mechanical demonstrator, not manufacturer-certified CAD',
    units: 'meters after root scale',
    configuration: 'Horizontal end-suction centrifugal pump, coaxial separate motor and guarded coupling',
    illustrativeDimensions: true,
    pressureGaugeConnection: 'Discharge neck pressure tapping',
    gaugeValue: 4.7,
    gaugeUnit: 'bar',
  };
  const { paint, navy, steel, guardMetal, black, brass } = await createMaterials();
  const axisY = 1.18;
  const components = {};
  const anchors = {
    motor:[-1.90,1.48,.36],guard:[-.08,1.43,.38],bearing:[1.00,1.35,.18],
    seal:[1.43,1.19,.17],base:[-.7,.19,.75],gauge:[1.74,2.66,.75],inlet:[2.78,1.18,.19],
    pump:[1.72,1.18,.48],coupling:[-.05,axisY,0],impeller:[1.76,axisY,0],
  };
  for (const [id,anchor] of Object.entries(anchors)) {
    const group = new THREE.Group();
    group.name = `component_${id}`;
    group.userData = {componentId:id,anchorLocal:anchor};
    components[id] = group;
    model.add(group);
  }
  const mesh = (parent,name,geometry,material,position=[0,0,0],rotation=[0,0,0]) => {
    const item = new THREE.Mesh(geometry,material);
    item.name = name;
    if(name.startsWith('foundation_bolt_-3.16_-0.61'))item.userData.visualRole='removable_foundation_bolt';
    item.position.set(...position);
    item.rotation.set(...rotation);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  };
  const geometryCache = new Map();
  const geometryFor = (key,create) => {
    if(!geometryCache.has(key))geometryCache.set(key,create());
    return geometryCache.get(key);
  };
  const box = (parent,name,size,position,material=paint,rotation=[0,0,0]) => mesh(parent,name,geometryFor(`box:${size.join(',')}`,()=>{
    const [width,height,depth]=size;
    const bevel=Math.min(.015,...size.map(value=>value*.12));
    const x=width/2-bevel,y=height/2-bevel;
    const shape=new THREE.Shape();shape.moveTo(-x,-y);shape.lineTo(x,-y);shape.lineTo(x,y);shape.lineTo(-x,y);shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:depth-2*bevel,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,steps:1});
    geometry.translate(0,0,-depth/2+bevel);
    return geometry;
  }),material,position,rotation);
  const cylinder = (parent,name,radius,length,position,material=steel,axis='x',segments=48) => mesh(parent,name,geometryFor(`cylinder:${radius}:${length}:${segments}`,()=>new THREE.CylinderGeometry(radius,radius,length,segments)),material,position,axis==='x'?[0,0,Math.PI/2]:axis==='z'?[Math.PI/2,0,0]:[0,0,0]);
  const ring = (parent,name,outer,inner,length,position,material=steel,axis='x',holes=[]) => {
    const key=`ring:${outer}:${inner}:${length}:${JSON.stringify(holes)}`;
    const geometry=geometryFor(key,()=>{
    const shape = new THREE.Shape();
    shape.absarc(0,0,outer,0,Math.PI*2,false);
    const bore = new THREE.Path();
    bore.absarc(0,0,inner,0,Math.PI*2,true);
    shape.holes.push(bore);
    for (const [x,y,radius] of holes) {
      const hole = new THREE.Path();hole.absarc(x,y,radius,0,Math.PI*2,true);shape.holes.push(hole);
    }
    const result = new THREE.ExtrudeGeometry(shape,{depth:length,steps:1,bevelEnabled:false,curveSegments:48});
    result.translate(0,0,-length/2);
    return result;
    });
    return mesh(parent,name,geometry,material,position,axis==='x'?[0,Math.PI/2,0]:axis==='y'?[Math.PI/2,0,0]:[0,0,0]);
  };
  const bolt = (parent,name,position,axis='y',radius=.042,length=.045) => {
    const offset = axis==='x'?[length*.5,0,0]:axis==='z'?[0,0,length*.5]:[0,length*.5,0];
    const head = position.map((v,i)=>v+offset[i]);
    cylinder(parent,`${name}_washer`,radius*1.35,.014,position,steel,axis,24);
    cylinder(parent,`${name}_hex_head`,radius,length,head,steel,axis,6);
  };

  // The common rigid frame carries both motor and pump feet.
  box(components.base,'common_base_top',[6.65,.13,1.7],[-.10,.14,0],navy);
  for (const z of [-.77,.77]) box(components.base,`base_channel_${z}`,[6.65,.23,.12],[-.10,.03,z],navy);
  for (const x of [-3.16,2.96]) {
    box(components.base,`frame_crossmember_${x}`,[.15,.16,1.55],[x,.03,0],navy);
    for (const z of [-.61,.61]) {
      ring(components.base,`foundation_anchor_${x}_${z}`,.092,.034,.03,[x,.225,z],steel,'y');
      bolt(components.base,`foundation_bolt_${x}_${z}`,[x,.245,z],'y',.039,.045);
    }
  }

  // Motor: longitudinal cooling fins, fan cover, terminal box and four mounting feet.
  cylinder(components.motor,'motor_cast_frame',.47,1.64,[-1.93,axisY,0],paint);
  for (let i=0;i<32;i++) {
    const a=i*Math.PI*2/32;
    box(components.motor,`motor_longitudinal_fin_${i}`,[1.55,.09,.014],[-1.93,axisY+.49*Math.cos(a),.49*Math.sin(a)],paint,[a,0,0]);
  }
  cylinder(components.motor,'motor_front_end_shield',.475,.16,[-1.03,axisY,0],paint);
  cylinder(components.motor,'motor_front_bearing_boss',.18,.14,[-.90,axisY,0],paint);
  cylinder(components.motor,'motor_output_shaft',.075,.45,[-.64,axisY,0],steel);
  cylinder(components.motor,'motor_fan_cover',.51,.38,[-2.96,axisY,0],paint);
  const fanHoles=[];
  for(let ringIndex=0;ringIndex<3;ringIndex++)for(let i=0;i<24;i++) {
    const angle=i*Math.PI*2/24;const r=.22+ringIndex*.085;
    fanHoles.push([r*Math.cos(angle),r*Math.sin(angle),.025]);
  }
  ring(components.motor,'rear_fan_perforated_disc',.47,.08,.014,[-3.16,axisY,0],paint,'x',fanHoles);
  cylinder(components.motor,'fan_hub',.10,.03,[-3.14,axisY,0],black);
  for(const x of [-2.47,-1.43])for(const z of [-.39,.39]) {
    box(components.motor,`motor_support_${x}_${z}`,[.26,.43,.15],[x,.45,z],paint);
    box(components.motor,`motor_foot_${x}_${z}`,[.42,.065,.31],[x,.25,z],paint);
    bolt(components.motor,`motor_mounting_${x}_${z}`,[x,.294,z+.015*Math.sign(z)]);
  }
  box(components.motor,'terminal_box_pedestal',[.47,.12,.38],[-1.91,1.72,0],paint);
  box(components.motor,'terminal_box_floor',[.61,.035,.46],[-1.91,1.785,0],paint);
  for(const z of [-.215,.215])box(components.motor,`terminal_box_wall_${z}`,[.61,.34,.035],[-1.91,1.94,z],paint);
  for(const x of [-2.1975,-1.6225])box(components.motor,`terminal_box_end_${x}`,[.035,.34,.425],[x,1.94,0],paint);
  for(const x of [-2.08,-1.90,-1.72]) {
    box(components.motor,`terminal_insulator_${x}`,[.095,.08,.11],[x,1.93,.02],black);
    cylinder(components.motor,`terminal_contact_${x}`,.034,.12,[x,2.015,.02],brass,'y',16);
  }
  box(components.motor,'terminal_box_lid',[.65,.045,.50],[-1.91,2.125,0],paint);
  for(const x of [-2.17,-1.65])for(const z of [-.18,.18])bolt(components.motor,`terminal_lid_${x}_${z}`,[x,2.15,z],'y',.023,.025);
  cylinder(components.motor,'terminal_cable_gland',.065,.115,[-1.91,1.91,.29],steel,'z',24);
  ring(components.motor,'cable_gland_opening',.055,.031,.02,[-1.91,1.91,.36],black,'z');
  for(let i=0;i<6;i++) {
    const a=i*Math.PI*2/6;
    bolt(components.motor,`motor_end_cap_${i}`,[-.94,axisY+.38*Math.cos(a),.38*Math.sin(a)],'x',.025,.026);
  }

  // Coaxial coupling is entirely inside the protective enclosure.
  cylinder(components.coupling,'drive_shaft',.075,1.10,[-.11,axisY,0],steel);
  cylinder(components.coupling,'coupling_motor_hub',.15,.20,[-.22,axisY,0],steel);
  cylinder(components.coupling,'coupling_elastomer',.18,.10,[-.07,axisY,0],black);
  cylinder(components.coupling,'coupling_pump_hub',.15,.20,[.08,axisY,0],steel);

  const panel = (width,height,spacing=.11,holeRadius=.025) => {
    const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(width,0);shape.lineTo(width,height);shape.lineTo(0,height);shape.closePath();
    for(let row=0,y=.065;y<height-.04;y+=spacing,row++)for(let x=.065+(row%2)*spacing*.5;x<width-.04;x+=spacing) {
      const hole=new THREE.Path();hole.absarc(x,y,holeRadius,0,Math.PI*2,true);shape.holes.push(hole);
    }
    return new THREE.ShapeGeometry(shape,10);
  };
  const guardX=-.80,guardLength=1.46,guardRadius=.36,guardBottom=.42;
  const roof=panel(guardLength,Math.PI*guardRadius);
  const roofPositions=roof.attributes.position;
  for(let i=0;i<roofPositions.count;i++) {
    const u=roofPositions.getX(i),v=roofPositions.getY(i),angle=v/guardRadius;
    roofPositions.setXYZ(i,guardX+u,axisY+guardRadius*Math.sin(angle),guardRadius*Math.cos(angle));
  }
  roof.computeVertexNormals();
  mesh(components.guard,'guard_curved_perforated_roof',roof,guardMetal);
  for(const z of [-guardRadius,guardRadius]) {
    const side=panel(guardLength,axisY-guardBottom);
    side.translate(guardX,guardBottom,z);
    mesh(components.guard,`guard_perforated_side_${z}`,side,guardMetal);
    box(components.guard,`guard_mounting_flange_${z}`,[guardLength,.025,.13],[-.07,guardBottom,z],guardMetal);
    for(const x of [-.68,.52])bolt(components.guard,`guard_fastener_${x}_${z}`,[x,guardBottom+.017,z],'y',.023,.025);
  }
  for(const x of [guardX,guardX+guardLength]) {
    const shape=new THREE.Shape();shape.moveTo(-guardRadius,guardBottom);shape.lineTo(guardRadius,guardBottom);shape.lineTo(guardRadius,axisY);shape.absarc(0,axisY,guardRadius,0,Math.PI,false);shape.lineTo(-guardRadius,guardBottom);shape.closePath();
    const clearance=new THREE.Path();clearance.absarc(0,axisY,.083,0,Math.PI*2,true);shape.holes.push(clearance);
    const end=new THREE.ShapeGeometry(shape,32);
    const p=end.attributes.position;
    for(let i=0;i<p.count;i++)p.setXYZ(i,x,p.getY(i),p.getX(i));
    end.computeVertexNormals();mesh(components.guard,`guard_closed_end_${x}`,end,guardMetal);
  }

  // Bearing housing remains outside the guard and supports the pump shaft.
  cylinder(components.bearing,'pump_bearing_housing',.245,.72,[1.04,axisY,0],paint);
  cylinder(components.bearing,'bearing_front_cap',.258,.065,[1.41,axisY,0],paint);
  cylinder(components.bearing,'bearing_rear_cap',.25,.055,[.66,axisY,0],paint);
  box(components.bearing,'bearing_pedestal',[.28,.58,.27],[1.04,.63,0],paint);
  box(components.bearing,'bearing_mounting_foot',[.56,.075,.69],[1.04,.265,0],paint);
  for(const z of [-.25,.25])bolt(components.bearing,`bearing_foot_${z}`,[1.04,.31,z]);
  cylinder(components.bearing,'bearing_oil_fill',.043,.09,[1.04,1.465,0],steel,'y',16);
  cylinder(components.bearing,'oil_sight_glass_connection',.093,.08,[1.04,axisY,.254],steel,'z',32);
  ring(components.bearing,'oil_sight_glass_bezel',.105,.080,.028,[1.04,axisY,.31],steel,'z');
  const oilCanvas=document.createElement('canvas');oilCanvas.width=oilCanvas.height=256;
  const oilCtx=oilCanvas.getContext('2d');
  oilCtx.fillStyle='#E4EBED';oilCtx.fillRect(0,0,256,256);
  oilCtx.fillStyle='#96733B';oilCtx.fillRect(0,100,256,156);
  oilCtx.strokeStyle='#172C40';oilCtx.lineWidth=4;oilCtx.beginPath();oilCtx.moveTo(24,180);oilCtx.lineTo(76,180);oilCtx.stroke();
  oilCtx.font='500 27px Geologica, Arial';oilCtx.fillStyle='#172C40';oilCtx.fillText('MIN',84,191);
  const oilTexture=new THREE.CanvasTexture(oilCanvas);oilTexture.colorSpace=THREE.SRGBColorSpace;
  mesh(components.bearing,'oil_sight_glass_readable',new THREE.CircleGeometry(.08,48),new THREE.MeshStandardMaterial({name:'oil_sight_glass',map:oilTexture,roughness:.18,metalness:0}),[1.04,axisY,.327]);
  cylinder(components.seal,'seal_external_gland',.18,.11,[1.47,axisY,0],steel);
  ring(components.seal,'seal_gland_ring',.19,.09,.025,[1.49,axisY,0],steel);
  cylinder(components.seal,'seal_stationary_collar',.12,.055,[1.52,axisY,0],black);

  // Volute shell surrounds the impeller; inlet faces away from the shaft entry.
  const volute=new THREE.Shape();
  for(let i=0;i<=128;i++) {
    const angle=i*Math.PI*2/128;const r=.54+.085*i/128;
    const z=r*Math.cos(angle),y=r*Math.sin(angle);
    if(i===0)volute.moveTo(z,y);else volute.lineTo(z,y);
  }
  volute.closePath();
  const cavity=new THREE.Path();cavity.absarc(0,0,.455,0,Math.PI*2,true);volute.holes.push(cavity);
  const casing=new THREE.ExtrudeGeometry(volute,{depth:.43,bevelEnabled:true,bevelThickness:.018,bevelSize:.014,bevelSegments:3,curveSegments:64});
  casing.rotateY(Math.PI/2);
  casing.translate(1.53,axisY,0);
  mesh(components.pump,'spiral_volute_casting',casing,paint);
  ring(components.pump,'volute_backplate',.557,.094,.085,[1.53,axisY,0],paint);
  ring(components.pump,'volute_front_cover',.565,.167,.075,[2.00,axisY,0],paint);
  ring(components.pump,'suction_neck',.205,.167,.25,[2.13,axisY,0],paint);
  for(let i=0;i<12;i++) {
    const a=i*Math.PI*2/12;
    bolt(components.pump,`casing_stud_${i}`,[2.051,axisY+.495*Math.cos(a),.495*Math.sin(a)],'x',.025,.03);
  }
  for(const z of [-.37,.37]) {
    box(components.pump,`volute_support_${z}`,[.26,.38,.17],[1.76,.45,z],paint);
    box(components.pump,`volute_foot_${z}`,[.58,.08,.26],[1.76,.27,z],paint);
    bolt(components.pump,`pump_mounting_${z}`,[1.78,.315,z]);
  }
  ring(components.impeller,'impeller_back_disc',.265,.072,.035,[1.73,axisY,0],steel);
  for(let i=0;i<6;i++) {
    const angle=i*Math.PI*2/6;
    box(components.impeller,`impeller_blade_${i}`,[.075,.20,.025],[1.79,axisY+.15*Math.cos(angle),.15*Math.sin(angle)],steel,[angle,0,0]);
  }

  const flangeHoles=(circleRadius)=>Array.from({length:8},(_,i)=>{
    const a=(i+.5)*Math.PI*2/8;return[circleRadius*Math.cos(a),circleRadius*Math.sin(a),.03];
  });
  ring(components.pump,'pump_dn100_suction_flange',.3667,.1667,.068,[2.29,axisY,0],paint,'x',flangeHoles(.30));
  ring(components.inlet,'suction_line_mating_flange',.3667,.1667,.068,[2.38,axisY,0],steel,'x',flangeHoles(.30));
  ring(components.inlet,'suction_flange_gasket',.31,.1667,.012,[2.337,axisY,0],black);
  ring(components.inlet,'suction_pipe_spool',.189,.1667,.69,[2.755,axisY,0],steel);
  ring(components.inlet,'suction_pipe_open_end_flange',.3667,.1667,.06,[3.11,axisY,0],steel,'x',flangeHoles(.30));
  for(let i=0;i<8;i++) {
    const a=(i+.5)*Math.PI*2/8;bolt(components.inlet,`suction_joint_${i}`,[2.42,axisY+.30*Math.sin(a),.30*Math.cos(a)],'x',.043,.045);
  }
  // Vertical tangential discharge includes a connected pressure instrument tapping.
  ring(components.pump,'tangential_discharge_neck',.175,.1333,.58,[1.77,1.96,.27],paint,'y');
  ring(components.pump,'dn80_discharge_flange',.3333,.1333,.067,[1.77,2.275,.27],steel,'y',flangeHoles(.2667));
  const instrumentCurve=new THREE.CurvePath();
  instrumentCurve.add(new THREE.LineCurve3(new THREE.Vector3(1.77,2.05,.415),new THREE.Vector3(1.77,2.05,.66)));
  instrumentCurve.add(new THREE.LineCurve3(new THREE.Vector3(1.77,2.05,.66),new THREE.Vector3(1.77,2.37,.66)));
  mesh(components.gauge,'discharge_pressure_tapping',new THREE.TubeGeometry(instrumentCurve,16,.026,12,false),brass);
  cylinder(components.gauge,'gauge_isolation_valve',.053,.13,[1.77,2.25,.66],brass,'y',24);
  box(components.gauge,'isolation_valve_handle',[.20,.025,.035],[1.77,2.26,.72],paint);
  cylinder(components.gauge,'gauge_lower_connection',.04,.18,[1.77,2.40,.66],steel,'y',24);
  cylinder(components.gauge,'gauge_case',.205,.11,[1.77,2.67,.66],navy,'z',64);
  ring(components.gauge,'gauge_bezel',.212,.185,.035,[1.77,2.67,.738],steel,'z');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#F4F5F8';ctx.fillRect(0,0,512,512);
  ctx.translate(256,256);ctx.strokeStyle='#182B3D';ctx.fillStyle='#182B3D';ctx.lineCap='round';
  for(let i=0;i<=50;i++) {
    const angle=(225-i*270/50)*Math.PI/180;
    const inner=i%5===0?180:194;ctx.lineWidth=i%5===0?4:2;
    ctx.beginPath();ctx.moveTo(inner*Math.cos(angle),-inner*Math.sin(angle));ctx.lineTo(211*Math.cos(angle),-211*Math.sin(angle));ctx.stroke();
    if(i%10===0){ctx.font='500 33px Geologica, Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i/5),147*Math.cos(angle),-147*Math.sin(angle));}
  }
  ctx.font='400 37px Geologica, Arial';ctx.textAlign='center';ctx.fillText('bar',0,84);
  const dialTexture=new THREE.CanvasTexture(canvas);dialTexture.colorSpace=THREE.SRGBColorSpace;
  const dialMaterial=new THREE.MeshStandardMaterial({name:'pressure_gauge_dial_0_10_bar',map:dialTexture,roughness:.64,metalness:0});
  mesh(components.gauge,'gauge_readable_dial',new THREE.CircleGeometry(.184,64),dialMaterial,[1.77,2.67,.760]);
  const needleShape=new THREE.Shape();needleShape.moveTo(-.009,-.025);needleShape.lineTo(0,.133);needleShape.lineTo(.009,-.025);needleShape.closePath();
  mesh(components.gauge,'gauge_live_needle',new THREE.ShapeGeometry(needleShape),new THREE.MeshStandardMaterial({name:'gauge_needle_blue',color:0x135AA6,roughness:.45}),[1.77,2.67,.763],[0,0,THREE.MathUtils.degToRad(135-4.7*27)]);
  mesh(components.gauge,'gauge_needle_hub',new THREE.CircleGeometry(.010,24),paint,[1.77,2.67,.764]);
  const tangentGeometries=new Map();
  model.traverse(object=>{
    if(!object.isMesh||!object.material.normalMap)return;
    const original=object.geometry;
    if(!tangentGeometries.has(original))tangentGeometries.set(original,computeMikkTSpaceTangents(original,MikkTSpace));
    object.geometry=tangentGeometries.get(original);
  });
  model.updateMatrixWorld(true);
  return model;
}
