import type { ReactNode } from "react";

export interface Reading {
  key: string;
  label: string;
  /** A number with its unit, or an input when the engineer enters it. */
  value: ReactNode;
  norm?: string;
  source: string;
  level?: "" | "warning" | "critical";
  className?: string;
  /** Rows that switch the chart are buttons; the others are plain rows. */
  pressed?: boolean;
  onSelect?: () => void;
}

/** The «Замеры» table every object shares: parameter, value, norm, where the value comes from. */
export function ReadingRows({ rows }: { rows: Reading[] }) {
  return (
    <div className="readings" role="list">
      {rows.map((row) => {
        const body = (
          <>
            <span className="reading-name">
              <span className="reading-label">{row.label}</span>
              <small className="support-copy">{[row.norm && `норма ${row.norm}`, row.source].filter(Boolean).join(" · ")}</small>
            </span>
            <span className="reading-value">{row.value}</span>
          </>
        );
        const className = `reading ${row.level ?? ""} ${row.className ?? ""}`.trim();
        return row.onSelect ? (
          <button key={row.key} role="listitem" className={className} aria-pressed={row.pressed} onClick={row.onSelect}>
            {body}
          </button>
        ) : (
          <div key={row.key} role="listitem" className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
