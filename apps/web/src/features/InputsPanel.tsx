import { formatCopy } from "../api";
import { useState } from "react";
import { Gauge, Loader2 } from "lucide-react";
import type { Equipment, Finding } from "../types";
import { ReadingRows, type Reading } from "../components/ReadingRows";

type FindingState = "unset" | "present" | "absent";

export function InputsPanel({
  equipment,
  busy,
  onSubmit,
}: {
  equipment: Equipment;
  busy: boolean;
  onSubmit: (
    measurements: Record<string, number | boolean>,
    findings: Finding[],
  ) => void;
}) {
  const vocabulary = Object.entries(equipment.measurements ?? {});
  const classes = equipment.defect_classes ?? [];
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, FindingState>>({});
  const [findings, setFindings] = useState<Record<string, FindingState>>({});

  function submit() {
    const measurements: Record<string, number | boolean> = {};
    for (const [key, field] of vocabulary) {
      if (field.kind === "boolean") {
        const state = flags[key] ?? "unset";
        if (state !== "unset") measurements[key] = state === "present";
        continue;
      }
      const raw = (numbers[key] ?? "").replace(",", ".").trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (Number.isFinite(value)) measurements[key] = value;
    }
    const collected: Finding[] = classes
      .filter((item) => (findings[item.id] ?? "unset") !== "unset")
      .map((item) => ({
        class_id: item.id,
        present: findings[item.id] === "present",
      }));
    onSubmit(measurements, collected);
  }

  const rows: Reading[] = vocabulary.map(([key, field]) => ({
    key,
    label: `${field.label}${field.unit ? `, ${field.unit}` : ""}`,
    source: `Вручную · ${field.instrument}`,
    value: field.kind === "boolean" ? (
      <select aria-label={field.label} value={flags[key] ?? "unset"}
        onChange={(event) => setFlags({ ...flags, [key]: event.target.value as FindingState })}>
        <option value="unset">Не проверено</option>
        <option value="present">Да</option>
        <option value="absent">Нет</option>
      </select>
    ) : (
      <input aria-label={field.label} inputMode="decimal" placeholder="—" value={numbers[key] ?? ""}
        onChange={(event) => setNumbers({ ...numbers, [key]: event.target.value })} />
    ),
  }));

  return (
    <section className="panel readings-panel" id="readings">
      <div className="panel-heading">
        <div>
          <h2>
            <Gauge size={18} /> Замеры
          </h2>
          <p className="support-copy">
            Датчиков нет — введите, что измерили. Пустое поле — «нет данных», а не «норма»
          </p>
        </div>
      </div>

      {rows.length > 0 && <ReadingRows rows={rows} />}

      {classes.length > 0 && (
        <>
          <div className="panel-heading">
            <div>
              <h3 className="readings-subhead">Видимые признаки</h3>
              <p className="support-copy">
                «Не осмотрено» и «не обнаружено» — разные ответы
              </p>
            </div>
          </div>
          {/* Visible signs are rows of the same table: what to look at, what was seen. */}
          <ReadingRows rows={classes.map((item) => ({
            key: item.id,
            label: formatCopy(item.name),
            source: "Визуально",
            value: (
              <select aria-label={formatCopy(item.name)} value={findings[item.id] ?? "unset"}
                onChange={(event) => setFindings({ ...findings, [item.id]: event.target.value as FindingState })}>
                <option value="unset">Не осмотрено</option>
                <option value="present">Есть</option>
                <option value="absent">Нет</option>
              </select>
            ),
          }))} />
        </>
      )}

      <div className="inputs-actions">
        <button className="button primary" onClick={submit} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <Gauge size={16} />}
          Пересчитать по введённым данным
        </button>
      </div>
    </section>
  );
}
