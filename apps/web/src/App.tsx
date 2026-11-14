import { formatCopy } from "./api";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
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
  Cpu,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Loader2,
  MapPin,
  Plus,
  ScanLine,
  Settings2,
  ShieldCheck,
  Thermometer,
  TriangleAlert,
  Waves,
  Wrench,
  Zap,
  LogOut,
  Users,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { request, number, date, sourceLabel, ruleLabel, inputLabel } from "./api";
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

type Screen =
  | "overview"
  | "history"
  | "equipment"
  | "rules"
  | "series"
  | "library";
type Dialog = "demo" | "record" | "camera" | "about" | "stand" | "profile" | "users" | null;
const actions: Record<string, string> = {
  inspection: "Проверка",
  defect: "Замечание",
  maintenance: "Обслуживание",
  replacement: "Замена",
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
  const [screen, setScreen] = useState<Screen>("overview");
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

  useEffect(() => {
    let active = true;
    Promise.all([
      request<Bootstrap>("/bootstrap"),
      request<Analysis>("/analyze", { equipment_id: "pump-101", scenario_id: "normal" }),
      request<InspectionEvent[]>("/inspections?equipment_id=pump-101"),
    ])
      .then(([config, initial, history]) => {
        if (active) {
          setBootstrap(config);
          setEquipment(config.equipment);
          setAnalysis(initial);
          setEvents(history);
          const requestedComponent = new URLSearchParams(location.search).get('component');
          if (config.equipment.components.some(item=>item.id===requestedComponent)) setSelected(requestedComponent);
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

  async function selectEquipment(nextId: string) {
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
      setScreen("overview");
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
  const objectScreen = screen !== "series" && screen !== "library";
  const alerts = analysis?.evaluation.alerts ?? [];
  // Notes about where the card's data comes from: the first one stays visible, the rest fold away.
  const notices = [
    ...(equipment && !equipment.documented ? [equipment.notice] : []),
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
    <div className="app-shell">
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
        <div className="workspace-tag">
          <span className="support-copy">Демонстрационный стенд</span>
        </div>
        <p className="nav-caption support-copy">РАБОЧАЯ ОБЛАСТЬ</p>
        <nav aria-label="Основная навигация">
          {(
            [
              {
                id: "overview",
                label: "Обзор оборудования",
                icon: LayoutDashboard,
              },
              { id: "equipment", label: "Цифровой паспорт", icon: Box },
              { id: "history", label: "Журнал осмотров", icon: ClipboardCheck },
              { id: "rules", label: "Правила диагностики", icon: Cpu },
              { id: "series", label: "Ряды измерений", icon: Activity },
              { id: "library", label: "Материалы", icon: BookOpen },
            ] as const
          )
            // Service screens are for the master and the administrator, not on the inspector's path.
            .filter((item) => (item.id !== "series" || can("series")) && (item.id !== "library" || can("library")))
            .map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${screen === item.id ? "active" : ""}`}
              onClick={() => setScreen(item.id)}
            >
              <item.icon size={18} />
              <span className="nav-label-full">{item.label}</span>
              <span className="nav-label-short" aria-hidden="true">
                {{ overview: "Обзор", equipment: "Паспорт", history: "Журнал", rules: "Правила", series: "Ряды", library: "Файлы" }[item.id]}
              </span>
              {item.id === "history" && events.length > 0 ? (
                <span className="nav-count">{events.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setDialog("about")}>
            <CircleHelp size={18} />О проекте
          </button>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-identity">
            <img className="app-logo" src="/brand/kontur-mark.png" alt="Логотип КОНТУР" width="88" height="39" />
            <span className="company-wordmark" aria-label="КСТ Энерго Инжиниринг">
              <span>КСТ ЭНЕРГО</span>
              <span>ИНЖИНИРИНГ</span>
            </span>
            <div className="breadcrumb support-copy">
            Рабочая область
            <ChevronRight size={14} />
            <strong>
              {screen === "history"
                ? "Журнал осмотров"
                : screen === "rules"
                  ? "Диагностика"
                  : screen === "equipment"
                    ? "Цифровой паспорт"
                    : screen === "series"
                      ? "Ряды измерений"
                      : screen === "library"
                        ? "Переданные материалы"
                        : "Обзор оборудования"}
            </strong>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="demo-controls">
            {equipment?.scenarios_available && (
              <>
                <span className="demo-indicator support-copy">
                  <FlaskConical size={13} />
                  Демоданные
                </span>
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
                      : screen === "rules"
                        ? "Правила диагностики"
                        : screen === "series"
                          ? "Ряды измерений"
                          : screen === "library"
                            ? "Переданные материалы"
                            : screen === "equipment"
                              ? "Цифровой паспорт"
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
                    // The object picker and its notes live on the overview; other screens name the object once.
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
                      className="button secondary"
                      onClick={() => setDialog("stand")}
                    >
                      <ScanLine size={17} />
                      QR и AR-стенд
                    </button>
                    <button
                      className="button primary"
                      onClick={() => setDialog("camera")}
                    >
                      <Camera size={17} />
                      Начать осмотр
                    </button>
                  </div>
                )}
              </div>

              {screen === "overview" && (
                <section className="equipment-context" aria-label="Контекст осмотра">
                  <label className="object-picker">
                    <span>Объект осмотра</span>
                    <select
                      value={equipmentId}
                      disabled={busy}
                      onChange={(event) => selectEquipment(event.target.value)}
                    >
                      {catalogObjects.map((item) => (
                        <option key={item.id} value={item.id} disabled={!item.inspectable}>
                          {item.documented && item.serial ? `${item.serial} · ${item.type_name}` : item.name}
                          {item.documented ? "" : item.source === "team" ? " · основной" : " · демо"}
                          {item.inspectable ? "" : " · позиция по проекту"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {notices.length > 0 && (
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
                  </div>
                  {equipment.telemetry && (
                    <SeriesTelemetryPanel equipment={equipment} analysis={analysis} busy={busy}
                      onRecord={(index) => void analyzeSeries(index)} />
                  )}
                  {!equipment.scenarios_available && !equipment.telemetry && (
                    <InputsPanel
                      key={equipmentId}
                      equipment={equipment}
                      busy={busy}
                      onSubmit={analyzeDocumented}
                    />
                  )}
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
                          onClick={() => setMetric(item.key)}
                        >
                          <div className="metric-label">
                            <item.icon size={17} />
                            {item.label}
                            <ArrowUpRight size={14} />
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
                  <div className="inspection-grid">
                    <section className="panel equipment-panel">
                      <div className="panel-heading panel-heading--responsive">
                        <div>
                          <h2>Карта состояния</h2>
                          <p className="support-copy">Выберите узел, чтобы посмотреть подробности</p>
                        </div>
                        <span className="tag panel-meta support-copy">{equipment.serial ?? equipment.id}</span>
                      </div>
                      {equipment.components.some((item) => item.position) ? (
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
                    </section>
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
                        {alerts.length ? (
                          alerts.map((alert) => (
                            <Finding
                              key={alert.id}
                              alert={alert}
                              onClick={() => setSelected(alert.component_id)}
                            />
                          ))
                        ) : (
                          <div className="clear-state">
                            <span>
                              <ShieldCheck size={30} />
                            </span>
                            <h3>Предупреждений нет</h3>
                          </div>
                        )}
                      </div>
                      <div className="findings-footer support-copy">
                        <span>
                          {evaluated === 0
                            ? "Применимых правил нет"
                            : insufficient
                              ? `${insufficient} правил: недостаточно данных`
                              : `Оценено правил: ${evaluated}`}
                        </span>
                        <button
                          className="text-button"
                          onClick={() => setScreen("rules")}
                        >
                          Все правила
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    </section>
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
                          <p className="support-copy">Демонстрационный регламент</p>
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
                    {can("reports") && (
                      <div className="report-links">
                        <ReportLinks equipmentId={equipmentId} analysisId={analysis.id} />
                      </div>
                    )}
                  </div>
                </>
              )}

              {screen === "equipment" && (
                <>
                  <section className="panel passport">
                    <div>
                      <div className="eyebrow">ЦИФРОВАЯ КАРТОЧКА</div>
                      <h2>{equipment.model ?? equipment.name}</h2>
                      <p className="support-copy">{formatCopy(equipment.notice)}</p>
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
                      {(equipment.documents ?? []).length > 0 && (
                        <p className="support-copy" style={{ marginTop: 14 }}>
                          Документы в комплекте:{" "}
                          {(equipment.documents ?? []).join(", ")}
                        </p>
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
                </>
              )}

              {screen === "history" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        История работ{" "}
                        <span className="count-badge">{events.length}</span>
                      </h2>
                      <p className="support-copy">С исходными данными каждого осмотра</p>
                    </div>
                    <div className="report-actions">
                      {can("reports") && <ReportLinks equipmentId={equipmentId} analysisId={analysis.id} />}
                      <button
                        className="button secondary small"
                        onClick={exportHistory}
                        disabled={!events.length}
                      >
                        <ArrowDownToLine size={15} />
                        JSON
                      </button>
                    </div>
                  </div>
                  {events.length ? (
                    events.map((event) => (
                      <article key={event.id} className="history-item">
                        <span className="history-icon">
                          <ClipboardCheck size={18} />
                        </span>
                        <div>
                          <div className="history-title">
                            <h3>
                              {actions[event.action]} ·{" "}
                              {
                                formatCopy(equipment.components.find(
                                  (item) => item.id === event.component_id,
                                )?.name)
                              }
                            </h3>
                            <span className="support-copy">
                              {date(event.created_at)}
                            </span>
                          </div>
                          <p className="support-copy">{formatCopy(event.notes || "Без комментария")}</p>
                          <div className="history-meta support-copy">
                            <span>{event.author}</span>
                            <span>{event.analysis.scenario_title}</span>
                            <span>
                              {event.analysis.evaluation.alerts.length}{" "}
                              предупрежд
                            </span>
                          </div>
                          <details>
                            <summary>Основания на момент осмотра</summary>
                            <div className="evidence-history">
                              {event.analysis.image_id && <figure className="saved-evidence"><img src={`/api/images/${event.analysis.image_id}`} alt="Исходный снимок осмотра" loading="lazy"/><figcaption className="support-copy">Исходный снимок, сохранённый с результатом осмотра</figcaption></figure>}
                              {event.analysis.evaluation.alerts.map((alert) => (
                                <div key={alert.id}>
                                  <strong>
                                    {alert.rule_ids.map(ruleLabel).join(", ")} · {formatCopy(alert.title)}
                                  </strong>
                                  <p className="support-copy">{formatCopy(alert.hypothesis)}</p>
                                </div>
                              ))}
                              {!event.analysis.evaluation.alerts.length && (
                                <p className="support-copy">
                                  По доступным данным предупреждения не
                                  сформированы
                                </p>
                              )}
                              <p className="support-copy">
                                Наработка:{" "}
                                {number(
                                  event.analysis.telemetry.runtime_hours,
                                  0,
                                )}{" "}
                                ч
                              </p>
                            </div>
                          </details>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty">
                      <ClipboardCheck size={36} />
                      <h3>Здесь появится история оборудования</h3>
                      <p className="support-copy">
                        Зарегистрируйте первый осмотр, обслуживание или замену
                      </p>
                      <button
                        className="button primary"
                        onClick={() => setDialog("record")}
                      >
                        Записать результат
                      </button>
                    </div>
                  )}
                </section>
              )}

              {screen === "rules" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Правила для этого объекта{" "}
                        <span className="count-badge">{analysis.evaluation.rule_results.length}</span>
                      </h2>
                      <p className="support-copy">
                        Нет входа — правило отвечает «нет данных», а не «норма»
                      </p>
                    </div>
                    <Cpu size={22} />
                  </div>
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
                            <p className="support-copy">
                              {formatCopy(rule.basis
                                ? `Основание: ${rule.basis}`
                                : scenarioInfo?.description)}
                            </p>
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
                </section>
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
          <p className="modal-intro support-copy">
            Воспроизводимые измерения и признаки для проверки технологии. Все
            данные синтетические
          </p>
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
            Переключение сценария сбрасывает анализ снимка и ручные наблюдения.
            Сохранённая история остаётся
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
          <p className="modal-intro support-copy">
            Сохраним измерения, предупреждения и ваше действие в истории
            оборудования
          </p>
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
            <p className="support-copy">
              Источник будет обозначен как ручное наблюдение
            </p>
            <div className="manual-fields">
              <select
                aria-label="Визуальный признак"
                value={manualKind}
                onChange={(event) => setManualKind(event.target.value)}
              >
                <option value="guard_missing">Кожух отсутствует</option>
                <option value="guard_damaged">Кожух разрушен или смещён</option>
                <option value="liquid_leak">Жидкость у уплотнения</option>
                <option value="missing_bolt">Отсутствует крепёж</option>
                <option value="loose_bolt">Болт ослаблен (выступает)</option>
                <option value="oil_low">Уровень масла ниже MIN</option>
                <option value="contact_damage">
                  Видимые повреждения контакта
                </option>
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
                    setToast("Наблюдение инженера учтено");
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
          <div className="about-lead">
            <ShieldCheck size={36} />
            <p className="support-copy">
              Камера, данные датчиков и регламент оборудования соединены в одном
              процессе осмотра
            </p>
          </div>
          <p className="support-copy">
            Прототип для хакатона «Кибер 102», задача КСТ Энерго Инжиниринг.
            Предобученные модели разрешены организаторами; демонстрационные
            данные подготовлены самостоятельно
          </p>
          <div className="info-box">
            Изображение → видимые признаки → сопоставление с измерениями →
            гипотеза → решение инженера → история
          </div>
          <p className="support-copy">
            Автоматически анализируются отсутствие кожуха, признаки жидкости у
            уплотнения и отсутствие крепежа. Остальные визуальные сценарии
            используют демоданные или ручные наблюдения
          </p>
          <p className="support-copy">
            AR привязан к маркеру демонстрационного стенда. Отсутствие видимых
            проблем не подтверждает исправность. Все нормы требуют сверки с
            документацией изготовителя
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
            <span className="tag">{formatCopy(component.norm_source)}</span>
          </div>
          {selectedAlerts.length ? (
            selectedAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`diagnostic-detail ${alert.severity}`}
              >
                <span className="eyebrow">
                  {alert.rule_ids.map(ruleLabel).join(" + ")} · ДИАГНОСТИЧЕСКАЯ ГИПОТЕЗА
                </span>
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
            <div className="info-box">
              Для этого узла предупреждений по доступным данным нет. Визуальный
              осмотр и проверка по регламенту остаются необходимыми
            </div>
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
                setDialog("camera");
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

/** Report export: Excel downloads, PDF opens a print-ready page the browser saves as PDF. */
function ReportLinks({ equipmentId, analysisId }: { equipmentId: string; analysisId: string }) {
  const query = `?analysis_id=${encodeURIComponent(analysisId)}`;
  const base = `/api/reports/${encodeURIComponent(equipmentId)}`;
  return (
    <>
      <a className="button secondary small" href={`${base}.xlsx${query}`} download>
        <FileSpreadsheet size={15} />
        Excel
      </a>
      <a className="button secondary small" href={`${base}/print${query}`} target="_blank" rel="noreferrer">
        <FileText size={15} />
        PDF
      </a>
    </>
  );
}
