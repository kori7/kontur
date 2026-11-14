import { formatCopy } from "../api";
import { useEffect, useState } from "react";
import { Printer, ScanLine } from "lucide-react";
import type { Equipment } from "../types";
import { PumpSvg } from "../components/PumpDiagram";

export function StandPanel({ equipment }: { equipment: Equipment }) {
  const [qr, setQr] = useState("");
  const value = `kontur:${equipment.id}`;
  useEffect(() => {
    let active = true;
    import("qrcode")
      .then((module) =>
        module.default.toDataURL(value, {
          width: 220,
          margin: 2,
          color: { dark: "#233b31", light: "#ffffff" },
        }),
      )
      .then((result) => {
        if (active) setQr(result);
      });
    return () => {
      active = false;
    };
  }, [value]);
  return (
    <>
      <div className="stand-card">
        {qr && <img src={qr} alt={`QR-код объекта ${equipment.id}`} />}
        <div>
          <h3>{formatCopy(equipment.name)}</h3>
          <p className="support-copy">
            QR-код идентифицирует цифровую карточку этого объекта. Маркер Hiro
            ниже используется отдельно для положения AR-меток
          </p>
          <p className="support-copy">
            {equipment.serial
              ? `Серийный номер ${equipment.serial} · идентификатор ${equipment.id}`
              : `Идентификатор ${equipment.id}`}
          </p>
          <p className="support-copy">
            Каждому объекту каталога соответствует свой QR-код. Распечатанный код
            относится только к тому объекту, для которого он сформирован
          </p>
        </div>
      </div>
      <div className="stand-preview">
        <PumpSvg />
        <img
          src="/vendor/hiro.png"
          alt="Маркер Hiro для дополненной реальности"
        />
        <p className="support-copy">
          Для AR откройте или распечатайте стенд целиком. Относительное
          положение схемы и маркера должно сохраняться. Схема на стенде построена
          для демонстрационного центробежного агрегата и другим типам
          оборудования не соответствует
        </p>
      </div>
      <div className="modal-actions">
        <a
          className="button secondary"
          href="/stand.html"
          target="_blank"
          rel="noreferrer"
        >
          <Printer size={16} />
          Открыть стенд для печати
        </a>
        <a
          className="button primary"
          href="/ar.html"
          target="_blank"
          rel="noreferrer"
        >
          <ScanLine size={16} />
          Открыть AR отдельно
        </a>
      </div>
    </>
  );
}
