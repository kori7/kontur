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
} from "lucide-react";
import { request, number, date, sourceLabel } from "./api";
import type {
  Alert,
  Analysis,
  Bootstrap,
  InspectionEvent,
  VisionResult,
} from "./types";
import { Modal } from "./components/Modal";
import { PumpDiagram } from "./components/PumpDiagram";
import { Sparkline, TrendChart } from "./components/Charts";
import { CameraPanel } from "./features/CameraPanel";
import { ResourceFacts } from "./components/ResourceFacts";
import { StandPanel } from "./features/StandPanel";

type Screen = "overview" | "history" | "equipment" | "rules";
type Dialog = "demo" | "record" | "camera" | "about" | "stand" | null;
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
    baseline: "Базовое значение 2,0 мм/с",
  },
  {
    key: "temperature",
    label: "Температура",
    unit: "°C",
    icon: Thermometer,
    baseline: "Базовое значение 60 °C",
  },
  {
    key: "current_a",
    label: "Ток · фаза A",
    unit: "А",
    icon: Zap,
    baseline: "Базовое значение 20 А",
  },
  {
    key: "inlet_pressure",
    label: "Давление на входе",
    unit: "бар",
    icon: Gauge,
    baseline: "Базовое значение 2,0 бар",
  },
];

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
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
  const [vision, setVision] = useState<VisionResult | null>(null);
  const [inspectionImage, setInspectionImage] = useState<string | null>(null);
  const [recordComponent, setRecordComponent] = useState("pump");
  const [recordAction, setRecordAction] = useState("inspection");
  const [note, setNote] = useState("");
  const [manualKind, setManualKind] = useState("guard_missing");
  const [manualPresent, setManualPresent] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      request<Bootstrap>("/bootstrap"),
      request<Analysis>("/analyze", { scenario_id: "normal" }),
      request<InspectionEvent[]>("/inspections"),
    ])
      .then(([config, initial, history]) => {
        if (active) {
          setBootstrap(config);
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

  async function analyze(
    nextScenario: string,
    nextVision?: VisionResult,
    manual?: { kind: string; present: boolean },
  ) {
    setBusy(true);
    setError("");
    try {
      const previousManual =
        nextScenario === scenario && (manual || nextVision)
          ? (analysis?.observations.filter(
              (item) => item.source === "manual" && item.kind !== manual?.kind,
            ) ?? [])
          : [];
      const run = await request<Analysis>("/analyze", {
        scenario_id: nextScenario,
        vision_id: nextVision?.id,
        observations: [...previousManual, ...(manual ? [manual] : [])],
        image: manual ? inspectionImage : undefined,
      });
      setAnalysis(run);
      setScenario(nextScenario);
      setVision(nextVision ?? null);
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
    if (result) {setDialog(null);setInspectionImage(null);}
  }
  async function saveInspection() {
    if (!analysis) return;
    setBusy(true);
    setError("");
    try {
      await request("/inspections", {
        analysis_id: analysis.id,
        component_id: recordComponent,
        action: recordAction,
        notes: note,
      });
      const [history, config] = await Promise.all([
        request<InspectionEvent[]>("/inspections"),
        request<Bootstrap>("/bootstrap"),
      ]);
      setEvents(history);
      setBootstrap(config);
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
        JSON.stringify(
          { equipment: bootstrap?.equipment, history: events },
          null,
          2,
        ),
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
  const equipment = bootstrap?.equipment;
  const component = equipment?.components.find((item) => item.id === selected);
  const alerts = analysis?.evaluation.alerts ?? [];
  const critical = alerts.some((item) => item.severity === "critical");
  const insufficient =
    analysis?.evaluation.rule_results.filter(
      (item) => item.status === "insufficient",
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
          <span className="brand-mark">К</span>
          <span>
            КОНТУР<small>ИНЖЕНЕРНЫЙ КОНТРОЛЬ</small>
          </span>
        </a>
        <div className="workspace-tag">
          <span className="workspace-icon">
            <Box size={17} />
          </span>
          <div>
            КСТ Энерго<small>Демонстрационный стенд</small>
          </div>
        </div>
        <p className="nav-caption">РАБОЧАЯ ОБЛАСТЬ</p>
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
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${screen === item.id ? "active" : ""}`}
              onClick={() => setScreen(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "history" && events.length > 0 ? (
                <span className="nav-count">{events.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <ShieldCheck size={21} />
            <strong>Решение — за инженером</strong>
            <p>Система помогает оценить признаки и выбрать следующий шаг.</p>
          </div>
          <button className="nav-item" onClick={() => setDialog("about")}>
            <CircleHelp size={18} />О проекте
          </button>
          <div className="profile">
            <span className="avatar">ДИ</span>
            <div>
              Демо-инженер<small>Инженер по обслуживанию</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Рабочая область
            <ChevronRight size={14} />
            <strong>
              {screen === "history"
                ? "Журнал осмотров"
                : screen === "rules"
                  ? "Диагностика"
                  : screen === "equipment"
                    ? "Цифровой паспорт"
                    : "Обзор оборудования"}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-indicator">
              <FlaskConical size={13} />
              Демоданные
            </span>
            <button
              className="button subtle small"
              onClick={() => {
                setPendingScenario(scenario);
                setDialog("demo");
              }}
            >
              <Settings2 size={15} />
              Демосценарии
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
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
              <p>Карточка оборудования, измерения и история осмотров</p>
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
                  <div className="eyebrow">
                    <span className="online-dot" /> ОБОРУДОВАНИЕ /{" "}
                    {equipment.serial}
                  </div>
                  <h1>
                    {screen === "history"
                      ? "Журнал осмотров"
                      : screen === "rules"
                        ? "Правила диагностики"
                        : equipment.name}
                  </h1>
                  <p className="location">
                    <MapPin size={14} />
                    {equipment.location}
                  </p>
                </div>
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
              </div>

              {screen === "overview" && (
                <>
                  <div
                    className={`status-strip ${critical ? "critical" : alerts.length || insufficient ? "warning" : "normal"}`}
                  >
                    <div className="status-copy">
                      {alerts.length || insufficient ? (
                        <TriangleAlert size={19} />
                      ) : (
                        <CheckCircle2 size={19} />
                      )}
                      <strong>
                        {critical
                          ? "Обнаружены признаки высокого риска"
                          : alerts.length
                            ? "Рекомендуется проверка"
                            : insufficient === 12 ? "Данных недостаточно для оценки"
                              : insufficient ? "Часть проверок недоступна"
                              : "Отклонений по доступным данным нет"}
                      </strong>
                      <span>
                        {alerts.length
                          ? `${alerts.length} предупрежд. · откройте основания`
                          : "Предварительный анализ · исправность не подтверждена"}
                      </span>
                    </div>
                    <span className="updated">
                      <Clock3 size={13} />
                      {date(analysis.created_at)}
                    </span>
                  </div>
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
                              <small>{item.unit}</small>
                            </span>
                            <Sparkline
                              values={sampleValues(item.key)}
                              color={warning ? "#b87c34" : "#14705e"}
                            />
                          </div>
                          <p>
                            {item.baseline}
                            <span
                              className={`small-dot ${warning ? "amber" : ""}`}
                            />
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  <div className="inspection-grid">
                    <section className="panel equipment-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Карта состояния</h2>
                          <p>Выберите узел, чтобы посмотреть подробности</p>
                        </div>
                        <span className="tag">Н-101</span>
                      </div>
                      <PumpDiagram
                        components={equipment.components}
                        alerts={alerts}
                        onSelect={setSelected}
                        guardMissing={missingGuard}
                        leak={leak}
                      />
                      <div className="diagram-footer">
                        <div className="legend">
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
                        <span className="tiny muted">
                          Схема демонстрационного агрегата
                        </span>
                      </div>
                    </section>
                    <section className="panel findings-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            Требует внимания{" "}
                            <span className="count-badge">{alerts.length}</span>
                          </h2>
                          <p>Связь признаков и рекомендаций</p>
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
                            <h3>Активных предупреждений нет</h3>
                            <p>
                              Продолжите визуальный осмотр. Скрытые
                              неисправности по этим данным не исключены.
                            </p>
                            <button
                              className="text-button"
                              onClick={() => setDialog("camera")}
                            >
                              Перейти к осмотру <ArrowRight size={15} />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="findings-footer">
                        <span>
                          {insufficient
                            ? `${insufficient} правил: недостаточно данных`
                            : "Все правила оценены"}
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
                  <div className="secondary-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Динамика измерений</h2>
                          <p>
                            {currentMetric.label} · {currentMetric.unit}
                          </p>
                        </div>
                        <span className="tag">
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
                          <p>Демонстрационный регламент</p>
                        </div>
                        <Wrench size={18} className="muted" />
                      </div>
                      <div className="resource-number">
                        {number(maintenance?.runtime_hours, 0)}
                        <small>моточасов</small>
                      </div>
                      <div className="progress-track">
                        <span
                          style={{
                            width: `${Math.min(100, ((maintenance?.runtime_hours ?? 0) / (maintenance?.norm_hours || 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="resource-range">
                        <span>Наработка агрегата</span>
                        <span>
                          {number(maintenance?.norm_hours, 0)} ч · норматив
                        </span>
                      </div>
                      <div className="service-next">
                        <span className="service-icon">
                          <Clock3 size={18} />
                        </span>
                        <div>
                          <strong>
                            {maintenance?.runtime_hours == null
                              ? "Недостаточно данных о наработке"
                              : analysis.telemetry.last_service_hours == null ? "Нет сведений о последнем ТО"
                              : maintenance?.due_in_hours == null ? "Дальнейший график ТО не задан"
                              : maintenance.due_in_hours <= 0
                                ? "Срок обслуживания наступил"
                                : `До следующего ТО: ${number(maintenance.due_in_hours, 0)} ч`}
                          </strong>
                          <p>
                            Нормативный остаток:{" "}
                            {number(maintenance?.remaining_hours, 0)} ч
                          </p>
                        </div>
                      </div>
                      <p className="tiny muted resource-caveat">
                        Остаток норматива не является прогнозом времени до
                        отказа.
                      </p>
                    </section>
                  </div>
                  <div className="inspection-bottom">
                    <span>
                      <ClipboardCheck size={17} />
                      {events.length
                        ? `Последняя запись: ${date(events[0].created_at)}`
                        : "Осмотр ещё не зарегистрирован"}
                    </span>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setRecordComponent("pump");
                        setDialog("record");
                      }}
                    >
                      <Plus size={17} />
                      Записать результат
                    </button>
                  </div>
                  {vision && (
                    <section className="panel vision-summary">
                      <h2>Последний анализ снимка</h2>
                      <p>{vision.summary}</p>
                      <span className="tag">
                        {vision.model} ·{" "}
                        {vision.quality === "good"
                          ? "достаточное качество"
                          : vision.quality === "limited"
                            ? "ограниченное качество"
                            : "снимок не читается"}
                      </span>
                    </section>
                  )}
                </>
              )}

              {screen === "equipment" && (
                <>
                  <section className="panel passport">
                    <div>
                      <div className="eyebrow">ЦИФРОВАЯ КАРТОЧКА</div>
                      <h2>{equipment.model}</h2>
                      <p>{equipment.notice}</p>
                      <div className="passport-grid">
                        <div>
                          <small>Заводской номер</small>
                          <strong>{equipment.serial}</strong>
                        </div>
                        <div>
                          <small>Среда</small>
                          <strong>{equipment.medium}</strong>
                        </div>
                        <div>
                          <small>Мощность</small>
                          <strong>{equipment.power_kw} кВт</strong>
                        </div>
                        <div>
                          <small>Частота вращения</small>
                          <strong>{equipment.speed_rpm} об/мин</strong>
                        </div>
                      </div>
                    </div>
                    <div className="passport-symbol">
                      <Box size={78} strokeWidth={1} />
                    </div>
                  </section>
                  <section className="panel component-table">
                    <div className="panel-heading">
                      <h2>Узлы и комплектующие</h2>
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
                        <strong>{item.name}</strong>
                        <span className="muted">
                          {item.last_replacement
                            ? "Заменён " +
                              date(item.last_replacement.created_at)
                            : "Ввод: " + item.installed_at}
                        </span>
                        <span>{number(item.norm_hours, 0)} ч</span>
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
                      <p>С исходными данными каждого осмотра</p>
                    </div>
                    <button
                      className="button secondary small"
                      onClick={exportHistory}
                      disabled={!events.length}
                    >
                      <ArrowDownToLine size={15} />
                      Экспорт JSON
                    </button>
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
                                equipment.components.find(
                                  (item) => item.id === event.component_id,
                                )?.name
                              }
                            </h3>
                            <span className="tiny muted">
                              {date(event.created_at)}
                            </span>
                          </div>
                          <p>{event.notes || "Без комментария"}</p>
                          <div className="history-meta">
                            <span>{event.author}</span>
                            <span>{event.analysis.scenario_title}</span>
                            <span>
                              {event.analysis.evaluation.alerts.length}{" "}
                              предупрежд.
                            </span>
                          </div>
                          <details>
                            <summary>Основания на момент осмотра</summary>
                            <div className="evidence-history">
                              {event.analysis.image_id && <figure className="saved-evidence"><img src={`/api/images/${event.analysis.image_id}`} alt="Исходный снимок осмотра" loading="lazy"/><figcaption>Исходный снимок, сохранённый с результатом осмотра</figcaption></figure>}
                              {event.analysis.evaluation.alerts.map((alert) => (
                                <div key={alert.id}>
                                  <strong>
                                    {alert.rule_ids.join(", ")} · {alert.title}
                                  </strong>
                                  <p>{alert.hypothesis}</p>
                                </div>
                              ))}
                              {!event.analysis.evaluation.alerts.length && (
                                <p>
                                  По доступным данным предупреждения не
                                  сформированы.
                                </p>
                              )}
                              <p>
                                Наработка:{" "}
                                {number(
                                  event.analysis.telemetry.runtime_hours,
                                  0,
                                )}{" "}
                                ч · источник: демоданные
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
                      <p>
                        Зарегистрируйте первый осмотр, обслуживание или замену.
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
                      <h2>12 диагностических сценариев</h2>
                      <p>Проверяемые условия · демонстрационные пороги</p>
                    </div>
                    <Cpu size={22} />
                  </div>
                  <p className="rules-intro">
                    Правила формируют гипотезы для предварительной проверки.
                    Отсутствующий или устаревший вход не считается нормальным
                    показанием.
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
                          <span className="rule-id">{rule.id}</span>
                          <div>
                            <h3>
                              {scenarioInfo?.title ??
                                matching?.title ??
                                "Диагностическое правило"}
                            </h3>
                            <p>{scenarioInfo?.description}</p>
                            {rule.missing.length > 0 && (
                              <small>
                                Нет данных: {rule.missing.join(", ")}
                              </small>
                            )}
                          </div>
                          <span className={`rule-status ${rule.status}`}>
                            {rule.status === "triggered"
                              ? "Сработало"
                              : rule.status === "clear"
                                ? "Не сработало"
                                : "Нет данных"}
                          </span>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              <footer className="page-footer">
                <span>КОНТУР · помощник инженера</span>
                <span>Демонстрационный прототип / Кибер 102</span>
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
          <p className="modal-intro">
            Воспроизводимые измерения и признаки для проверки технологии. Все
            данные синтетические.
          </p>
          <label className="field">
            Сценарий демонстрации
            <select
              value={pendingScenario}
              onChange={(event) => setPendingScenario(event.target.value)}
            >
              {bootstrap?.scenarios.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <div className="info-box">
            {
              bootstrap?.scenarios.find((item) => item.id === pendingScenario)
                ?.description
            }
          </div>
          <p className="tiny muted">
            Переключение сценария сбрасывает анализ снимка и ручные наблюдения.
            Сохранённая история остаётся.
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
          <p className="modal-intro">
            Сохраним измерения, предупреждения и ваше действие в истории
            оборудования.
          </p>
          <label className="field">
            Компонент
            <select
              value={recordComponent}
              onChange={(event) => setRecordComponent(event.target.value)}
            >
              {equipment?.components.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
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
              {Object.entries(actions).map(([key, label]) => (
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
            <p className="info-box">
              Замена будет отмечена в карточке выбранного компонента. История
              предыдущих осмотров сохранится.
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
            configured={bootstrap?.vision.configured ?? false}
            model={bootstrap?.vision.model ?? "gpt-6-astra"}
            alerts={alerts}
            onImage={setInspectionImage}
            onComponent={(id) => {
              if (equipment?.components.some(item=>item.id===id)) {
                setDialog(null);
                setSelected(id);
              }
            }}
            onResult={async (result) => {
              const run = await analyze(scenario, result);
              if (!run) throw new Error('Снимок проанализирован, но обновить диагностику не удалось. Повторите запрос.');
              setToast("Снимок проанализирован, диагностика обновлена");
            }}
          />
          <details className="manual-section">
            <summary>Добавить наблюдение инженера</summary>
            <p className="tiny muted">
              Источник будет обозначен как ручное наблюдение.
            </p>
            <div className="manual-fields">
              <select
                aria-label="Визуальный признак"
                value={manualKind}
                onChange={(event) => setManualKind(event.target.value)}
              >
                <option value="guard_missing">Кожух отсутствует</option>
                <option value="liquid_leak">Жидкость у уплотнения</option>
                <option value="missing_bolt">Отсутствует крепёж</option>
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
                  const result = await analyze(scenario, vision ?? undefined, {
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
      {dialog === "about" && (
        <Modal
          title="КОНТУР · единый инструмент инженера"
          onClose={() => setDialog(null)}
        >
          <div className="about-lead">
            <ShieldCheck size={36} />
            <p>
              Камера, данные датчиков и регламент оборудования соединены в одном
              процессе осмотра.
            </p>
          </div>
          <p>
            Прототип для хакатона «Кибер 102», задача КСТ Энерго Инжиниринг.
            Предобученные модели разрешены организаторами; демонстрационные
            данные подготовлены самостоятельно.
          </p>
          <div className="info-box">
            Изображение → видимые признаки → сопоставление с измерениями →
            гипотеза → решение инженера → история.
          </div>
          <p>
            Автоматически анализируются отсутствие кожуха, признаки жидкости у
            уплотнения и отсутствие крепежа. Остальные визуальные сценарии
            используют демоданные или ручные наблюдения.
          </p>
          <p className="tiny muted">
            AR привязан к маркеру демонстрационного стенда. Отсутствие видимых
            проблем не подтверждает исправность. Все нормы требуют сверки с
            документацией изготовителя.
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
            <span className="tag">{component.norm_source}</span>
          </div>
          {selectedAlerts.length ? (
            selectedAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`diagnostic-detail ${alert.severity}`}
              >
                <span className="eyebrow">
                  {alert.rule_ids.join(" + ")} · ДИАГНОСТИЧЕСКАЯ ГИПОТЕЗА
                </span>
                <h3>{alert.title}</h3>
                <p>{alert.hypothesis}</p>
                <h4>Основания</h4>
                <ul className="evidence-list">
                  {alert.evidence.map((item, i) => (
                    <li key={i}>
                      <span>
                        {item.label}
                        <small>{sourceLabel(item.source)}</small>
                      </span>
                      <strong>
                        {String(item.value)}
                        <small>
                          {item.threshold ? `Условие: ${item.threshold}` : ""}
                        </small>
                      </strong>
                    </li>
                  ))}
                </ul>
                <div className="recommendation">
                  <Wrench size={18} />
                  <p>{alert.recommendation}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="info-box">
              Для этого узла предупреждений по доступным данным нет. Визуальный
              осмотр и проверка по регламенту остаются необходимыми.
            </div>
          )}
          <div className="detail-facts">
            <div>
              <small>Нормативный срок</small>
              <strong>{number(component.norm_hours, 0)} ч</strong>
            </div>
            <div>
              <small>Установка / замена</small>
              <strong>
                {component.last_replacement
                  ? date(component.last_replacement.created_at)
                  : component.installed_at}
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
          {alert.title}
          <ChevronRight size={15} />
        </span>
        <span className="finding-description">{alert.hypothesis}</span>
        <span className="finding-rule">
          {alert.rule_ids.join(" + ")} <span>Открыть основания</span>
        </span>
      </span>
    </button>
  );
}
