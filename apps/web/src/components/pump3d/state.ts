import type { Analysis, Observation } from "../../types";

export interface PumpVisualState {
  temperature: number | null;
  heat: number;
  heatParts: string[];
  gaugePressure: number | null;
  leak: boolean;
  guardMissing: boolean;
  guardDamaged: boolean;
  missingBolt: boolean;
  oilLow: boolean;
  oilDegraded: boolean;
  contactDamage: boolean;
  cavitation: boolean;
  misalignment: boolean;
  baseVibration: boolean;
  impellerWear: boolean;
  serviceDue: boolean;
  unknown: boolean;
  messages: string[];
}

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const sourcePriority: Record<string, number> = { demo: 1, model: 2, manual: 3 };

export function derivePumpState(analysis: Analysis): PumpVisualState {
  const observations = new Map<string, Observation>();
  for (const observation of analysis.observations) {
    const key = `${observation.kind}:${observation.component_id}`;
    const previous = observations.get(key);
    if (!previous || (sourcePriority[observation.source] ?? 0) >= (sourcePriority[previous.source] ?? 0)) observations.set(key, observation);
  }
  const present = (kind: string) => [...observations.values()].some(item => item.kind === kind && item.present === true);
  const rules = new Set(analysis.evaluation.alerts.flatMap(alert => alert.rule_ids));
  const last = analysis.telemetry.samples.at(-1);
  const temperature = finite(last?.temperature);
  const baseline = finite(analysis.telemetry.baseline.temperature);
  const heat = temperature === null || baseline === null ? 0 : Math.max(0, Math.min(1, (temperature - baseline - 4) / 8));
  const affected = [...new Set(analysis.evaluation.alerts.map(alert => alert.component_id).filter(id => ["bearing", "seal", "motor"].includes(id)))];
  const heatParts = heat > 0 ? affected.length ? affected : ["bearing"] : [];
  const analog = [...observations.values()].find(item => item.kind === "analog_pressure");
  const gaugePressure = analog ? finite(analog.value) : finite(last?.outlet_pressure);
  const unknown = temperature === null && finite(last?.vibration) === null && gaugePressure === null;
  const state: PumpVisualState = {
    temperature, heat, heatParts, gaugePressure,
    leak: present("liquid_leak"),
    guardMissing: present("guard_missing"),
    guardDamaged: present("guard_damaged"),
    missingBolt: present("missing_bolt"),
    oilLow: present("oil_low"),
    oilDegraded: present("oil_degraded"),
    contactDamage: present("contact_damage"),
    cavitation: rules.has("R02") || rules.has("R12") || present("flow_instability"),
    misalignment: rules.has("R03"),
    baseVibration: rules.has("R07") || present("loose_bolt"),
    impellerWear: rules.has("R04"),
    serviceDue: rules.has("R05"),
    unknown, messages: [],
  };
  if (unknown) state.messages.push("Недостаточно данных для отображения состояния");
  if (heatParts.length) state.messages.push(`Тепловая подсветка · ${temperature?.toLocaleString("ru-RU")} °C`);
  if (state.leak) state.messages.push("Жидкость у уплотнения");
  if (state.guardMissing) state.messages.push("Кожух снят · муфта открыта");
  else if (state.guardDamaged) state.messages.push("Кожух смещён");
  if (state.missingBolt) state.messages.push("Отсутствует фундаментный болт");
  if (state.oilLow) state.messages.push("Уровень масла ниже MIN");
  if (state.oilDegraded) state.messages.push("Изменение вида масла");
  if (state.contactDamage) state.messages.push("Повреждение контактов");
  if (state.cavitation || state.misalignment || state.baseVibration) state.messages.push("Вибрация показана условно");
  if (state.misalignment) state.messages.push("Муфта · условный разрез");
  if (state.impellerWear) state.messages.push("Износ проточной части · условный разрез");
  if (state.serviceDue) state.messages.push("Подошёл срок планового ТО");
  if (rules.has("R10")) state.messages.push(`Манометр ${gaugePressure?.toLocaleString("ru-RU")} бар · расхождение каналов`);
  if (!state.messages.length) state.messages.push("Демонстрационный режим · без заданных дефектов");
  return state;
}
