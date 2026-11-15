export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && !path.startsWith("/auth/")) {
    // The session ended (expired or signed out elsewhere): the sign-in gate takes over.
    window.dispatchEvent(new Event("kontur-signed-out"));
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : "Не удалось выполнить запрос. Проверьте данные и повторите.",
    );
  }
  return response.json() as Promise<T>;
}
export async function send<T>(path: string, method: "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === "string" ? error.detail : "Не удалось выполнить запрос");
  }
  return response.json() as Promise<T>;
}
export async function sendFrame<T>(
  sessionId: string,
  frameNo: number,
  frame: Blob,
): Promise<T> {
  const response = await fetch(
    `/api/live/sessions/${encodeURIComponent(sessionId)}/frames/${frameNo}`,
    { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: frame },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : "Сервер не принял кадр. Проверьте связь с локальной сетью",
    );
  }
  return response.json() as Promise<T>;
}
export const number = (value: unknown, digits = 1) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("ru-RU", { maximumFractionDigits: digits })
    : "—";
export const date = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
export const sourceLabel = (source: string) =>
  ({ demo: "Демоданные", manual: "Инженер", model: "ИИ-анализ" })[source] ??
  source;

export const formatCopy = (value: string | null | undefined) =>
  (value ?? "").replace(/\.+\s*$/, "");

export const ACTIONS: Record<string, string> = {
  inspection: "Проверка",
  defect: "Замечание",
  maintenance: "Обслуживание",
  replacement: "Замена",
};

export const RESULTS: Record<string, string> = { ok: "Норма", remark: "Замечание", rejected: "Отклонено", done: "Выполнено" };
export const SOURCES: Record<string, string> = { camera: "Камера", manual: "Вручную", sensor: "Датчик" };

/** A record's outcome; older records without the field get the same answer the server would give. */
export function recordResult(event: { action: string; result?: string; analysis: { evaluation: { alerts: unknown[] } } }) {
  if (event.result) return event.result;
  if (event.action === "maintenance" || event.action === "replacement") return "done";
  return event.action === "defect" || event.analysis.evaluation.alerts.length ? "remark" : "ok";
}

/** Rule ids as the inspector sees them: series setpoint rules carry internal channel keys. */
export const ruleLabel = (id: string) =>
  id === "S-maintenance" ? "ТО" : id.startsWith("S-") ? "Ряд" : id;

const INPUT_NAMES: Record<string, string> = {
  "equipment.commissioned_at": "дата ввода в эксплуатацию",
  "journal.inspection": "запись «Проверка» в журнале",
  "journal.maintenance": "запись «Обслуживание» в журнале",
  "series.vibration_1x": "вибрация 1x",
  "series.vibration_2x": "вибрация 2x",
  "series.high_frequency_acceleration_g": "ВЧ-шум",
  "series.temperature": "температура подшипника",
  "series.winding_temperature": "температура обмоток",
  "observations.guard_missing": "осмотр кожуха",
  "observations.guard_damaged": "осмотр кожуха",
  "observations.liquid_leak": "осмотр уплотнения",
  "observations.missing_bolt": "осмотр крепежа",
  "observations.loose_bolt": "осмотр крепежа",
  "observations.base_corrosion": "осмотр рамы",
  "observations.oil_low": "уровень масла",
  "observations.oil_degraded": "состояние масла",
  "observations.contact_damage": "осмотр контактов",
  "observations.analog_pressure": "показание манометра",
};

/** What a rule is missing, in words: the object's own input names first, then the shared ones. */
export function inputLabel(
  key: string,
  equipment: { measurements?: Record<string, { label: string }>; defect_classes?: { id: string; name: string }[] },
) {
  const [kind, name] = key.split(/\.(.+)/);
  if (kind === "measurements" && equipment.measurements?.[name]) return equipment.measurements[name].label;
  const found = kind === "findings" && equipment.defect_classes?.find((item) => item.id === name);
  if (found) return formatCopy(found.name);
  return INPUT_NAMES[key] ?? key.replace(/^[a-z]+\./, "").replace(/_/g, " ");
}
