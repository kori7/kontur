import { formatCopy } from "./api";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  FlaskConical,
  Gauge,
  FileText,
  LayoutDashboard,
  List,
  Loader2,
  MapPin,
  Plus,
  ScanLine,
  ScanText,
  Settings2,
  Thermometer,
  TriangleAlert,
  Waves,
  Wrench,
  Zap,
  LogOut,
  Users,
} from "lucide-react";
import { ACTIONS, request, number, date, sourceLabel, ruleLabel, inputLabel } from "./api";
import type {
  Alert,
  Analysis,
  Bootstrap,
  Equipment,
  Finding,
  InspectionEvent,
  LiveDetection,
  User,
} from "./types";
import { Modal } from "./components/Modal";
import { PumpDiagram } from "./components/PumpDiagram";
import { Sparkline, TrendChart } from "./components/Charts";
import { CameraPanel } from "./features/CameraPanel";
import { ResourceFacts } from "./components/ResourceFacts";
import { StandPanel } from "./features/StandPanel";
import { LibraryPanel } from "./features/LibraryPanel";
import { SeriesPanel } from "./features/SeriesPanel";
import { InputsPanel } from "./features/InputsPanel";
import { PassportResource } from "./components/PassportResource";
import { UsersPanel } from "./features/UsersPanel";
import { SeriesTelemetryPanel } from "./features/SeriesTelemetryPanel";
import { HistoryPanel } from "./features/HistoryPanel";
import { ObjectsPanel } from "./features/ObjectsPanel";
import { modelProfile } from "./components/pump3d/profiles";

const PumpModel = lazy(() => import("./components/PumpModel"));

type Screen = "objects" | "overview" | "history" | "series" | "library";
type Dialog = "demo" | "record" | "camera" | "about" | "stand" | "profile" | "users" | null;
const screenIds: Screen[] = ["objects", "overview", "history", "series", "library"];
// Passport and rules used to be screens of their own; old links open the matching section of the inspection.
const requestedScreen = () => new URLSearchParams(location.search).get("screen");
const readScreen = (): Screen => {
  const requested = requestedScreen() as Screen;
  return screenIds.includes(requested) ? requested : "overview";
};
const actions = ACTIONS;
const MANUAL_KINDS: Record<string, string> = {
  guard_missing: "Кожух отсутствует",
  guard_damaged: "Кожух разрушен или смещён",
  liquid_leak: "Жидкость у уплотнения",
  missing_bolt: "Отсутствует крепёж",
  loose_bolt: "Болт ослаблен (выступает)",
  oil_low: "Уровень масла ниже MIN",
  contact_damage: "Видимые повреждения контакта",
};
const metrics = [
  {
    key: "vibration",
    label: "Вибрация",
    unit: "мм/с",
    icon: Waves,
    baseline: "База 2,0 мм/с",
  },
  {
    key: "temperature",
    label: "Температура",
    unit: "°C",
    icon: Thermometer,
    baseline: "База 60 °C",
  },
  {
    key: "current_a",
    label: "Ток · фаза A",
    unit: "А",
    icon: Zap,
    baseline: "База 20 А",
  },
  {
    key: "inlet_pressure",
    label: "Давление на входе",
    unit: "бар",
    icon: Gauge,
    baseline: "База 2,0 бар",
  },
];

