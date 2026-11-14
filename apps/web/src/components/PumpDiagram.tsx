import { formatCopy } from "../api";
import type { Alert, Component } from "../types";

export function PumpSvg({
  guardMissing = false,
  leak = false,
}: {
  guardMissing?: boolean;
  leak?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 900 420"
      role="img"
      aria-label="Схематическое изображение насосного агрегата"
    >
      <defs>
        <linearGradient id="motor" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#A6BDCD" />
          <stop offset=".45" stopColor="#E1E9EF" />
          <stop offset="1" stopColor="#718FA8" />
        </linearGradient>
        <linearGradient id="housing" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#C4D3DE" />
          <stop offset=".48" stopColor="#819FB8" />
          <stop offset="1" stopColor="#476D8E" />
        </linearGradient>
        <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#E7EBEE" />
          <stop offset=".5" stopColor="#A2B2BF" />
          <stop offset="1" stopColor="#5D7182" />
        </linearGradient>
        <linearGradient id="guard" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#e7d69c" />
          <stop offset="1" stopColor="#c4ad6c" />
        </linearGradient>
        <filter id="shadow">
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <pattern id="mesh" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.3" fill="#786d45" opacity=".45" />
        </pattern>
      </defs>
      <ellipse
        cx="461"
        cy="334"
        rx="310"
        ry="19"
        fill="#263D50"
        opacity=".12"
        filter="url(#shadow)"
      />
      <g stroke="#526A7D" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M127 294L731 294 779 322 165 322Z" fill="#C0CBD5" />
        <path d="M165 322H779V340H165Z" fill="#8399AC" />
        <path d="M127 294L165 322V340L127 312Z" fill="#9AAEBF" />
        <path d="M178 307V318M725 307V318" strokeWidth="8" />
        <ellipse cx="178" cy="306" rx="9" ry="4" fill="#546B7E" />
        <ellipse cx="725" cy="306" rx="9" ry="4" fill="#546B7E" />
        <path d="M212 260V300H247V264M330 259V300H365V259" fill="#7594AD" />
        <rect
          x="176"
          y="171"
          width="196"
          height="113"
          rx="21"
          fill="url(#motor)"
        />
        <ellipse cx="176" cy="227" rx="29" ry="55" fill="#88A5BB" />
        <ellipse cx="173" cy="227" rx="21" ry="43" fill="#597B97" />
        <ellipse cx="173" cy="227" rx="15" ry="36" fill="#A4BBCD" />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
          <path
            key={i}
            d={`M${207 + i * 15} 177V276`}
            stroke="#487497"
            opacity=".55"
            strokeWidth="2.5"
          />
        ))}
        <ellipse cx="373" cy="227" rx="22" ry="55" fill="#779AB7" />
        <ellipse cx="381" cy="227" rx="13" ry="31" fill="url(#metal)" />
        <path d="M247 172V146L314 146 324 157V176" fill="#6286A3" />
        <path d="M247 146L262 136H325V163L314 176V146" fill="#A7BDCF" />
        <rect
          x="262"
          y="143"
          width="39"
          height="16"
          rx="2"
          fill="#DEE7EE"
          stroke="none"
        />
        <path d="M395 220H588V235H395Z" fill="url(#metal)" />
        <rect x="439" y="204" width="54" height="45" rx="7" fill="#7C8A96" />
        {[452, 465, 478].map((x) => (
          <path key={x} d={`M${x} 207V247`} stroke="#435767" strokeWidth="3" />
        ))}
        {!guardMissing && (
          <g>
            <path
              d="M411 267V217Q412 187 450 184H475Q515 187 519 217V267Z"
              fill="url(#guard)"
            />
            <path
              d="M411 267V217Q412 187 450 184H475Q515 187 519 217V267Z"
              fill="url(#mesh)"
            />
            <path d="M405 267H524V278H405Z" fill="#b19b5e" />
          </g>
        )}
        <path d="M548 250V298H588V246" fill="#799284" />
        <rect
          x="534"
          y="195"
          width="79"
          height="66"
          rx="14"
          fill="url(#metal)"
        />
        <ellipse cx="611" cy="228" rx="13" ry="33" fill="#6c8b7c" />
        <rect x="551" y="178" width="26" height="22" rx="4" fill="#7e9586" />
        <rect x="554" y="167" width="20" height="14" rx="4" fill="#d2d7b7" />
        <path d="M625 252V299H671V251M695 251V299H718V252" fill="#668875" />
        <path
          d="M627 187Q634 142 687 145Q739 148 747 206V241Q733 278 686 279Q638 276 626 243Z"
          fill="url(#housing)"
        />
        <ellipse cx="639" cy="217" rx="36" ry="51" fill="#83a594" />
        <ellipse cx="642" cy="217" rx="27" ry="41" fill="#9fbaac" />
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i * Math.PI) / 3;
          return (
            <circle
              key={i}
              cx={642 + 29 * Math.cos(a)}
              cy={217 + 44 * Math.sin(a)}
              r="3.8"
              fill="#557664"
            />
          );
        })}
        <path d="M688 154V102H725V172" fill="url(#housing)" />
        <path d="M678 98H735V111H678Z" fill="#8eac9a" />
        <ellipse cx="706" cy="98" rx="29" ry="8" fill="#b6c9b9" />
        <ellipse cx="706" cy="98" rx="19" ry="4" fill="#476e5b" />
        <path d="M744 207H806V241H744" fill="url(#metal)" />
        <ellipse cx="806" cy="224" rx="10" ry="29" fill="#7F9BB4" />
        <ellipse cx="808" cy="224" rx="5" ry="19" fill="#365A7A" />
        <path d="M667 170V107" fill="none" strokeWidth="7" stroke="#8298AA" />
        <circle cx="667" cy="90" r="22" fill="#CCD5DD" />
        <circle cx="667" cy="90" r="17" fill="#F4F5F8" />
        <path
          d="M656 95A12 12 0 1 1 678 95"
          fill="none"
          stroke="#6D8294"
          strokeDasharray="1 4"
        />
        <path d="M667 91L673 80" stroke="#355C7D" strokeWidth="2" />
        <circle cx="667" cy="91" r="2" fill="#355C7D" />
        <rect
          x="651"
          y="252"
          width="39"
          height="12"
          rx="2"
          fill="#D8E1E8"
          stroke="none"
        />
      </g>
      {leak && (
        <g fill="#6bb1c3" opacity=".8">
          <path d="M619 260Q607 278 619 285Q631 278 619 260Z" />
          <ellipse cx="622" cy="301" rx="28" ry="7" />
          <path d="M606 289Q600 297 606 301Q612 298 606 289Z" />
        </g>
      )}
    </svg>
  );
}

