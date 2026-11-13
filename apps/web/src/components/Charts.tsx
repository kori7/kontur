import { number } from "../api";

export function Sparkline({
  values,
  color = "#14705e",
}: {
  values: (number | null)[];
  color?: string;
}) {
  const known = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (known.length < 2) return <span className="muted">Нет ряда</span>;
  const min = Math.min(...known),
    range = Math.max(...known) - min || 1;
  const points = known
    .map(
      (v, i) =>
        `${(i * 96) / (known.length - 1)},${26 - ((v - min) / range) * 21}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 100 32" className="sparkline" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrendChart({
  values,
  labels,
  unit,
}: {
  values: (number | null)[];
  labels: string[];
  unit: string;
}) {
  const valid = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (valid.length < 2)
    return (
      <div className="empty chart-empty">
        Недостаточно измерений для построения тренда
      </div>
    );
  const lower = Math.max(0, Math.min(...valid) * 0.85),
    upper = Math.max(...valid) * 1.08;
  const x = (i: number) => 46 + (i * 680) / Math.max(values.length - 1, 1);
  const y = (v: number) => 169 - ((v - lower) / (upper - lower || 1)) * 136;
  let line = "";
  let gap = true;
  values.forEach((value, i) => {
    if (value === null) {
      gap = true;
    } else {
      line += `${gap ? "M" : "L"}${x(i)} ${y(value)} `;
      gap = false;
    }
  });
  return (
    <svg
      className="trend-chart"
      viewBox="0 0 750 210"
      role="img"
      aria-label={`Изменение показателя за 10 минут, ${unit}`}
    >
      {[0, 1, 2, 3].map((i) => {
        const v = lower + ((upper - lower) * i) / 3;
        return (
          <g key={i}>
            <line
              x1="46"
              x2="726"
              y1={y(v)}
              y2={y(v)}
              stroke="#e6eae5"
              strokeDasharray="3 4"
            />
            <text
              x="34"
              y={y(v) + 4}
              textAnchor="end"
              fill="#89938c"
              fontSize="11"
            >
              {number(v)}
            </text>
          </g>
        );
      })}
      <path
        d={line}
        fill="none"
        stroke="#16856f"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {values.map((v, i) =>
        v === null ? null : (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r="3"
            fill="#16856f"
            stroke="#fff"
            strokeWidth="1.5"
          />
        ),
      )}
      {[0, 3, 6, 9]
        .filter((i) => i < labels.length)
        .map((i) => (
          <text
            key={i}
            x={x(i)}
            y="197"
            textAnchor="middle"
            fill="#89938c"
            fontSize="11"
          >
            {new Date(labels[i]).toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </text>
        ))}
    </svg>
  );
}
