import { useState } from "react";
import { Gauge, Loader2 } from "lucide-react";
import type { Equipment, Finding } from "../types";

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

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>
            <Gauge size={15} /> Входы осмотра
          </h2>
          <p>
            Телеметрии у этого объекта нет. Правила читают измерения, снятые
            названным прибором, видимые признаки и журнал. Незаполненный вход
            остаётся неизвестным: правило вернёт «недостаточно данных», а не
            «норма».
          </p>
        </div>
        <span className="tag">{equipment.rules?.length ?? 0} правил</span>
      </div>

      {vocabulary.length > 0 && (
        <div className="inputs-grid">
          {vocabulary.map(([key, field]) =>
            field.kind === "boolean" ? (
              <label className="field" key={key}>
                <span>{field.label}</span>
                <select
                  value={flags[key] ?? "unset"}
                  onChange={(event) =>
                    setFlags({ ...flags, [key]: event.target.value as FindingState })
                  }
                >
                  <option value="unset">Не проверялось</option>
                  <option value="present">Да</option>
                  <option value="absent">Нет</option>
                </select>
                <small className="tiny muted">
                  {field.instrument} · {field.basis}
                </small>
              </label>
            ) : (
              <label className="field" key={key}>
                <span>
                  {field.label}
                  {field.unit ? `, ${field.unit}` : ""}
                </span>
                <input
                  inputMode="decimal"
                  placeholder="не измерено"
                  value={numbers[key] ?? ""}
                  onChange={(event) =>
                    setNumbers({ ...numbers, [key]: event.target.value })
                  }
                />
                <small className="tiny muted">
                  {field.instrument} · {field.basis}
                </small>
              </label>
            ),
          )}
        </div>
      )}

      {classes.length > 0 && (
        <>
          <div className="panel-heading">
            <div>
              <h2>Видимые признаки</h2>
              <p>
                Классы из каталога дефектов, применимые к этому типу. «Не
                осмотрено» и «не обнаружено» — разные ответы.
              </p>
            </div>
          </div>
          <div className="inputs-grid">
            {classes.map((item) => (
              <label className="field" key={item.id}>
                <span>{item.name}</span>
                <select
                  value={findings[item.id] ?? "unset"}
                  onChange={(event) =>
                    setFindings({
                      ...findings,
                      [item.id]: event.target.value as FindingState,
                    })
                  }
                >
                  <option value="unset">Не осмотрено</option>
                  <option value="present">Признак есть</option>
                  <option value="absent">Признак не обнаружен</option>
                </select>
              </label>
            ))}
          </div>
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
