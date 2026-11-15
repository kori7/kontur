import { useEffect, useState } from "react";
import { ArrowDownToLine, ClipboardCheck, FileSpreadsheet, FileText, Wrench } from "lucide-react";
import { ACTIONS, RESULTS, SOURCES, date, formatCopy, number, recordResult, request, ruleLabel } from "../api";
import type { CatalogObject, Equipment, FleetRow, InspectionEvent } from "../types";

const PERIODS: Record<string, { label: string; hours: number | null }> = {
  shift: { label: "Смена, 12 ч", hours: 12 },
  week: { label: "7 дней", hours: 24 * 7 },
  all: { label: "Всё время", hours: null },
};


/** Journal: one object's history for everyone; the master also sees all objects, filters and the service plan. */
export function HistoryPanel({ equipment, events, objects, analysisId, can, onRecord, onExport, onOpenObject }: {
  equipment: Equipment;
  events: InspectionEvent[];
  objects: CatalogObject[];
  analysisId: string;
  can: (permission: string) => boolean;
  onRecord: () => void;
  onExport: () => void;
  onOpenObject: (id: string) => void;
}) {
  const master = can("reports");
  const [scope, setScope] = useState<"object" | "all">("object");
  const [period, setPeriod] = useState("all");
  const [action, setAction] = useState("");
  const [remarksOnly, setRemarksOnly] = useState(false);
  const [everything, setEverything] = useState<InspectionEvent[] | null>(null);
  const [cards, setCards] = useState<Record<string, Equipment>>({});
  const [plan, setPlan] = useState<FleetRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!master) return;
    request<FleetRow[]>("/maintenance/plan").then(setPlan).catch((cause) => setError((cause as Error).message));
  }, [master, events.length]);
  useEffect(() => {
    if (scope !== "all") return;
    request<InspectionEvent[]>("/inspections").then(setEverything).catch((cause) => setError((cause as Error).message));
  }, [scope, events.length]);
  // Component names of other objects come from their cards, loaded once per object shown.
  const source = scope === "all" ? everything ?? [] : events;
  useEffect(() => {
    const missing = [...new Set(source.map((event) => event.equipment_id ?? equipment.id))]
      .filter((id) => id !== equipment.id && !cards[id]);
    if (!missing.length) return;
    Promise.all(missing.map((id) => request<Equipment>(`/equipment/${encodeURIComponent(id)}`)))
      .then((loaded) => setCards((current) => ({ ...current, ...Object.fromEntries(loaded.map((card) => [card.id, card])) })))
      .catch(() => undefined);
  }, [source, equipment.id]);

  const since = PERIODS[period].hours === null ? null : Date.now() - PERIODS[period].hours! * 3600_000;
  const shown = source.filter((event) =>
    (since === null || new Date(event.created_at).getTime() >= since)
    && (!action || event.action === action)
    && (!remarksOnly || recordResult(event) === "remark"));
  const cardOf = (id: string | undefined) => (!id || id === equipment.id ? equipment : cards[id]);
  const objectName = (id: string | undefined) => objects.find((item) => item.id === id)?.name ?? id ?? equipment.name;

  return (
    <>
      {master && plan && (
        <section className="panel service-plan">
          <div className="panel-heading">
            <div>
              <h2><Wrench size={18} /> План ТО</h2>
              <p className="support-copy">Ближайшее обслуживание сверху</p>
            </div>
          </div>
          <ul className="assessment-list">
            {plan.filter((row) => row.due_in_hours !== null).map((row) => (
              <li key={row.equipment_id}>
                <button className="text-button plan-object" onClick={() => onOpenObject(row.equipment_id)}>
                  <strong>{row.name}{row.serial && row.documented ? ` · ${row.serial}` : ""}</strong>
                  <small className="support-copy">
                    {row.runtime_hours === null ? "Наработка неизвестна" : `Наработка ${number(row.runtime_hours, 0)} ч`}
                    {row.last_event_at ? ` · запись ${date(row.last_event_at)}` : " · записей нет"}
                  </small>
                </button>
                <span className={`rule-status ${row.due_in_hours === null ? "unknown" : row.due_in_hours <= 0 ? "above_alarm" : row.due_in_hours <= 500 ? "above_warning" : "below_warning"}`}>
                  {row.due_in_hours === null ? "Срок не определён" : row.due_in_hours <= 0 ? "ТО наступило" : `ТО через ${number(row.due_in_hours, 0)} ч`}
                </span>
              </li>
            ))}
          </ul>
          {/* Objects without motor hours cannot be planned yet; one line instead of a row each. */}
          {plan.some((row) => row.due_in_hours === null) && (
            <details className="object-notes-more plan-unknown">
              <summary className="support-copy">
                Срок не определён: {plan.filter((row) => row.due_in_hours === null).length}
              </summary>
              <ul className="assessment-list">
                {plan.filter((row) => row.due_in_hours === null).map((row) => (
                  <li key={row.equipment_id}>
                    <button className="text-button plan-object" onClick={() => onOpenObject(row.equipment_id)}>
                      <strong>{row.name}{row.serial && row.documented ? ` · ${row.serial}` : ""}</strong>
                      <small className="support-copy">Наработка неизвестна{row.last_event_at ? ` · запись ${date(row.last_event_at)}` : ""}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              История работ <span className="count-badge">{shown.length}</span>
            </h2>
          </div>
          <div className="report-actions">
            {master && <ReportLinks equipmentId={equipment.id} analysisId={analysisId} />}
            {can("users") && (
              <button className="button secondary small" onClick={onExport} disabled={!events.length}>
                <ArrowDownToLine size={15} />
                JSON
              </button>
            )}
          </div>
        </div>
        {master && (
          <div className="history-filters">
            <div className="segmented" role="group" aria-label="Объекты в журнале">
              <button aria-pressed={scope === "object"} onClick={() => setScope("object")}>Этот объект</button>
              <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>Все объекты</button>
            </div>
            <label className="field">
              <span className="support-copy">Период</span>
              <select value={period} onChange={(event) => setPeriod(event.target.value)}>
                {Object.entries(PERIODS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="support-copy">Действие</span>
              <select value={action} onChange={(event) => setAction(event.target.value)}>
                <option value="">Все</option>
                {Object.entries(ACTIONS).filter(([id]) => id !== "defect").map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="history-check">
              <input type="checkbox" checked={remarksOnly} onChange={(event) => setRemarksOnly(event.target.checked)} />
              Только с замечаниями
            </label>
          </div>
        )}
        {error && <p className="camera-message camera-error support-copy" role="alert">{formatCopy(error)}</p>}
        {shown.length ? (
          shown.map((event) => {
            const card = cardOf(event.equipment_id);
            const alerts = event.analysis.evaluation.alerts;
            return (
              <article key={event.id} className="history-item">
                {event.analysis.image_id ? (
                  <a className="history-photo" href={`/api/images/${event.analysis.image_id}`} target="_blank" rel="noreferrer">
                    <img src={`/api/images/${event.analysis.image_id}`} alt="Снимок осмотра" loading="lazy" />
                  </a>
                ) : (
                  <span className="history-icon">
                    <ClipboardCheck size={18} />
                  </span>
                )}
                <div>
                  {/* One template for every record: who and when, where, then fields; prose only if a person wrote it. */}
                  <p className="record-meta support-copy">{date(event.created_at)} · {event.author}</p>
                  <h3 className="record-where">
                    {scope === "all" ? `${objectName(event.equipment_id)} → ` : ""}
                    {formatCopy(card?.components.find((item) => item.id === event.component_id)?.name ?? event.component_id)}
                  </h3>
                  <dl className="record-fields">
                    <dt>Действие</dt>
                    {/* Older «Замечание» records were inspections with a remark; the result field now says so. */}
                    <dd>{ACTIONS[event.action === "defect" ? "inspection" : event.action]}</dd>
                    <dt>Результат</dt>
                    <dd><span className={`record-result ${recordResult(event)}`}>{RESULTS[recordResult(event)]}</span></dd>
                    {(event.source || event.finding) && (
                      <>
                        <dt>Источник</dt>
                        <dd>{[SOURCES[event.source ?? ""], event.finding].filter(Boolean).join(" · ")}</dd>
                      </>
                    )}
                    {event.notes && (
                      <>
                        <dt>Комментарий</dt>
                        <dd>{formatCopy(event.notes)}</dd>
                      </>
                    )}
                  </dl>
                  {alerts.length > 0 && (
                    <details>
                      <summary>Сработавшие правила: {alerts.length}</summary>
                      <div className="evidence-history">
                        {alerts.map((alert) => (
                          <div key={alert.id}>
                            <strong>{alert.rule_ids.map(ruleLabel).join(", ")} · {formatCopy(alert.title)}</strong>
                            <p className="support-copy">{formatCopy(alert.hypothesis)}</p>
                          </div>
                        ))}
                        {typeof event.analysis.telemetry.runtime_hours === "number" && (
                          <p className="support-copy">Наработка: {number(event.analysis.telemetry.runtime_hours, 0)} ч</p>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="empty">
            <ClipboardCheck size={36} />
            <h3>{source.length ? "Под фильтр ничего не попало" : "Записей пока нет"}</h3>
            {scope === "object" && !source.length && (
              <button className="button primary" onClick={onRecord}>Записать результат</button>
            )}
          </div>
        )}
      </section>
    </>
  );
}

/** Report export: Excel downloads, PDF opens a print-ready page the browser saves as PDF. */
function ReportLinks({ equipmentId, analysisId }: { equipmentId: string; analysisId: string }) {
  const query = `?analysis_id=${encodeURIComponent(analysisId)}`;
  const base = `/api/reports/${encodeURIComponent(equipmentId)}`;
  return (
    <>
      <a className="button secondary small" href={`${base}.xlsx${query}`} download>
        <FileSpreadsheet size={15} />
        Excel
      </a>
      <a className="button secondary small" href={`${base}/print${query}`} target="_blank" rel="noreferrer">
        <FileText size={15} />
        PDF
      </a>
    </>
  );
}