export function PumpDiagram({
  components,
  alerts,
  onSelect,
  guardMissing,
  leak,
}: {
  components: Component[];
  alerts: Alert[];
  onSelect: (id: string) => void;
  guardMissing?: boolean;
  leak?: boolean;
}) {
  // The схема is drawn for the demo centrifugal unit, so only its узлы carry diagram coordinates.
  const displayed = components.filter(
    (item): item is Component & { position: [number, number] } =>
      item.position !== null &&
      ["motor", "guard", "bearing", "seal", "base", "gauge", "inlet"].includes(
        item.id,
      ),
  );
  return (
    <div className="pump-diagram">
      <div className="diagram-canvas">
        <PumpSvg guardMissing={guardMissing} leak={leak} />
        {displayed.map((item) => {
          const alert = alerts.find((value) => value.component_id === item.id);
          return (
            <button
              key={item.id}
              className={`hotspot ${alert?.severity ?? "normal"}`}
              style={{
                left: `${item.position[0]}%`,
                top: `${item.position[1]}%`,
              }}
              onClick={() => onSelect(item.id)}
              aria-label={`Открыть узел: ${item.name}`}
              title={item.name}
            >
              <span className="hotspot-dot" />
              <span className="hotspot-label">{formatCopy(item.name)}</span>
            </button>
          );
        })}
      </div>
      <div className="diagram-caption support-copy">
        <span>КОНТУР / Н-101</span>
        <span>ДЕМО-СХЕМА · 01</span>
      </div>
    </div>
  );
}
