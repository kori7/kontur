import type { Equipment } from "../../types";
import { modelNodes } from "./nodes";

export interface ModelNode { id: string; label: string; offset: readonly [number, number] }
export interface ModelProfile {
  id: "demo" | "ams-pcp";
  file: string;
  nodes: readonly ModelNode[];
  title: string;
  initialPart: string;
}
const pcpNodes: ModelNode[] = [
  {id:"motor",label:"Двигатель",offset:[-28,-85]},
  {id:"gearbox",label:"Редуктор",offset:[-24,-58]},
  {id:"adapter",label:"Адаптер",offset:[-30,58]},
  {id:"seal_housing",label:"Корпус уплотнения",offset:[15,-60]},
  {id:"pump_casing",label:"Корпус насоса",offset:[12,-80]},
  {id:"stator",label:"Статор",offset:[5,70]},
  {id:"stud",label:"Стяжные шпильки",offset:[32,30]},
  {id:"discharge_flange",label:"Выход DN100",offset:[45,-50]},
  {id:"frame",label:"Рама",offset:[-45,85]},
  {id:"drain_plug",label:"Сливная пробка",offset:[35,70]},
  {id:"hatch_cover",label:"Смотровой люк",offset:[-35,-40]},
  {id:"joint_boot",label:"Пыльники шарниров",offset:[40,60]},
  {id:"dts_sensor",label:"Датчик DTS",offset:[45,-20]},
  {id:"guard",label:"Защитный кожух",offset:[-25,-105]},
];
export function modelProfile(equipment: Pick<Equipment,"id"|"equipment_type">): ModelProfile | null {
  if(equipment.id === "pump-101")return {id:"demo",file:"/models/pump-assembly.glb",nodes:modelNodes,title:"3D · демонстрационная сборка",initialPart:"bearing"};
  if(equipment.equipment_type === "pcp_pump_unit")return {id:"ams-pcp",file:"/models/ams-pcp-21031004.glb",nodes:pcpNodes,title:"AMS PCP · сборка по чертежам",initialPart:"stator"};
  return null;
}
