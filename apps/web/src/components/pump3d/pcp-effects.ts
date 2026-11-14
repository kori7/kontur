import * as THREE from "three";
import type { PcpVisualState } from "./pcp-state";

export function createPcpEffects(model:THREE.Object3D,parts:Map<string,THREE.Object3D>) {
  const originals=new Set<THREE.Material>(),baselines=new Map<THREE.MeshStandardMaterial,{color:THREE.Color;emissive:THREE.Color;opacity:number;transparent:boolean;side:THREE.Side;clippingPlanes:THREE.Plane[]|null;clipShadows:boolean}>();
  for(const part of parts.values())part.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const clone=(material:THREE.Material)=>{
      originals.add(material);const next=material.clone();
      if(next instanceof THREE.MeshStandardMaterial)baselines.set(next,{color:next.color.clone(),emissive:next.emissive.clone(),opacity:next.opacity,transparent:next.transparent,side:next.side,clippingPlanes:next.clippingPlanes,clipShadows:next.clipShadows});
      return next;
    };
    object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
  });
  const leakingMaterial=new THREE.MeshPhysicalMaterial({color:0x665744,roughness:.18,transparent:true,opacity:.85,clearcoat:1});
  const leak=new THREE.Mesh(new THREE.CircleGeometry(.075,32),leakingMaterial);leak.rotation.x=-Math.PI/2;leak.position.set(-.15,.125,.10);model.add(leak);
  let current:PcpVisualState|null=null,cutaway=false;
  // The shaft axis is 296 mm above the installation plane on drawing 21031004.
  const sectionPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),.296);
  const materials=(id:string,fn:(m:THREE.MeshStandardMaterial)=>void)=>parts.get(id)?.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    for(const material of Array.isArray(object.material)?object.material:[object.material])if(material instanceof THREE.MeshStandardMaterial)fn(material);
  });
  const recolor=(id:string,color:number,amount:number)=>materials(id,m=>m.color.lerp(new THREE.Color(color),amount));
  const apply=(state:PcpVisualState,selected:string)=>{
    current=state;
    for(const [m,b] of baselines){m.color.copy(b.color);m.emissive.copy(b.emissive);m.emissiveIntensity=1;m.opacity=b.opacity;m.transparent=b.transparent;m.depthWrite=true;m.side=b.side;m.clippingPlanes=b.clippingPlanes;m.clipShadows=b.clipShadows;}
    parts.get("guard")!.visible=!state.guardMissing&&!cutaway;
    for(const id of state.heatParts)materials(id,m=>{m.color.lerp(new THREE.Color(0xD94F35),.35+state.heat*.55);m.emissive.setHex(0xC94028);m.emissiveIntensity=.07;});
    for(const id of state.corrosionParts)recolor(id,0x926644,.65);
    if(state.fastenerWarning){recolor("stud",0xD9A052,.7);recolor("frame",0xD9A052,.12);}
    if(state.bootDamage)recolor("joint_boot",0xB86638,.65);
    leak.visible=state.sealLeak||state.flangeLeak;leak.position.x=state.sealLeak?-.15:1.16;
    if(selected&&!state.heatParts.includes(selected))recolor(selected,0x63B8F1,.06);
    if(cutaway)for(const id of ["pump_casing","stator","seal_housing","joint_boot","joint_bush_outer"])materials(id,m=>{m.clippingPlanes=[sectionPlane];m.clipShadows=true;m.side=THREE.DoubleSide;});
  };
  return {
    apply,
    cutaway(value:boolean,selected:string){cutaway=value;if(current)apply(current,selected);for(const m of baselines.keys())m.needsUpdate=true;},
    animate(_time:number,_reducedMotion:boolean){return false;},
    reflect(canvas:HTMLCanvasElement){
      canvas.dataset.cutaway=String(cutaway);canvas.dataset.guardVisible=String(parts.get("guard")!.visible);canvas.dataset.leakVisible=String(leak.visible);
      canvas.dataset.heatParts=(current?.heatParts??[]).join(",");canvas.dataset.dtsTemperature=String(current?.dtsTemperature??"unknown");
      let color="";materials("stator",m=>{if(m.name.includes("cast"))color=m.color.getHexString();});canvas.dataset.statorColor=color;
    },
    dispose(){for(const material of originals)material.dispose();}
  };
}
