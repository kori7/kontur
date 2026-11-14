import { useEffect, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { formatCopy, number } from "../api";
import type { Analysis, Equipment } from "../types";

// The organizer's setpoints from the series descriptions; values above them are highlighted.
const CHANNELS: { key: string; label: string; unit: string; warning: number; alarm?: number }[] = [
  { key: "vibration_1x", label: "Вибрация 1x", unit: "мм/с", warning: 2.8, alarm: 4.5 },
  { key: "vibration_2x", label: "Вибрация 2x", unit: "мм/с", warning: 1.8, alarm: 3.0 },
  { key: "high_frequency_acceleration_g", label: "ВЧ-шум", unit: "g", warning: 2.5 },
  { key: "temperature", label: "Подшипник насоса", unit: "°C", warning: 75, alarm: 90 },
  { key: "winding_temperature", label: "Обмотки двигателя", unit: "°C", warning: 90, alarm: 110 },
  { key: "rpm", label: "Обороты", unit: "об/мин", warning: Infinity },
];
const SERIES_NAMES: Record<string, string> = { "vibration-001": "вибрация", "temperature-001": "температура" };

/** The main pump's telemetry: the organizer's series replayed record by record, with motor hours. */
export function SeriesTelemetryPanel({ equipment, analysis, busy, onRecord, service = true }: {
  equipment: Equipment;
  analysis: Analysis;
  busy: boolean;
  onRecord: (index: number) => void;
  /** Browsing past records and the comparison with the organizer's labels are the master's tools. */
  service?: boolean;
}) {
  const telemetry = equipment.telemetry!;
  const index = analysis.telemetry.record_index ?? telemetry.recorded_hours - 1;
  const [pending, setPending] = useState(index);
  useEffect(() => setPending(index), [index]);
  const record: Record<string, number | string | null> = analysis.telemetry.samples.at(-1) ?? {};
  const maintenance = analysis.evaluation.maintenance;
  const ours = analysis.evaluation.alerts.map((alert) => alert.title);
  const go = (next: number) => onRecord(Math.min(Math.max(next, 0), telemetry.recorded_hours - 1));
  return (
    <section className="panel series-telemetry">
      <div className="panel-heading">
        <div>
          <h2><Activity size={18} /> Телеметрия агрегата</h2>
          {service && (
            <details className="object-notes-more">
              <summary className="support-copy">Откуда эти данные</summary>
              <p className="support-copy">{formatCopy(telemetry.note)}</p>
            </details>
          )}
        </div>
      </div>
      <div className="series-source">
        {analysis.telemetry.io ? (
          <span className="tag live">
            Сервер ввода/вывода · {analysis.telemetry.io.address} · {analysis.telemetry.io.running ? "в работе" : "остановлен"}
          </span>
        ) : (
          <span className="tag">История из ряда организатора</span>
        )}
        <button className="button secondary small" disabled={busy} onClick={() => onRecord(-1)}>
          Текущее значение
        </button>
      </div>
      {analysis.telemetry.io_error && (
        <p className="camera-message camera-error support-copy" role="alert">{formatCopy(analysis.telemetry.io_error)}</p>
      )}
      {service && (
      <div className="series-controls">
        <button className="button secondary" aria-label="Предыдущая запись" disabled={busy || index === 0}
          onClick={() => go(index - 1)}><ChevronLeft size={18} /></button>
        <label className="series-slider">
          <span className="support-copy">Запись {index + 1} из {telemetry.recorded_hours} · {String(record.at ?? "").replace("T", " ").slice(0, 16)}</span>
          <input type="range" min={0} max={telemetry.recorded_hours - 1} value={pending} disabled={busy}
            aria-label="Запись ряда" onChange={(event) => setPending(Number(event.target.value))}
            onPointerUp={() => pending !== index && go(pending)} onKeyUp={() => pending !== index && go(pending)} />
        </label>
        <button className="button secondary" aria-label="Следующая запись"
          disabled={busy || index >= telemetry.recorded_hours - 1} onClick={() => go(index + 1)}><ChevronRight size={18} /></button>
      </div>
      )}
      <div className="series-values">
        {CHANNELS.map((channel) => {
          const value = record[channel.key];
          const level = typeof value !== "number" ? "" : channel.alarm !== undefined && value > channel.alarm
            ? "critical" : value > channel.warning ? "warning" : "";
          return (
            <div key={channel.key} className={`series-value ${level}`}>
              <span className="support-copy">{channel.label}</span>
              <strong>{number(value, 2)} <small>{channel.unit}</small></strong>
              {Number.isFinite(channel.warning) && (
                <span className="support-copy">пред. &gt; {channel.warning}{channel.alarm ? ` · тревога > ${channel.alarm}` : ""}</span>
              )}
            </div>
          );
        })}
      </div>
      {service && (
      <div className="series-compare">
        <div>
          <span className="support-copy">Вывод системы</span>
          <strong>{ours.length ? ours.join(", ") : "Отклонений по уставкам нет"}</strong>
        </div>
        <div>
          <span className="support-copy">Колонка «Диагноз» организатора</span>
          <strong>{Object.entries(analysis.telemetry.organizer_annotations ?? {})
            .map(([series, label]) => `${SERIES_NAMES[series] ?? series}: ${label}`).join(" · ")}</strong>
        </div>
      </div>
      )}
      <div className="series-hours">
        <Clock3 size={18} />
        <div>
          <strong>Наработка в работе: {number(maintenance.runtime_hours, 0)} ч
            {maintenance.next_service_hours ? ` · до следующего ТО ${number(maintenance.due_in_hours, 0)} ч` : ""}</strong>
          <p className="support-copy">{formatCopy(telemetry.rule)}</p>
          <ul className="service-steps">
            {(equipment.maintenance_schedule ?? []).map((step) => (
              <li key={step.hours} className={(maintenance.runtime_hours ?? 0) >= step.hours ? "done" : ""}>
                <b>{step.name} · {number(step.hours, 0)} ч</b> — {formatCopy(step.work)}
              </li>
            ))}
          </ul>
          <p className="support-copy">{formatCopy(equipment.maintenance_schedule_note)}</p>
        </div>
      </div>
    </section>
  );
}
