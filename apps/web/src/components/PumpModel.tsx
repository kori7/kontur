import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Download, Layers, Minus, Plus, RotateCcw } from "lucide-react";
import type { Analysis, Equipment } from "../types";
import { derivePumpState, NO_DEFECTS } from "./pump3d/state";
import { derivePcpState } from "./pump3d/pcp-state";
import { modelProfile } from "./pump3d/profiles";
import type { PumpController } from "./pump3d/viewer";
import "../pump-model.css";

interface Props {
  equipment: Equipment;
  analysis: Analysis;
  onSelect(id: string): void;
}

export default function PumpModel({ equipment, analysis, onSelect }: Props) {
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
    : visualState.messages.length > 1 || visualState.messages[0] !== NO_DEFECTS;
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
  // A double tap on the model hides or shows the node numbers; a drag or pinch is not a tap.
  const tap = useRef<{ down?: { x: number; y: number }; last?: { at: number; x: number; y: number } }>({});
  const onTapDown = (event: PointerEvent) => { tap.current.down = event.isPrimary ? { x: event.clientX, y: event.clientY } : undefined; };
  const onTapUp = (event: PointerEvent) => {
    const down = tap.current.down, last = tap.current.last;
    tap.current.down = undefined;
    if (!down || (event.target as Element).closest(".model-pin") || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) { tap.current.last = undefined; return; }
    if (last && event.timeStamp - last.at < 350 && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 30) {
      tap.current.last = undefined; setShowPins(value => !value);
    } else tap.current.last = { at: event.timeStamp, x: event.clientX, y: event.clientY };
  };
  return (
    <div className="pump-model" data-model={profile.id} data-ready={ready}>
      {profile.id === "ams-pcp" && (
        <div className="model-scenario">
          <button className="model-scenario-button" aria-label="Показать разрез" aria-pressed={cutaway} disabled={!ready} onClick={() => setCutaway(value => !value)}><Layers size={18} />{cutaway ? "Закрыть разрез" : "Показать разрез"}</button>
        </div>
      )}
      <div className="model-scene" ref={stage} onPointerDown={onTapDown} onPointerUp={onTapUp}>
        {!ready && <div className="model-loading"><p>{loadError ? "3D-просмотр недоступен" : "Загружаем модель насоса"}</p><span>{loadError ? "Выберите узел в списке ниже · файл GLB доступен для скачивания" : "Геометрия и материалы агрегата"}</span></div>}
        <div className="model-annotations" hidden={!showPins || !ready}>
          <svg className="model-guides" aria-hidden="true">{profile.nodes.map(node => <g key={node.id} data-guide={node.id}><path /><circle r="3" /></g>)}</svg>
          {profile.nodes.map((node, index) => <button key={node.id} className="model-pin" data-node={node.id} aria-label={`Узел ${index + 1}: ${node.label}`} aria-pressed={selected === node.id} onClick={() => select(node.id)} title={node.label}>{index + 1}</button>)}
        </div>
      </div>
      <div className="model-view-controls">
        <p className="support-copy">{ready ? "Поверните пальцем · двойное касание скрывает номера" : "3D-модель насосного агрегата"}</p>
        <div className="model-toolbar">
          <button aria-label="Исходный вид" title="Исходный вид" disabled={!ready} onClick={() => controller.current?.reset()}><RotateCcw size={20} /></button>
          <button aria-label="Приблизить модель" title="Приблизить" disabled={!ready} onClick={() => controller.current?.zoom(0.83)}><Plus size={20} /></button>
          <button aria-label="Отдалить модель" title="Отдалить" disabled={!ready} onClick={() => controller.current?.zoom(1.2)}><Minus size={20} /></button>
          <button aria-label="Показать привязки узлов" title="Привязки узлов" aria-pressed={showPins} disabled={!ready} onClick={() => setShowPins(value => !value)}><Layers size={20} /></button>
          <a href={profile.file} download={profile.id === "ams-pcp" ? "ams-pcp-21031004.glb" : "kontur-pump-demo.glb"} aria-label="Скачать 3D-модель" title="Скачать GLB"><Download size={20} /></a>
        </div>
      </div>
      {cutaway && <p className="model-provenance">Условный разрез · внутренние узлы видны только в этом режиме</p>}
      <div className="model-node-navigation" aria-label="Узлы насоса">{profile.nodes.map((node, index) => {
        const component = equipment.components.find(item => item.id === node.id)!;
        const severity = analysis.evaluation.alerts.find(alert => alert.component_id === node.id)?.severity;
        return <button key={node.id} className="model-node" data-node={node.id} data-severity={severity} aria-label={`Открыть узел: ${component.name}`} aria-pressed={selected === node.id} onClick={() => select(node.id)}><span className="model-node-index">{index + 1}</span><span>{node.label}</span>{severity && <span className="model-node-alert" aria-label={severity === "critical" ? "Высокий риск" : "Требует проверки"} />}</button>;
      })}</div>
      <div className="model-state-note" role="status"><span className={`model-state-dot${visualState.unknown ? " unknown" : attention ? " attention" : ""}`} /><p>{visualState.messages.join(" · ")}</p></div>
      {profile.id === "ams-pcp" && <details className="model-about model-catalog"><summary>Все узлы по документации · {equipment.components.length}</summary><div className="model-catalog-grid">{equipment.components.map(component => <button key={component.id} className="model-component-button" onClick={() => {if(component.externally_visible === false && component.id !== "thermistor_relay")setCutaway(true);select(component.id);}}><span>{component.name}</span></button>)}</div></details>}
    </div>
  );
}