export default function App({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const can = (permission: string) => user.permissions.includes(permission);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [equipmentId, setEquipmentId] = useState("pump-101");
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [screen, setScreen] = useState<Screen>(readScreen);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [scenario, setScenario] = useState("normal");
  const [pendingScenario, setPendingScenario] = useState("normal");
  const [events, setEvents] = useState<InspectionEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [metric, setMetric] = useState("vibration");
  const [recordComponent, setRecordComponent] = useState("pump");
  const [recordAction, setRecordAction] = useState("inspection");
  const [note, setNote] = useState("");
  const [manualKind, setManualKind] = useState("guard_missing");
  const [manualPresent, setManualPresent] = useState(true);
  const [cameraMode, setCameraMode] = useState<"live" | "qr">("live");
  const [checksOpen, setChecksOpen] = useState(() => requestedScreen() === "rules");
  const [passportOpen, setPassportOpen] = useState(() => requestedScreen() === "equipment");

  useEffect(() => {
    const onHistory = () => {
      const nextScreen=readScreen(),nextId=new URLSearchParams(location.search).get("equipment");
      if(nextId && nextId !== equipmentId && bootstrap?.catalog.objects.some(item=>item.id===nextId && item.inspectable)) void selectEquipment(nextId,nextScreen);
      else setScreen(nextScreen);
    };
    window.addEventListener("popstate", onHistory);
    return () => window.removeEventListener("popstate", onHistory);
  }, [equipmentId,bootstrap]);
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get("screen") !== screen) {
      url.searchParams.set("screen", screen);
      window.history.pushState(null, "", url);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [screen]);
  useEffect(() => {
    if(!equipment || equipment.id !== equipmentId)return;
    const url=new URL(location.href);
    if(url.searchParams.get("equipment") !== equipmentId){url.searchParams.set("equipment",equipmentId);window.history.replaceState(null,"",url);}
  }, [equipmentId,equipment]);
  useEffect(() => {
    let active = true;
    request<Bootstrap>("/bootstrap").then(async config => {
      const requestedId=new URLSearchParams(location.search).get("equipment");
      const candidate=config.catalog.objects.find(item=>item.id===requestedId && item.inspectable);
      const target=candidate && candidate.id !== config.equipment.id ? await request<Equipment>(`/equipment/${encodeURIComponent(candidate.id)}`) : config.equipment;
      const nextScenario=target.scenarios_available ? "normal" : null;
      const [initial,history]=await Promise.all([
        request<Analysis>("/analyze",{equipment_id:target.id,scenario_id:nextScenario}),
        request<InspectionEvent[]>(`/inspections?equipment_id=${encodeURIComponent(target.id)}`)
      ]);
        if (active) {
          setBootstrap(config);
          setEquipment(target);setEquipmentId(target.id);setScenario(nextScenario??"");setRecordComponent(target.components[0]?.id??"");
          setAnalysis(initial);
          setEvents(history);
          const requestedComponent = new URLSearchParams(location.search).get('component');
          if (target.components.some(item=>item.id===requestedComponent)) setSelected(requestedComponent);
        }
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function selectEquipment(nextId: string, nextScreen: Screen = "overview") {
    if (nextId === equipmentId) return;
    setBusy(true);
    setError("");
    try {
      const target = await request<Equipment>(`/equipment/${nextId}`);
      if (!target.inspectable) {
        setToast(
          "Это позиция по проекту, а не отдельная машина. Осмотр ведётся по серийному номеру",
        );
        return;
      }
      const nextScenario = target.scenarios_available ? "normal" : null;
      const [run, history] = await Promise.all([
        request<Analysis>("/analyze", {
          equipment_id: nextId,
          scenario_id: nextScenario,
        }),
        request<InspectionEvent[]>(
          `/inspections?equipment_id=${encodeURIComponent(nextId)}`,
        ),
      ]);
      setEquipment(target);
      setEquipmentId(nextId);
      setAnalysis(run);
      setEvents(history);
      setScenario(nextScenario ?? "");
      setPendingScenario("normal");
      setSelected(null);
      setRecordComponent(target.components[0]?.id ?? "");
      setScreen(nextScreen);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function analyzeDocumented(
    measurements: Record<string, number | boolean>,
    findings: Finding[],
  ) {
    setBusy(true);
    setError("");
    try {
      const run = await request<Analysis>("/analyze", {
        equipment_id: equipmentId,
        scenario_id: null,
        measurements,
        findings,
      });
      setAnalysis(run);
      setToast("Осмотр пересчитан по введённым данным");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function analyze(
    nextScenario: string,
    manual?: { kind: string; present: boolean },
  ) {
    setBusy(true);
    setError("");
    try {
      const previousManual =
        nextScenario === scenario && manual
          ? (analysis?.observations.filter(
              (item) => item.source === "manual" && item.kind !== manual?.kind,
            ) ?? [])
          : [];
      const run = await request<Analysis>("/analyze", {
        equipment_id: equipmentId,
        scenario_id: equipment?.scenarios_available ? nextScenario : null,
        observations: [...previousManual, ...(manual ? [manual] : [])],
      });
      setAnalysis(run);
      setScenario(nextScenario);
      setScreen("overview");
      return run;
    } catch (cause) {
      setError((cause as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function applyScenario() {
    const result = await analyze(pendingScenario);
    if (result) setDialog(null);
  }
  async function saveInspection() {
    if (!analysis) return;
    setBusy(true);
    setError("");
    try {
      await request("/inspections", {
        analysis_id: analysis.id,
        equipment_id: equipmentId,
        component_id: recordComponent,
        action: recordAction,
        notes: note,
      });
      const [history, card] = await Promise.all([
        request<InspectionEvent[]>(
          `/inspections?equipment_id=${encodeURIComponent(equipmentId)}`,
        ),
        request<Equipment>(`/equipment/${equipmentId}`),
      ]);
      setEvents(history);
      setEquipment(card);
      setDialog(null);
      setNote("");
      setToast("Результат осмотра сохранён в журнале");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exportHistory() {
    const blob = new Blob(
      [
        JSON.stringify({ equipment, history: events }, null, 2),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "kontur-inspection-history.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  const component = equipment?.components.find((item) => item.id === selected);
  const catalogObjects = bootstrap?.catalog.objects ?? [];
  // Series and library show the organizer's own data, which belongs to no catalogue object.
  const objectScreen = screen === "history";
  const alerts = analysis?.evaluation.alerts ?? [];
  const profile = equipment ? modelProfile(equipment) : null;
  // Notes about where the card's data comes from: the first one stays visible, the rest fold away.
  const notices = [
    // The demo pump's own notice only repeats that it is a demo; the scenario button already says so.
    ...(equipment && !equipment.documented && equipment.source !== "demo" ? [equipment.notice] : []),
    ...(equipment?.limitations ?? []),
  ].filter(Boolean);
  // Where to point the camera first: components named by triggered rules, most severe first.
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  const cameraHints = [...alerts]
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
    .filter((alert, index, list) => list.findIndex((item) => item.component_id === alert.component_id) === index)
    .slice(0, 3)
    .map((alert) => ({
      component: alert.component_id,
      name: equipment?.components.find((item) => item.id === alert.component_id)?.name ?? alert.component_id,
      reason: alert.title,
      severity: alert.severity,
    }));
  // The component a detected sign belongs to on this equipment, for opening its card from a box.
  const componentOf = (kind: string) => {
    const candidates: Record<string, string[]> = {
      guard_missing: ["guard"],
      guard_damaged: ["guard"],
      liquid_leak: ["seal", "seal_housing"],
      seal_leak_excessive: ["seal", "seal_housing"],
      oil_leak_at_housing: ["gearbox_housing", "bearing"],
      frame_corrosion: ["base", "frame", "motor_frame", "gearbox_housing"],
      missing_bolt: ["base", "stud"],
      loose_bolt: ["base", "stud"],
    };
    return (candidates[kind] ?? []).find((id) => equipment?.components.some((item) => item.id === id)) ?? null;
  };
  async function analyzeSeries(index: number) {
    setBusy(true);
    setError("");
    try {
      // A negative index asks for «now»: the I/O server when one is configured, otherwise the latest record.
      setAnalysis(await request<Analysis>("/analyze", {
        equipment_id: equipmentId, scenario_id: null, series_index: index < 0 ? null : index,
      }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openChecks() {
    setChecksOpen(true);
    requestAnimationFrame(() => document.getElementById("checks")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function openCamera(mode: "live" | "qr") {
    setCameraMode(mode);
    setDialog("camera");
  }
  // What the engineer decided at the pump goes to the journal, so the master sees rejections too.
  async function journalNote(analysisId: string, componentId: string, notes: string) {
    try {
      await request("/inspections", {
        analysis_id: analysisId, equipment_id: equipmentId, component_id: componentId, action: "inspection", notes,
      });
      setEvents(await request<InspectionEvent[]>(`/inspections?equipment_id=${encodeURIComponent(equipmentId)}`));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function confirmLiveFinding(item: LiveDetection, frame: string, detectorName: string) {
    setError("");
    try {
      const manual = analysis?.observations
        .filter((entry) => entry.source === "manual")
        .map((entry) => ({ kind: entry.kind, present: entry.present })) ?? [];
      const result = await request<{ analysis: Analysis; component_id: string }>("/live/findings", {
        equipment_id: equipmentId,
        scenario_id: equipment?.scenarios_available ? scenario : null,
        kind: item.kind,
        label: item.label,
        confidence: item.confidence,
        detector: detectorName,
        image: frame,
        observations: manual,
      });
      const [history, card] = await Promise.all([
        request<InspectionEvent[]>(`/inspections?equipment_id=${encodeURIComponent(equipmentId)}`),
        request<Equipment>(`/equipment/${equipmentId}`),
      ]);
      setAnalysis(result.analysis);
      setEvents(history);
      setEquipment(card);
      const name = card.components.find((entry) => entry.id === result.component_id)?.name ?? result.component_id;
      setToast(`Записано в журнал: ${item.label} — ${name}, с кадром`);
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    }
  }
  const critical = alerts.some((item) => item.severity === "critical");
  const insufficient =
    analysis?.evaluation.rule_results.filter(
      (item) => item.status === "insufficient",
    ).length ?? 0;
  const evaluated =
    analysis?.evaluation.rule_results.filter(
      (item) => item.status !== "not_applicable",
    ).length ?? 0;
  const last = analysis?.telemetry.samples.at(-1);
  const currentMetric = metrics.find((item) => item.key === metric)!;
  const sampleValues = (key: string): (number | null)[] =>
    analysis?.telemetry.samples.map((item) =>
      typeof item[key] === "number" ? (item[key] as number) : null,
    ) ?? [];
  const missingGuard = analysis?.observations.some(
    (item) => item.kind === "guard_missing" && item.present,
  );
  const leak = analysis?.observations.some(
    (item) => item.kind === "liquid_leak" && item.present,
  );
  const maintenance = analysis?.evaluation.maintenance;
  const selectedAlerts = alerts.filter(
    (item) => item.component_id === selected,
  );

  return (
    <div className="app-shell" data-screen={screen}>
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            setScreen("overview");
          }}
          aria-label="КОНТУР — главная"
        >
          <span>
            КОНТУР<small className="support-copy">ИНЖЕНЕРНЫЙ КОНТРОЛЬ</small>
          </span>
        </a>
        <nav aria-label="Основная навигация">
          {(
            [
              { id: "objects", label: "Объекты", short: "Объекты", icon: List },
              { id: "overview", label: "Осмотр оборудования", short: "Осмотр", icon: LayoutDashboard },
              { id: "history", label: "Журнал осмотров", short: "Журнал", icon: ClipboardCheck },
            ] as const
          )
            .map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              aria-current={screen === item.id ? "page" : undefined}
              className={`nav-item ${screen === item.id ? "active" : ""}`}
              onClick={() => setScreen(item.id)}
            >
              <item.icon size={18} />
              <span className="nav-label-full">{item.label}</span>
              <span className="nav-label-short" aria-hidden="true">
                {item.short}
              </span>
              {item.id === "history" && events.length > 0 ? (
                <span className="nav-count">{events.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        {can("users") && (
          <div className="sidebar-bottom">
            <button className="nav-item" onClick={() => setDialog("users")}>
              <Users size={18} />Учётные записи
            </button>
          </div>
        )}
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-identity">
            <img className="app-logo" src="/brand/kontur-mark.png" alt="Логотип КОНТУР" width="88" height="39" />
            <span className="company-wordmark" aria-label="КСТ Энерго Инжиниринг">
              <span>КСТ ЭНЕРГО</span>
              <span>ИНЖИНИРИНГ</span>
            </span>
          </div>
          <div className="topbar-actions">
            <div className="demo-controls">
            {equipment?.scenarios_available && (
              <>
                <button
                  className="button subtle small"
                  aria-label="Демосценарии"
                  onClick={() => {
                    setPendingScenario(scenario);
                    setDialog("demo");
                  }}
                >
                  <Settings2 size={15} />
                  <span className="demo-control-label">Демосценарии</span>
                  <span className="demo-control-short" aria-hidden="true">Демо</span>
                </button>
              </>
            )}
            </div>
            <button className="worker-profile" aria-label="Профиль работника" onClick={() => setDialog("profile")}>
              <img src="/brand/employee-avatar.webp" alt="" width="48" height="48" />
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={18} />
              <span>{formatCopy(error)}</span>
              <button onClick={() => setError("")}>Закрыть</button>
            </div>
          )}
          {!equipment || !analysis ? (
            <div className="loading-screen">
              <Loader2 className="spin" size={28} />
              <h2>
                {error
                  ? "Не удалось загрузить данные"
                  : "Загружаем рабочую область"}
              </h2>
              <p className="support-copy">Карточка оборудования, измерения и история осмотров</p>
              {error && (
                <button
                  className="button primary"
                  onClick={() => location.reload()}
                >
                  Повторить
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>
                    {screen === "history"
                      ? "Журнал осмотров"
                      : screen === "objects"
                        ? "Объекты"
                        : screen === "series"
                          ? "Ряды измерений"
                          : screen === "library"
                            ? "Переданные материалы"
                            : equipment.name}
                  </h1>
                  {screen === "overview" ? (
                    <div className="equipment-meta">
                      {equipment.type_name !== equipment.name && (
                        <span className="equipment-type support-copy">{equipment.type_name}</span>
                      )}
                      {equipment.documented && equipment.serial && (
                        <span className="equipment-type support-copy">Зав. № {equipment.serial}</span>
                      )}
                      <p className="location support-copy">
                        <MapPin size={14} />
                        {equipment.location}
                      </p>
                    </div>
                  ) : objectScreen && (
                    // The journal names the object it shows; the round itself lists every object.
                    <div className="equipment-meta">
                      <span className="equipment-type support-copy">
                        {equipment.name}
                        {equipment.documented && equipment.serial ? ` · ${equipment.serial}` : ""}
                      </span>
                    </div>
                  )}
                </div>
                {screen === "overview" && (
                  <div className="page-actions">
                    <button
                      className="button primary"
                      onClick={() => openCamera("live")}
                    >
                      <Camera size={17} />
                      Начать осмотр
                    </button>
                    <button className="button secondary" onClick={() => openCamera("qr")}>
                      <ScanText size={17} />
                      Опознать
                    </button>
                  </div>
                )}
              </div>

              {screen === "objects" && (
                <ObjectsPanel
                  currentId={equipmentId}
                  refresh={events.length}
                  onOpen={(id) => (id === equipmentId ? setScreen("overview") : void selectEquipment(id))}
                />
              )}

              {screen === "overview" && notices.length > 0 && (
                <section className="equipment-context" aria-label="О данных объекта">
                  {(
                    <div className="equipment-notices">
                      <p className="object-note support-copy">
                        <TriangleAlert size={20} /> <span>{formatCopy(notices[0])}</span>
                      </p>
                      {notices.length > 1 && (
                        <details className="object-notes-more">
                          <summary className="support-copy">Ещё о данных: {notices.length - 1}</summary>
                          {notices.slice(1).map((text) => (
                            <p className="object-note support-copy" key={text}>
                              <CircleHelp size={20} /> <span>{formatCopy(text)}</span>
                            </p>
                          ))}
                        </details>
                      )}
                    </div>
                  )}
                </section>
              )}

              {screen === "overview" && (
                <>
                  <div
                    className={`status-strip ${critical ? "critical" : alerts.length ? "warning" : insufficient || evaluated === 0 ? "insufficient" : "normal"}`}
                  >
                    <div className="status-copy">
                      {alerts.length || insufficient || evaluated === 0 ? (
                        <TriangleAlert size={19} />
                      ) : (
                        <CheckCircle2 size={19} />
                      )}
                      <strong>
                        {critical
                          ? "Обнаружены признаки высокого риска"
                          : alerts.length
                            ? "Рекомендуется проверка"
                            : evaluated === 0
                              ? "Правил для этого типа оборудования пока нет"
                              : insufficient === evaluated
                                ? "Данных недостаточно для оценки"
                                : insufficient
                                  ? "Часть проверок недоступна"
                                  : "Отклонений по доступным данным нет"}
                      </strong>
                      <span className="support-copy">
                        {alerts.length
                          ? `${alerts.length} предупрежд. · откройте основания`
                          : evaluated === 0
                            ? "Насосные правила к этому типу не применяются · осмотр ведётся вручную"
                            : "Предварительный анализ · исправность не подтверждена"}
                      </span>
                    </div>
                    <span className="updated support-copy">
                      <Clock3 size={13} />
                      {date(analysis.created_at)}
                    </span>
                    {evaluated > 0 && (
                      <button className="text-button status-checks" onClick={openChecks}>
                        Проверки <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                  {equipment.telemetry && (
                    <SeriesTelemetryPanel equipment={equipment} analysis={analysis} busy={busy}
                      onRecord={(index) => void analyzeSeries(index)} service={can("series")} />
                  )}
                  {!equipment.scenarios_available && !equipment.telemetry && (
                    <InputsPanel
                      key={equipmentId}
                      equipment={equipment}
                      busy={busy}
                      onSubmit={analyzeDocumented}
                    />
                  )}
                  <div className="inspection-grid">
                    <section className={`panel equipment-panel${profile ? " equipment-panel--3d" : ""}`}>
                      <div className="panel-heading panel-heading--responsive">
                        <div>
                          <h2>Карта состояния</h2>
                        </div>
                      </div>
                      {profile ? (
                        <Suspense fallback={<div className="pump-model-loading support-copy">Загружаем 3D-модель насоса</div>}>
                          <PumpModel
                            equipment={equipment}
                            analysis={analysis}
                            onSelect={setSelected}
                          />
                        </Suspense>
                      ) : equipment.components.some((item) => item.position) ? (
                        <PumpDiagram
                          components={equipment.components}
                          alerts={alerts}
                          onSelect={setSelected}
                          guardMissing={missingGuard}
                          leak={leak}
                        />
                      ) : (
                        <div className="component-grid">
                          <p className="object-note support-copy">
                            <CircleHelp size={14} /> Чертежей в комплекте нет — узлы
                            списком
                          </p>
                          {equipment.components.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`component-chip${
                                alerts.some((alert) => alert.component_id === item.id)
                                  ? " warning"
                                  : ""
                              }${item.externally_visible ? "" : " hidden-part"}`}
                              onClick={() => setSelected(item.id)}
                            >
                              <strong>{formatCopy(item.name)}</strong>
                              <small className="support-copy">
                                {item.code}
                                {item.quantity && item.quantity > 1
                                  ? ` · ${item.quantity} шт`
                                  : ""}
                                {item.externally_visible ? "" : " · снаружи не виден"}
                              </small>
                            </button>
                          ))}
                        </div>
                      )}
                      {/* The legend explains the flat diagram's colours; the 3D model marks parts its own way. */}
                      {!profile && (
                      <div className="diagram-footer">
                        <div className="legend support-copy">
                          <span>
                            <i className="legend-dot normal" />
                            Узел
                          </span>
                          <span>
                            <i className="legend-dot warning" />
                            Проверка
                          </span>
                          <span>
                            <i className="legend-dot critical" />
                            Высокий риск
                          </span>
                        </div>
                      </div>
                      )}
                    </section>
                  {equipment.scenarios_available && (
                  <div className="metrics-grid">
                    {metrics.map((item) => {
                      const v = last?.[item.key];
                      const warning =
                        typeof v === "number" &&
                        (item.key === "temperature"
                          ? v > 70
                          : item.key === "vibration"
                            ? v > 3
                            : item.key === "inlet_pressure"
                              ? v < 1.7
                              : v > 22);
                      return (
                        <button
                          key={item.key}
                          className={`metric-card ${metric === item.key ? "selected" : ""}`}
                          aria-pressed={metric === item.key}
                          onClick={() => setMetric(item.key)}
                        >
                          <div className="metric-label">
                            <item.icon size={17} />
                            <span className="metric-name">{item.label}</span>
                            {metric === item.key
                              ? <CheckCircle2 className="metric-selection" size={16} aria-hidden="true" />
                              : <ArrowUpRight className="metric-selection" size={16} aria-hidden="true" />}
                          </div>
                          <div className="metric-main">
                            <span>
                              {number(v)}
                              <small className="support-copy">{item.unit}</small>
                            </span>
                            <Sparkline
                              values={sampleValues(item.key)}
                              color={warning ? "var(--warning)" : "var(--brand)"}
                            />
                          </div>
                          <p className="support-copy">
                            {item.baseline}
                            <span
                              className={`small-dot ${warning ? "amber" : ""}`}
                            />
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  )}
                    {/* With nothing triggered the status strip has already said so; an empty panel would repeat it. */}
                    {alerts.length > 0 && (
                    <section className="panel findings-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            Требует внимания{" "}
                            <span className="count-badge">{alerts.length}</span>
                          </h2>
                        </div>
                        <Activity size={19} className="muted" />
                      </div>
                      <div className="findings-list">
                        {alerts.map((alert) => (
                          <Finding
                            key={alert.id}
                            alert={alert}
                            onClick={() => setSelected(alert.component_id)}
                          />
                        ))}
                      </div>
                      {(
                        <div className="findings-footer support-copy">
                          <span>{insufficient ? `${insufficient} правил: недостаточно данных` : `Оценено правил: ${evaluated}`}</span>
                          <button className="text-button" onClick={openChecks}>
                            Все правила
                            <ArrowRight size={13} />
                          </button>
                        </div>
                      )}
                    </section>
                    )}
                  </div>
                  {!equipment.scenarios_available && !equipment.telemetry && (
                    <PassportResource equipment={equipment} />
                  )}
                  {equipment.scenarios_available && (
                  <div className="secondary-grid">
                    <section className="panel trend-panel">
                      <div className="panel-heading panel-heading--responsive">
                        <div>
                          <h2>Динамика измерений</h2>
                          <p className="support-copy">
                            {currentMetric.label} · {currentMetric.unit}
                          </p>
                        </div>
                        <span className="tag panel-meta support-copy">
                          <Clock3 size={12} />
                          10 минут
                        </span>
                      </div>
                      <TrendChart
                        values={sampleValues(metric)}
                        labels={analysis.telemetry.samples.map(
                          (item) => item.at,
                        )}
                        unit={currentMetric.unit}
                      />
                    </section>
                    <section className="panel service-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Эксплуатационный ресурс</h2>
                        </div>
                        <Wrench size={18} className="muted" />
                      </div>
                      <div className="resource-body">
                      <div className="resource-number">
                        <span className="resource-value">{number(maintenance?.runtime_hours, 0)}</span>{" "}
                        <small className="support-copy">моточасов</small>
                      </div>
                      <div className="progress-track">
                        <span
                          style={{
                            width: `${Math.min(100, ((maintenance?.runtime_hours ?? 0) / (maintenance?.norm_hours || 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="resource-range">
                        <span className="support-copy">Наработка агрегата</span>
                        <span className="support-copy">
                          {number(maintenance?.norm_hours, 0)} ч · норматив
                        </span>
                      </div>
                      <div className="service-next">
                          <strong>
                            {maintenance?.runtime_hours == null
                              ? "Недостаточно данных о наработке"
                              : analysis.telemetry.last_service_hours == null ? "Нет сведений о последнем ТО"
                              : maintenance?.due_in_hours == null ? "Дальнейший график ТО не задан"
                              : maintenance.due_in_hours <= 0
                                ? "Срок обслуживания наступил"
                                : `До следующего ТО: ${number(maintenance.due_in_hours, 0)} ч`}
                          </strong>
                          <p className="support-copy">
                            Нормативный остаток:{" "}
                            {number(maintenance?.remaining_hours, 0)} ч
                          </p>
                      </div>
                      <p className="resource-caveat support-copy">Не прогноз времени до отказа</p>
                      </div>
                    </section>
                  </div>
                  )}
                  <div className="inspection-bottom">
                    <span className="support-copy">
                      <ClipboardCheck size={17} />
                      {events.length
                        ? `Последняя запись: ${date(events[0].created_at)}`
                        : "Осмотр ещё не зарегистрирован"}
                    </span>
                    <button
                      className="button primary"
                      onClick={() => {
                        // "pump" is the whole-aggregate узел of the demo object only.
                        setRecordComponent(
                          equipment.components.some((item) => item.id === "pump")
                            ? "pump"
                            : (equipment.components[0]?.id ?? ""),
                        );
                        setDialog("record");
                      }}
                    >
                      <Plus size={17} />
                      Записать результат
                    </button>
                  </div>
                </>
              )}

              {screen === "overview" && (
                <details className="panel section-fold" id="checks" open={checksOpen}
                  onToggle={(event) => setChecksOpen(event.currentTarget.open)}>
                  <summary>
                    <h2>
                      Проверки <span className="count-badge">{analysis.evaluation.rule_results.length}</span>
                    </h2>
                    <span className="support-copy">
                      {insufficient ? `Без данных: ${insufficient}` : alerts.length ? `Сработало: ${alerts.length}` : "Все оценены"}
                    </span>
                  </summary>
                  <p className="support-copy section-fold-note">
                    Нет входа — проверка отвечает «нет данных», а не «норма»
                  </p>
                  <div className="rules-list">
                    {analysis.evaluation.rule_results.map((rule) => {
                      const matching = alerts.find((item) =>
                        item.rule_ids.includes(rule.id),
                      );
                      const scenarioInfo = bootstrap?.scenarios.find(
                        (item) => item.id === rule.id.toLowerCase(),
                      );
                      return (
                        <article key={rule.id} className="rule-row">
                          <span className="rule-id">{ruleLabel(rule.id)}</span>
                          <div>
                            <h3>
                              {rule.title ??
                                scenarioInfo?.title ??
                                matching?.title ??
                                "Диагностическое правило"}
                            </h3>
                            {(can("reports") || !rule.basis) && (
                              <p className="support-copy">
                                {formatCopy(rule.basis
                                  ? `Основание: ${rule.basis}`
                                  : scenarioInfo?.description)}
                              </p>
                            )}
                            {rule.missing.length > 0 && (
                              <small className="support-copy">
                                Не хватает: {[...new Set(rule.missing.map((key) => inputLabel(key, equipment)))].join(", ")}
                              </small>
                            )}
                            {rule.reason && <small className="support-copy">{formatCopy(rule.reason)}</small>}
                          </div>
                          <span className={`rule-status ${rule.status}`}>
                            {rule.status === "triggered"
                              ? "Сработало"
                              : rule.status === "clear"
                                ? "Не сработало"
                                : rule.status === "not_applicable"
                                  ? "Неприменимо"
                                  : "Нет данных"}
                          </span>
                        </article>
                      );
                    })}
                  </div>
                </details>
              )}

              {screen === "overview" && (
                <details className="panel section-fold" id="passport" open={passportOpen}
                  onToggle={(event) => setPassportOpen(event.currentTarget.open)}>
                  <summary>
                    <h2>Паспорт и документы</h2>
                    <span className="support-copy">{equipment.components.length} узлов</span>
                  </summary>
                  <section className="panel passport">
                    <div>
                      <h2>{equipment.model ?? equipment.name}</h2>
                      {equipment.source !== "demo" && <p className="support-copy">{formatCopy(equipment.notice)}</p>}
                      <div className="passport-grid">
                        <div>
                          <small className="support-copy">Заводской номер</small>
                          <strong>{equipment.serial ?? "не указан"}</strong>
                        </div>
                        <div>
                          <small className="support-copy">Среда</small>
                          <strong>{equipment.medium}</strong>
                        </div>
                        <div>
                          <small className="support-copy">Мощность</small>
                          <strong>
                            {equipment.power_kw === null
                              ? "не указана"
                              : `${number(equipment.power_kw, 0)} кВт`}
                          </strong>
                        </div>
                        <div>
                          <small className="support-copy">Частота вращения</small>
                          <strong>
                            {equipment.speed_rpm === null
                              ? "не указана"
                              : `${number(equipment.speed_rpm, 0)} об/мин`}
                          </strong>
                        </div>
                        <div>
                          <small className="support-copy">Ввод в эксплуатацию</small>
                          <strong>
                            {equipment.commissioned_at ?? "неизвестен"}
                          </strong>
                        </div>
                        <div>
                          <small className="support-copy">Источник карточки</small>
                          <strong>
                            {equipment.documented
                              ? "Паспорт изготовителя"
                              : "Демонстрационные данные"}
                          </strong>
                        </div>
                      </div>
                      {(equipment.document_links ?? []).length > 0 && (
                        <ul className="passport-documents">
                          {(equipment.document_links ?? []).map((link) => (
                            <li key={link.id}>
                              <a className="text-button" href={`/api/library/${link.id}/file`}
                                target={link.viewable ? "_blank" : undefined} rel="noreferrer">
                                <FileText size={16} /> {formatCopy(link.title)}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                      {can("reports") && (
                        <button className="button secondary small passport-stand" onClick={() => setDialog("stand")}>
                          <ScanLine size={16} />
                          QR и AR-стенд
                        </button>
                      )}
                      {profile?.id === "ams-pcp" && (
                        <details className="model-about">
                          <summary>О 3D-модели</summary>
                          <div className="model-provenance">
                            <p>Реконструкция по установочному и сборочному чертежам · manuals-017, листы 6–8</p>
                            <p>Чертёж: 2530 × 340 × 759 мм</p>
                            <p>Паспорт: 2742 × 360 × 605 мм</p>
                            <p>Размеры документов расходятся · модель следует чертежу</p>
                            <p>Неразмерённые детали восстановлены по скану · заводские допуски не заданы</p>
                          </div>
                        </details>
                      )}
                    </div>
                    <div className="passport-symbol">
                      <Box size={78} strokeWidth={1} />
                    </div>
                  </section>
                  <section className="panel component-table">
                    <div className="panel-heading">
                      <div>
                        <h2>Узлы и комплектующие</h2>
                        {equipment.components.every((item) => !item.installed_at && !item.last_replacement) && (
                          <p className="support-copy">Даты установки узлов неизвестны</p>
                        )}
                      </div>
                      <span className="tag">
                        {equipment.components.length} компонентов
                      </span>
                    </div>
                    {equipment.components.map((item) => (
                      <button
                        className="component-row"
                        key={item.id}
                        onClick={() => setSelected(item.id)}
                      >
                        <span className="component-code">{item.code}</span>
                        <strong>{formatCopy(item.name)}</strong>
                        <span className="support-copy">
                          {item.last_replacement
                            ? "Заменён " +
                              date(item.last_replacement.created_at)
                            : item.installed_at
                              ? "Ввод: " + item.installed_at
                              : ""}
                        </span>
                        <span>
                          {item.norm_hours === null
                            ? "норматив не задан"
                            : `${number(item.norm_hours, 0)} ч`}
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </section>
                </details>
              )}

              {screen === "history" && (
                <HistoryPanel
                  equipment={equipment}
                  events={events}
                  objects={catalogObjects}
                  analysisId={analysis.id}
                  can={can}
                  onRecord={() => setDialog("record")}
                  onExport={exportHistory}
                  onOpenObject={(id) => {
                    if (id === equipmentId) setScreen("overview");
                    else void selectEquipment(id);
                  }}
                />
              )}

              {screen === "series" && <SeriesPanel />}

              {screen === "library" && <LibraryPanel />}

              <footer className="page-footer support-copy">
                <span>КОНТУР · Кибер 102</span>
              </footer>
            </>
          )}
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {dialog === "demo" && (
        <Modal
          title="Демонстрационные сценарии"
          onClose={() => setDialog(null)}
        >
          <label className="field">
            Сценарий демонстрации
            <select
              value={pendingScenario}
              onChange={(event) => setPendingScenario(event.target.value)}
            >
              {bootstrap?.scenarios.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatCopy(item.title)}
                </option>
              ))}
            </select>
          </label>
          <div className="info-box">
            {
              formatCopy(bootstrap?.scenarios.find((item) => item.id === pendingScenario)
                ?.description)
            }
          </div>
          <p className="support-copy">
            Ручные наблюдения сбросятся, журнал останется
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Отмена
            </button>
            <button
              className="button primary"
              onClick={applyScenario}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <FlaskConical size={16} />
              )}
              Применить сценарий
            </button>
          </div>
        </Modal>
      )}
      {dialog === "record" && (
        <Modal
          title="Записать результат осмотра"
          onClose={() => setDialog(null)}
        >
          <label className="field">
            Компонент
            <select
              value={recordComponent}
              onChange={(event) => setRecordComponent(event.target.value)}
            >
              {equipment?.components.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatCopy(item.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Выполненное действие
            <select
              value={recordAction}
              onChange={(event) => setRecordAction(event.target.value)}
            >
              {Object.entries(actions)
                .filter(([key]) => !["maintenance", "replacement"].includes(key) || can("record_maintenance"))
                .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Комментарий
            <textarea
              rows={4}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Что проверили, что обнаружили и какие работы выполнены"
            />
          </label>
          {recordAction === "replacement" && (
            <p className="info-box support-copy">
              Замена будет отмечена в карточке выбранного компонента. История
              предыдущих осмотров сохранится
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Отмена
            </button>
            <button
              className="button primary"
              onClick={saveInspection}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              Сохранить осмотр
            </button>
          </div>
        </Modal>
      )}
      {dialog === "camera" && (
        <Modal title="Визуальный осмотр" wide onClose={() => setDialog(null)}>
          <CameraPanel
            alerts={alerts}
            hints={cameraHints}
            componentOf={componentOf}
            onConfirm={confirmLiveFinding}
            onReject={(item) => {
              const component = componentOf(item.kind) ?? equipment?.components[0]?.id;
              if (analysis && component) void journalNote(analysis.id, component, `Камера: «${item.label}» — не дефект, отклонено инженером`);
            }}
            initialMode={cameraMode}
            debug={can("users")}
            objects={catalogObjects}
            currentId={equipmentId}
            onSelectObject={(id) => {
              setDialog(null);
              selectEquipment(id);
            }}
            onComponent={(id) => {
              if (equipment?.components.some(item=>item.id===id)) {
                setDialog(null);
                setSelected(id);
              }
            }}
          />
          <details className="manual-section">
            <summary>Добавить наблюдение инженера</summary>
            <div className="manual-fields">
              <select
                aria-label="Визуальный признак"
                value={manualKind}
                onChange={(event) => setManualKind(event.target.value)}
              >
                {Object.entries(MANUAL_KINDS).map(([kind, label]) => (
                  <option key={kind} value={kind}>{label}</option>
                ))}
              </select>
              <select
                aria-label="Наличие признака"
                value={String(manualPresent)}
                onChange={(event) =>
                  setManualPresent(event.target.value === "true")
                }
              >
                <option value="true">Признак наблюдается</option>
                <option value="false">Признак не наблюдается</option>
              </select>
              <button
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  const result = await analyze(scenario, {
                    kind: manualKind,
                    present: manualPresent,
                  });
                  if (result) {
                    setDialog(null);
                    setToast("Наблюдение учтено и записано в журнал");
                    const component = result.observations.find(
                      (item) => item.source === "manual" && item.kind === manualKind,
                    )?.component_id;
                    if (component) {
                      void journalNote(result.id, component,
                        `Наблюдение инженера: ${MANUAL_KINDS[manualKind].toLowerCase()} — ${manualPresent ? "наблюдается" : "не наблюдается"}`);
                    }
                  }
                }}
              >
                Учесть в диагностике
              </button>
            </div>
          </details>
        </Modal>
      )}
      {dialog === "stand" && equipment && (
        <Modal
          title="Идентификация и AR-стенд"
          wide
          onClose={() => setDialog(null)}
        >
          <StandPanel equipment={equipment} />
        </Modal>
      )}
      {dialog === "profile" && (
        <Modal title="Профиль работника" onClose={() => setDialog(null)}>
          <div className="profile-menu">
            <img src="/brand/employee-avatar.webp" alt="Профиль работника" width="112" height="112" />
            <div className="profile-who">
              <strong>{user.name}</strong>
              <span className="support-copy">{user.role_name} · {user.email}</span>
            </div>
            <div className="profile-actions">
              {can("users") && (
                <button className="button secondary" onClick={() => setDialog("users")}>
                  <Users size={20} />Учётные записи
                </button>
              )}
              {/* The organizer's raw tables and files: reference for whoever prepares data, not a round screen. */}
              {can("series") && (
                <button className="button secondary" onClick={() => { setDialog(null); setScreen("series"); }}>
                  <Activity size={20} />Ряды организатора
                </button>
              )}
              {can("library") && (
                <button className="button secondary" onClick={() => { setDialog(null); setScreen("library"); }}>
                  <BookOpen size={20} />Материалы организатора
                </button>
              )}
              {equipment?.scenarios_available && (
                <button className="button secondary" onClick={() => { setPendingScenario(scenario); setDialog("demo"); }}>
                  <Settings2 size={20} />Демосценарии
                </button>
              )}
              <button className="button secondary" onClick={() => setDialog("about")}>
                <CircleHelp size={20} />О проекте
              </button>
              <button className="button secondary" onClick={onSignOut}>
                <LogOut size={20} />Выйти
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === "users" && (
        <Modal title="Учётные записи" wide onClose={() => setDialog(null)}>
          <UsersPanel me={user} />
        </Modal>
      )}
      {dialog === "about" && (
        <Modal
          title="КОНТУР · единый инструмент инженера"
          onClose={() => setDialog(null)}
        >
          <p className="support-copy">
            Камера, данные датчиков и регламент оборудования в одном осмотре.
            Прототип для «Кибер 102», задача КСТ Энерго Инжиниринг
          </p>
          <a
            className="button secondary"
            href="/presentation.html"
            target="_blank"
            rel="noreferrer"
          >
            <BookOpen size={16} />
            Открыть презентацию
            <ArrowUpRight size={15} />
          </a>
        </Modal>
      )}

      {component && (
        <Modal title={component.name} onClose={() => setSelected(null)}>
          <div className="component-detail-head">
            <span className="component-code">{component.code}</span>
          </div>
          {selectedAlerts.length ? (
            selectedAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`diagnostic-detail ${alert.severity}`}
              >
                <span className="eyebrow">{alert.rule_ids.map(ruleLabel).join(" + ")}</span>
                <h3>{formatCopy(alert.title)}</h3>
                <p className="support-copy">{formatCopy(alert.hypothesis)}</p>
                <h4>Основания</h4>
                <ul className="evidence-list">
                  {alert.evidence.map((item, i) => (
                    <li key={i}>
                      <span>
                        {item.label}
                        <small className="support-copy">{sourceLabel(item.source)}</small>
                      </span>
                      <strong>
                        {String(item.value)}
                        <small className="support-copy">
                          {item.threshold ? `Условие: ${item.threshold}` : ""}
                        </small>
                      </strong>
                    </li>
                  ))}
                </ul>
                <div className="recommendation">
                  <Wrench size={18} />
                  <p className="support-copy">{formatCopy(alert.recommendation)}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="info-box">Предупреждений по узлу нет</div>
          )}
          <div className="detail-facts">
            <div>
              <small className="support-copy">Нормативный срок</small>
              <strong>
                {component.norm_hours === null
                  ? "не задан"
                  : `${number(component.norm_hours, 0)} ч`}
              </strong>
            </div>
            <div>
              <small className="support-copy">Установка / замена</small>
              <strong>
                {component.last_replacement
                  ? date(component.last_replacement.created_at)
                  : (component.installed_at ?? "дата неизвестна")}
              </strong>
            </div>
          </div>
          <ResourceFacts component={component} runtime={analysis?.telemetry.runtime_hours ?? null}/>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => {
                setSelected(null);
                openCamera("live");
              }}
            >
              <Camera size={16} />
              Осмотреть
            </button>
            <button
              className="button primary"
              onClick={() => {
                setRecordComponent(component.id);
                setSelected(null);
                setDialog("record");
              }}
            >
              <ClipboardCheck size={16} />
              Записать результат
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Finding({ alert, onClick }: { alert: Alert; onClick: () => void }) {
  return (
    <button className={`finding ${alert.severity}`} onClick={onClick}>
      <span className="finding-icon">
        {alert.severity === "info" ? (
          <Clock3 size={17} />
        ) : (
          <TriangleAlert size={17} />
        )}
      </span>
      <span className="finding-content">
        <span className="finding-title">
          {formatCopy(alert.title)}
          <ChevronRight size={15} />
        </span>
        <span className="finding-description support-copy">{formatCopy(alert.hypothesis)}</span>
        <span className="finding-rule support-copy">
          {alert.rule_ids.map(ruleLabel).join(" + ")} <span>Открыть основания</span>
        </span>
      </span>
    </button>
  );
}
