import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { request, number } from "../api";
import type { SeriesCatalog, SeriesWindow } from "../types";

const statusLabels: Record<string, string> = {
  above_alarm: "Выше тревоги",
  above_warning: "Выше предупреждения",
  below_warning: "Ниже предупреждения",
  unknown: "Нет значения",
};

export function SeriesPanel() {
  const [catalog, setCatalog] = useState<SeriesCatalog | null>(null);
  const [seriesId, setSeriesId] = useState("vibration-001");
  const [frame, setFrame] = useState<SeriesWindow | null>(null);
  const [endIndex, setEndIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<SeriesCatalog>("/reference/series")
      .then(setCatalog)
      .catch((cause) => setError((cause as Error).message));
  }, []);

  useEffect(() => {
    let active = true;
    setBusy(true);
    const query = endIndex === null ? "" : `?end_index=${endIndex}&limit=10`;
    request<SeriesWindow>(`/reference/series/${seriesId}${query}`)
      .then((result) => {
        if (active) {
          setFrame(result);
          setError("");
        }
      })
      .catch((cause) => {
        if (active) setError((cause as Error).message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [seriesId, endIndex]);

  const metadata = catalog?.series.find((item) => item.id === seriesId);
  const last = (metadata?.record_count ?? 1) - 1;
  const current = frame?.end_index ?? last;

  function step(delta: number) {
    const next = Math.min(last, Math.max(9, current + delta));
    setEndIndex(next);
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Ряды измерений организатора</h2>
          <p>
            Отдельное воспроизведение переданных таблиц. Эти ряды не принадлежат
            ни одному объекту каталога и телеметрией оборудования не являются.
          </p>
        </div>
        <span className="tag">{metadata?.record_count ?? "—"} записей</span>
      </div>

      <div className="series-controls">
        <label className="field">
          <span>Ряд</span>
          <select
            value={seriesId}
            onChange={(event) => {
              setSeriesId(event.target.value);
              setEndIndex(null);
            }}
          >
            {(catalog?.series ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · лист «{item.sheet}»
              </option>
            ))}
          </select>
        </label>
        <div className="series-stepper">
          <button
            className="button secondary small"
            onClick={() => step(-10)}
            disabled={busy || current <= 9}
          >
            <ChevronLeft size={15} /> Раньше
          </button>
          <span className="tiny muted">
            Записи {frame ? `${frame.start_index + 1}–${frame.end_index + 1}` : "—"} из{" "}
            {metadata?.record_count ?? "—"}
          </span>
          <button
            className="button secondary small"
            onClick={() => step(10)}
            disabled={busy || current >= last}
          >
            Позже <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {error && (
        <p className="object-note">
          <TriangleAlert size={14} /> {error}
        </p>
      )}

      {!frame ? (
        <div className="loading-screen">
          <Loader2 className="spin" size={24} />
          <p>Загружаем окно записей</p>
        </div>
      ) : (
        <>
          <div className="series-table-wrap">
            <table className="series-table">
              <thead>
                <tr>
                  <th>Время источника</th>
                  {frame.channels.map((channel) => (
                    <th key={channel.key}>
                      {channel.label}
                      <small>{channel.unit}</small>
                    </th>
                  ))}
                  <th>Пометка организатора</th>
                </tr>
              </thead>
              <tbody>
                {frame.records.map((record) => (
                  <tr key={record.index}>
                    <td className="series-time">{record.raw_date}</td>
                    {frame.channels.map((channel) => (
                      <td key={channel.key}>
                        {number(record.values[channel.key], 2)}
                      </td>
                    ))}
                    <td>{record.annotation ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel-heading">
            <div>
              <h2>Уставки из описания этого же ряда</h2>
              <p>
                Сравнение с порогами, записанными в описании таблицы. Это вывод
                алгоритма организатора о его собственном сценарии, а не
                диагностика оборудования.
              </p>
            </div>
          </div>
          <ul className="assessment-list">
            {frame.organizer_assessment.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.name} <small>{item.unit}</small>
                  </strong>
                  <small>
                    {item.warning === undefined
                      ? "Порог не задан"
                      : `Предупреждение ≥ ${item.warning}`}
                    {item.alarm === undefined ? "" : ` · тревога ≥ ${item.alarm}`}
                    {item.hypothesis ? ` · ${item.hypothesis}` : ""}
                  </small>
                </div>
                <span className={`rule-status ${item.status}`}>
                  {number(item.value, 2)} · {statusLabels[item.status]}
                </span>
              </li>
            ))}
          </ul>

          <div className="series-limits">
            <h4>Ограничения ряда</h4>
            <ul>
              {frame.limitations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            {(catalog?.thresholds.conflicts_with_project ?? []).map((text) => (
              <p className="object-note" key={text}>
                <TriangleAlert size={14} /> {text}
              </p>
            ))}
            <p className="tiny muted">
              Техническая координата времени: {frame.telemetry.time_basis}. Часовой
              пояс исходных строк неизвестен, часовой шаг сохранён.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
