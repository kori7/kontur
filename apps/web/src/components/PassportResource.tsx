import { Wrench } from "lucide-react";
import { number } from "../api";
import type { Equipment } from "../types";

const units: Record<string, string> = { year: "лет", month: "мес", hour: "ч" };

export function PassportResource({ equipment }: { equipment: Equipment }) {
  const resource = equipment.resource ?? {};
  const rows: { label: string; value: string; source: string }[] = [];
  if (resource.resource_to_writeoff) {
    const item = resource.resource_to_writeoff;
    rows.push({
      label: "Ресурс до списания",
      value: `${item.comparator === ">=" ? "не менее " : ""}${number(item.value, 0)} ${units[item.unit] ?? item.unit}`,
      source: item.source,
    });
  }
  if (resource.service_life) {
    const item = resource.service_life;
    rows.push({
      label: "Срок службы",
      value: `${item.value} ${units[item.unit] ?? item.unit}`,
      source: item.source,
    });
  }
  if (resource.warranty) {
    const item = resource.warranty;
    rows.push({
      label: "Гарантия",
      value: `${item.value} ${units[item.unit] ?? item.unit} с ввода в эксплуатацию`,
      source: item.source,
    });
  }
  if (resource.wear_parts_limit) {
    const item = resource.wear_parts_limit;
    rows.push({
      label: "Быстроизнашиваемые детали",
      value: `${item.value_months} мес при ${number(item.value_hours, 0)} ч`,
      source: item.source,
    });
  }
  return (
    <section className="panel service-panel">
      <div className="panel-heading">
        <div>
          <h2>Эксплуатационный ресурс</h2>
          <p>Значения паспорта изготовителя</p>
        </div>
        <Wrench size={18} className="muted" />
      </div>
      {rows.length === 0 ? (
        <p className="tiny muted resource-caveat">
          Нормативных сроков для этого объекта в переданных документах нет.
        </p>
      ) : (
        <ul className="assessment-list">
          {rows.map((row) => (
            <li key={row.label}>
              <div>
                <strong>{row.label}</strong>
                <small>{row.source}</small>
              </div>
              <span className="rule-status below_warning">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="tiny muted resource-caveat" style={{ marginTop: 12 }}>
        {equipment.commissioned_at
          ? `Ввод в эксплуатацию: ${equipment.commissioned_at}.`
          : "Дата ввода в эксплуатацию не указана, поэтому наработка и остаток не рассчитываются."}{" "}
        Нормативный срок не является прогнозом времени до отказа.
      </p>
    </section>
  );
}
