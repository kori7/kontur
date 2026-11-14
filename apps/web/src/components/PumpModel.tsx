import { useEffect, useRef, useState } from "react";
import { Download, FlaskConical, Layers, Minus, Plus, RotateCcw } from "lucide-react";
import { formatCopy, number } from "../api";
import type { Analysis, Equipment } from "../types";
import { derivePumpState } from "./pump3d/state";
import { derivePcpState } from "./pump3d/pcp-state";
import { modelProfile } from "./pump3d/profiles";
import type { PumpController } from "./pump3d/viewer";
import "../pump-model.css";

interface Props {
  equipment: Equipment;
  analysis: Analysis;
  scenarioTitle: string;
  onSelect(id: string): void;
  onDemo(): void;
}

export default function PumpModel({ equipment, analysis, scenarioTitle, onSelect, onDemo }: Props) {
  const profile = modelProfile(equipment)!;
  const stage = useRef<HTMLDivElement>(null);
  const controller = useRef<PumpController | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [showPins, setShowPins] = useState(true);
  const [selected, setSelected] = useState(profile.initialPart);
  const [cutaway, setCutaway] = useState(false);
  const visualState = profile.id === "ams-pcp" ? derivePcpState(analysis) : derivePumpState(analysis);
  const attention = "dtsTemperature" in visualState
    ? visualState.heatParts.length > 0 || visualState.guardMissing || visualState.sealLeak || visualState.flangeLeak || visualState.fastenerWarning || visualState.bootDamage || visualState.corrosionParts.length > 0
    : visualState.messages.length > 1 || visualState.messages[0] !== "Демонстрационный режим · без заданных дефектов";
  const latest = useRef({ visualState, selected, cutaway, onSelect }); latest.current = { visualState, selected, cutaway, onSelect };
  useEffect(() => {
    const abort = new AbortController();
    setReady(false); setLoadError(false); setSelected(profile.initialPart); setCutaway(false);
    import("./pump3d/viewer").then(module => module.mountPump(stage.current!, id => {
      setSelected(id); latest.current.onSelect(id);
    }, abort.signal, profile)).then(instance => {
      if (abort.signal.aborted) { instance.dispose(); return; }
      controller.current = instance; instance.state(latest.current.visualState); instance.select(latest.current.selected); instance.cutaway(latest.current.cutaway); setReady(true);
    }).catch(error => {
      if (!abort.signal.aborted && error.name !== "AbortError") setLoadError(true);
    });
    return () => { abort.abort(); controller.current?.dispose(); controller.current = null; };
  }, [equipment.id]);
  useEffect(() => { controller.current?.state(profile.id === "ams-pcp" ? derivePcpState(analysis) : derivePumpState(analysis)); }, [analysis]);
  useEffect(() => { controller.current?.select(selected); }, [selected]);
  useEffect(() => { controller.current?.cutaway(cutaway); }, [cutaway]);
  const select = (id: string) => { setSelected(id); onSelect(id); };
  return (
    <div className="pump-model" data-model={profile.id} data-ready={ready}>
      <div className="model-scenario">
        <div><p>{profile.id === "ams-pcp" ? "AMS PCP60S12/3 · проект 21031004" : formatCopy(scenarioTitle)}</p></div>
        {profile.id === "ams-pcp" ? <button className="model-scenario-button" aria-label="Показать разрез" aria-pressed={cutaway} disabled={!ready} onClick={() => setCutaway(value => !value)}><Layers size={18} />{cutaway ? "Закрыть разрез" : "Показать разрез"}</button> : <button className="model-scenario-button" aria-label="Выбрать демосценарий" onClick={onDemo}><FlaskConical size={18} />Демосценарии</button>}
      </div>
      <div className="model-scene" ref={stage}>
        {!ready && <div className="model-loading"><p>{loadError ? "3D-просмотр недоступен" : "Загружаем модель насоса"}</p><span>{loadError ? "Выберите узел в списке ниже · файл GLB доступен для скачивания" : "Геометрия и материалы агрегата"}</span></div>}
        <div className="model-annotations" hidden={!showPins || !ready}>
          <svg className="model-guides" aria-hidden="true">{profile.nodes.map(node => <g key={node.id} data-guide={node.id}><path /><circle r="3" /></g>)}</svg>
          {profile.nodes.map((node, index) => <button key={node.id} className="model-pin" data-node={node.id} aria-label={`Узел ${index + 1}: ${node.label}`} aria-pressed={selected === node.id} onClick={() => select(node.id)} title={node.label}>{index + 1}</button>)}
        </div>
      </div>
      <div className="model-view-controls">
        <p className="support-copy">{ready ? "Поверните мышью или пальцем" : "3D-модель насосного агрегата"}</p>
        <div className="model-toolbar">
          <button aria-label="Исходный вид" title="Исходный вид" disabled={!ready} onClick={() => controller.current?.reset()}><RotateCcw size={20} /></button>
          <button aria-label="Приблизить модель" title="Приблизить" disabled={!ready} onClick={() => controller.current?.zoom(0.83)}><Plus size={20} /></button>
          <button aria-label="Отдалить модель" title="Отдалить" disabled={!ready} onClick={() => controller.current?.zoom(1.2)}><Minus size={20} /></button>
          <button aria-label="Показать привязки узлов" title="Привязки узлов" aria-pressed={showPins} disabled={!ready} onClick={() => setShowPins(value => !value)}><Layers size={20} /></button>
          <a href={profile.file} download={profile.id === "ams-pcp" ? "ams-pcp-21031004.glb" : "kontur-pump-demo.glb"} aria-label="Скачать 3D-модель" title="Скачать GLB"><Download size={20} /></a>
        </div>
      </div>
      <div className="model-specs"><span><strong>{number(equipment.power_kw)}</strong> кВт</span><span><strong>{number(equipment.speed_rpm)}</strong> об/мин</span><span>{equipment.medium}</span><span className="model-gauge-reading">{"gaugePressure" in visualState ? <>Манометр <strong>{number(visualState.gaugePressure)}</strong> бар</> : <>DTS <strong>{number(visualState.dtsTemperature)}</strong> °C</>}</span></div>
      {cutaway && <p className="model-provenance">Условный разрез · внутренние узлы видны только в этом режиме</p>}
      <div className="model-node-navigation" aria-label="Узлы насоса">{profile.nodes.map((node, index) => {
        const component = equipment.components.find(item => item.id === node.id)!;
        const severity = analysis.evaluation.alerts.find(alert => alert.component_id === node.id)?.severity;
        return <button key={node.id} className="model-node" data-node={node.id} data-severity={severity} aria-label={`Открыть узел: ${component.name}`} aria-pressed={selected === node.id} onClick={() => select(node.id)}><span className="model-node-index">{index + 1}</span><span>{node.label}</span>{severity && <span className="model-node-alert" aria-label={severity === "critical" ? "Высокий риск" : "Требует проверки"} />}</button>;
      })}</div>
      <div className="model-state-note" role="status"><span className={`model-state-dot${visualState.unknown ? " unknown" : attention ? " attention" : ""}`} /><p>{visualState.messages.join(" · ")}</p></div>
      {profile.id === "ams-pcp" && <details className="model-about model-catalog"><summary>Все узлы по документации · {equipment.components.length}</summary><div className="model-catalog-grid">{equipment.components.map(component => <button key={component.id} className="model-component-button" onClick={() => {if(component.externally_visible === false && component.id !== "thermistor_relay")setCutaway(true);select(component.id);}}><span>{component.name}</span></button>)}</div></details>}
      <details className="model-about"><summary>О 3D-модели</summary>{profile.id === "ams-pcp" ? <div className="model-provenance"><p>Реконструкция по установочному и сборочному чертежам · manuals-017, листы 6–8</p><p>Чертёж: 2530 × 340 × 759 мм</p><p>Паспорт: 2742 × 360 × 605 мм</p><p>Размеры документов расходятся · модель следует чертежу</p><p>Неразмерённые детали восстановлены по скану · заводские допуски не заданы</p></div> : <p className="model-provenance">Иллюстративная геометрия · размеры не подтверждены сборочным чертежом</p>}</details>
    </div>
  );
}
