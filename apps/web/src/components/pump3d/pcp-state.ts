import type { Analysis } from "../../types";

export interface PcpVisualState {
  heatParts: string[];
  heat: number;
  dtsTemperature: number | null;
  guardMissing: boolean;
  sealLeak: boolean;
  flangeLeak: boolean;
  fastenerWarning: boolean;
  corrosionParts: string[];
  bootDamage: boolean;
  unknown: boolean;
  messages: string[];
}
const finite=(v:unknown):number|null=>typeof v === "number" && Number.isFinite(v)?v:null;
export function derivePcpState(analysis: Analysis): PcpVisualState {
  const m=analysis.measurements ?? {}, findings=new Set((analysis.findings??[]).filter(item=>item.present).map(item=>item.class_id));
  const dtsTemperature=finite(m.dts_temperature_c),product=finite(m.product_temperature_c),seal=finite(m.seal_surface_temperature_c);
  const heatParts:string[]=[],messages:string[]=[];
  let heat=0;
  if(dtsTemperature!==null){messages.push(`DTS · ${dtsTemperature.toLocaleString("ru-RU")} °C`);if(dtsTemperature>=90){heatParts.push("stator","dts_sensor");heat=Math.max(.3,Math.min(1,(dtsTemperature-85)/20));}}
  if(m.stator_ptc_tripped===true){heatParts.push("motor");heat=1;messages.push("Сработала термисторная защита двигателя");}
  if(seal!==null&&product!==null&&seal-product>20){heatParts.push("seal_housing");heat=Math.max(heat,.7);messages.push("Повышена температура уплотнения");}
  const guardMissing=findings.has("guard_missing"),sealLeak=findings.has("seal_leak_excessive") || (finite(m.gland_drip_rate_per_min)??0)>0;
  const flangeLeak=findings.has("flange_joint_leak"),fastenerWarning=findings.has("fastener_missing")||findings.has("fastener_loose");
  const corrosionParts=[...(findings.has("frame_corrosion")?["frame"]:[]),...(findings.has("flange_joint_corrosion")?["discharge_flange","pump_casing"]:[])];
  const bootDamage=findings.has("joint_boot_damage"),unknown=Object.keys(m).length===0 && !(analysis.findings??[]).length;
  if(guardMissing)messages.push("Отмечено отсутствие защитного кожуха");
  if(sealLeak)messages.push("Отмечена утечка уплотнения");
  if(flangeLeak)messages.push("Отмечена утечка фланцевого соединения");
  if(fastenerWarning)messages.push("Проверка крепежа · место требует уточнения");
  if(corrosionParts.length)messages.push("Отмечена коррозия");
  if(bootDamage)messages.push("Отмечено повреждение пыльников");
  if(unknown)messages.push("Нет измерений · состояние не определено");
  if(!messages.length)messages.push("Отображены введённые данные осмотра");
  return {heatParts,heat,dtsTemperature,guardMissing,sealLeak,flangeLeak,fastenerWarning,corrosionParts,bootDamage,unknown,messages};
}
