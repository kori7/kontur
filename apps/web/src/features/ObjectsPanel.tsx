import { useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { date, formatCopy, number, request } from "../api";
import type { FleetRow } from "../types";

const STATUS: Record<FleetRow["status"], string> = {
  critical: "Высокий риск",
  warning: "Проверить",
  unknown: "Нет данных",
  normal: "Без отклонений",
};

/** The round: every object with its state, objects needing attention first; tapping one opens its inspection. */
export function ObjectsPanel({ currentId, refresh, onOpen }: {
  currentId: string;
  refresh: number;
  onOpen: (id: string) => void;
}) {
  const [rows, setRows] = useState<FleetRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    request<FleetRow[]>("/objects").then(setRows).catch((cause) => setError((cause as Error).message));
  }, [refresh]);
  if (error) return <p className="camera-message camera-error support-copy" role="alert">{formatCopy(error)}</p>;
  if (!rows) {
    return (
      <div className="loading-screen">
        <Loader2 className="spin" size={24} />
        <p className="support-copy">Собираем состояние объектов</p>
      </div>
    );
  }
  return (
    <section className="panel objects-panel">
      <ul className="objects-list">
        {rows.map((row) => (
          <li key={row.equipment_id}>
            <button
              className={`object-row${row.equipment_id === currentId ? " current" : ""}`}
              data-object={row.equipment_id}
              aria-current={row.equipment_id === currentId ? "true" : undefined}
              onClick={() => onOpen(row.equipment_id)}
            >
              <span className={`object-status ${row.status}`} aria-hidden="true" />
              <span className="object-text">
                <strong>{row.name}</strong>
                <small className="support-copy">
                  {[
                    row.documented && row.serial ? `Зав. № ${row.serial}` : null,
                    row.last_event_at ? `осмотр ${date(row.last_event_at)}` : "не осматривался",
                    row.due_in_hours === null ? null : row.due_in_hours <= 0 ? "ТО наступило" : `ТО через ${number(row.due_in_hours, 0)} ч`,
                  ].filter(Boolean).join(" · ")}
                </small>
              </span>
              <span className={`rule-status object-badge ${row.status}`}>
                {STATUS[row.status]}{row.alerts > 1 ? ` · ${row.alerts}` : ""}
              </span>
              <ChevronRight size={18} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
