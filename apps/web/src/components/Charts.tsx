import { useEffect, useRef, useState } from "react";
import { number } from "../api";

export function Sparkline({
  values,
  color = "var(--brand)",
}: {
  values: (number | null)[];
  color?: string;
}) {
  const known = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (known.length < 2) return <span className="support-copy">Нет ряда</span>;
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
  const element = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(750);
  const valid = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  const hasMeasurements = valid.length >= 2;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, [hasMeasurements]);
  if (!hasMeasurements)
    return (
      <div className="empty chart-empty">
        Недостаточно измерений для построения тренда
      </div>
    );
  const lower = Math.max(0, Math.min(...valid) * 0.85),
    upper = Math.max(...valid) * 1.08;
  const x = (i: number) => 52 + (i * Math.max(1, width - 68)) / Math.max(values.length - 1, 1);
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
      ref={element}
      className="trend-chart"
      viewBox={`0 0 ${width} 210`}
      role="img"
      aria-label={`Изменение показателя за 10 минут, ${unit}`}
    >
      {[0, 1, 2, 3].map((i) => {
        const v = lower + ((upper - lower) * i) / 3;
        return (
          <g key={i}>
            <line
              x1="52"
              x2={width - 16}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--divider)"
              strokeDasharray="3 4"
            />
            <text
              className="support-copy"
              x="42"
              y={y(v) + 4}
              textAnchor="end"
              fill="var(--muted)"
            >
              {number(v)}
            </text>
          </g>
        );
      })}
      <path
        d={line}
        fill="none"
        stroke="var(--brand)"
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
            fill="var(--brand)"
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
            className="support-copy"
            x={x(i)}
            y="197"
            textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
            fill="var(--muted)"
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
