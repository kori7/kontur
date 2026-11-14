import { formatCopy } from "../api";
import { useEffect, useState } from "react";
import { Printer, ScanLine } from "lucide-react";
import type { Equipment } from "../types";
import { PumpSvg } from "../components/PumpDiagram";
import { modelProfile } from "../components/pump3d/profiles";

export function StandPanel({ equipment }: { equipment: Equipment }) {
  const [qr, setQr] = useState("");
  const value = `kontur:${equipment.id}`;
  // AR labels are placed against the demo schematic and its Hiro marker; the AMS pump gets a still of its 3D model.
  const still = modelProfile(equipment)?.id === "ams-pcp" ? "/models/ams-pcp-21031004.png" : null;
  useEffect(() => {
    let active = true;
    import("qrcode")
      .then((module) =>
        module.default.toDataURL(value, {
          width: 220,
          margin: 2,
          color: { dark: "#135AA6", light: "#ffffff" },
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
            QR-код идентифицирует цифровую карточку этого объекта
            {still ? "" : ". Маркер Hiro ниже используется отдельно для положения AR-меток"}
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
        {still ? (
          <>
            <img className="stand-model" src={still} alt={`3D-модель: ${equipment.model ?? equipment.name}`} />
            <p className="support-copy">AR-метки настроены на демонстрационный стенд; этот агрегат опознаётся по QR-коду</p>
          </>
        ) : (
          <>
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
          </>
        )}
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
