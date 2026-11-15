import { formatCopy, request, sendFrame } from "../api";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, CircleStop, Crosshair, Loader2, ScanLine, ScanText, Video, View, X } from "lucide-react";
import type {
  Alert,
  CatalogObject,
  LiveAssessment,
  LiveDetection,
  LiveDetector,
  LiveFrame,
  LiveSession,
} from "../types";

// Pause between an answer and the next frame: gives the phone time to draw and keeps it cool.
const FRAME_PAUSE_MS = 120;
const JPEG_QUALITY = 0.7;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The three categories of the brief (§4.2), plus two states where no verdict is possible yet.
const ASSESSMENT: Record<LiveAssessment, { text: string; tone: string }> = {
  unavailable: { text: "Детектор не готов — оценить кадр нельзя", tone: "neutral" },
  warming_up: { text: "Собираем кадры для оценки", tone: "neutral" },
  no_visible_issues: { text: "Видимых проблем не обнаружено", tone: "ok" },
  check_recommended: { text: "Рекомендуется проверка", tone: "warning" },
  possible_defect: { text: "Обнаружены признаки возможного дефекта", tone: "critical" },
};

export function CameraPanel({
  alerts,
  hints,
  objects,
  currentId,
  componentOf,
  onComponent,
  onConfirm,
  onReject,
  onSelectObject,
  initialMode = "live",
  debug = false,
}: {
  alerts: Alert[];
  hints: { component: string; name: string; reason: string; severity: string }[];
  objects: CatalogObject[];
  currentId: string;
  componentOf: (kind: string) => string | null;
  onComponent: (id: string) => void;
  onConfirm: (item: LiveDetection, frame: string, detector: string) => Promise<boolean>;
  onReject: (item: LiveDetection) => void;
  onSelectObject: (id: string) => void;
  initialMode?: "live" | "qr";
  /** Detector timing and confidence are for whoever tunes the system, not for the round. */
  debug?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const cameraGeneration = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const scanner = useRef<{ stop: () => void } | null>(null);
  const [mode, setMode] = useState<"live" | "ar" | "qr">(initialMode);
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [detections, setDetections] = useState<LiveDetection[]>([]);
  const [detector, setDetector] = useState<LiveDetector | null>(null);
  const [assessment, setAssessment] = useState<LiveAssessment | null>(null);
  // Signs confirmed on frames during this session, kept until the engineer records or rejects them.
  const [candidates, setCandidates] = useState<Record<string, LiveDetection>>({});
  const [decided, setDecided] = useState<Record<string, "recorded" | "rejected">>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [plate, setPlate] = useState<{ status: string; lines: string[];
    matches: { id: string; name: string; serial: string | null; matched: string }[] } | null>(null);
  const [stats, setStats] = useState({ processed: 0, roundTripMs: 0 });
  function stop() {
    cameraGeneration.current += 1;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    scanner.current?.stop();
    scanner.current = null;
    setLive(false);
    setDetections([]);
    setAssessment(null);
  }
  useEffect(
    () => () => {
      cameraGeneration.current += 1;
      stream.current?.getTracks().forEach((track) => track.stop());
      scanner.current?.stop();
    },
    [],
  );
  useEffect(() => {
    function selected(event: MessageEvent) {
      if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.type === 'kontur-component' && typeof event.data.id === 'string') {
        onComponent(event.data.id);
      }
    }
    window.addEventListener('message', selected);
    return () => window.removeEventListener('message', selected);
  }, [onComponent]);
  function changeMode(next: typeof mode) {
    stop();
    setMode(next);
    setError("");
    setMessage("");
  }
  async function openCamera(generation: number) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Для камеры откройте приложение через HTTPS или localhost. По обычному HTTP с телефона камера недоступна",
      );
      return false;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (generation !== cameraGeneration.current) {
        media.getTracks().forEach((track) => track.stop());
        return false;
      }
      stream.current = media;
      setLive(true);
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      return true;
    } catch (cause) {
      const name = (cause as DOMException).name;
      setError(
        name === "NotAllowedError"
          ? "Разрешите доступ к камере в настройках браузера"
          : "Камера недоступна. Подключите камеру или откройте приложение на телефоне",
      );
      return false;
    }
  }
  // One frame, scaled so its longer side fits what the server asked for.
  function grab(maxSide: number): Promise<Blob | null> {
    const source = video.current;
    if (!source?.videoWidth) return Promise.resolve(null);
    const scale = Math.min(1, maxSide / Math.max(source.videoWidth, source.videoHeight));
    const target = (canvas.current ??= document.createElement("canvas"));
    target.width = Math.round(source.videoWidth * scale);
    target.height = Math.round(source.videoHeight * scale);
    target.getContext("2d")!.drawImage(source, 0, 0, target.width, target.height);
    return new Promise((resolve) => target.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  }
  async function startLive() {
    const generation = ++cameraGeneration.current;
    setError("");
    setMessage("");
    setDetections([]);
    setCandidates({});
    setDecided({});
    setStats({ processed: 0, roundTripMs: 0 });
    let session: LiveSession;
    try {
      session = await request<LiveSession>("/live/sessions", { equipment_id: currentId });
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    setDetector(session.detector);
    if (!(await openCamera(generation))) return;
    // The next frame leaves only after the previous answer: nothing piles up on a slow network.
    let frameNo = 0;
    let processed = 0;
    while (generation === cameraGeneration.current) {
      const blob = await grab(session.max_side);
      if (!blob) {
        await pause(200);
        continue;
      }
      const started = performance.now();
      try {
        const answer = await sendFrame<LiveFrame>(session.session_id, frameNo, blob);
        if (generation !== cameraGeneration.current) return;
        if (answer.status === "processed") {
          frameNo += 1;
          processed += 1;
          setDetections(answer.detections);
          setDetector(answer.detector);
          setAssessment(answer.assessment ?? null);
          const confirmed = answer.detections.filter((item) => item.confirmed);
          if (confirmed.length) {
            setCandidates((current) => {
              const next = { ...current };
              for (const item of confirmed) {
                if (!next[item.kind] || (item.confidence ?? 0) >= (next[item.kind].confidence ?? 0)) {
                  next[item.kind] = item;
                }
              }
              return next;
            });
          }
          setStats({ processed, roundTripMs: Math.round(performance.now() - started) });
        } else if (answer.status === "stale") {
          frameNo = answer.frame_no + 1;
        }
      } catch (cause) {
        if (generation !== cameraGeneration.current) return;
        setError((cause as Error).message);
        stop();
        return;
      }
      await pause(FRAME_PAUSE_MS);
    }
  }
  // The evidence frame is taken larger than analysis frames: it is for a person to look at later.
  function evidenceFrame(): string | null {
    const source = video.current;
    if (!source?.videoWidth) return null;
    const scale = Math.min(1, 1280 / Math.max(source.videoWidth, source.videoHeight));
    const target = document.createElement("canvas");
    target.width = Math.round(source.videoWidth * scale);
    target.height = Math.round(source.videoHeight * scale);
    target.getContext("2d")!.drawImage(source, 0, 0, target.width, target.height);
    return target.toDataURL("image/jpeg", 0.85);
  }
  async function record(item: LiveDetection) {
    const frame = evidenceFrame();
    if (!frame) {
      setError("Нет кадра с камеры: включите камеру и наведите её на узел");
      return;
    }
    setSaving(item.kind);
    const ok = await onConfirm(item, frame, detector?.name ?? "");
    setSaving(null);
    if (ok) setDecided((current) => ({ ...current, [item.kind]: "recorded" }));
  }
  // A nameplate needs more pixels than defect frames: small stamped text is read from this frame.
  async function readNameplate() {
    const source = video.current;
    if (!source?.videoWidth) return;
    setReading(true);
    setError("");
    setPlate(null);
    const scale = Math.min(1, 1600 / Math.max(source.videoWidth, source.videoHeight));
    const target = document.createElement("canvas");
    target.width = Math.round(source.videoWidth * scale);
    target.height = Math.round(source.videoHeight * scale);
    target.getContext("2d")!.drawImage(source, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob | null>((resolve) => target.toBlob(resolve, "image/jpeg", 0.9));
    try {
      const response = await fetch("/api/nameplate", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      const answer = await response.json();
      if (!response.ok) throw new Error(answer.detail ?? "Не удалось прочитать табличку");
      if (answer.status === "found") {
        const found = answer.matches[0];
        if (found.id === currentId) {
          setMessage(`${found.name} опознан по табличке. Его карточка уже открыта`);
          stop();
        } else {
          setMessage(`${found.name} опознан по табличке. Открываем карточку`);
          stop();
          onSelectObject(found.id);
        }
      } else {
        setPlate(answer);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setReading(false);
    }
  }
  async function scanQr() {
    setPlate(null);
    setError("");
    setMessage("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Сканирование требует HTTPS или localhost. Оборудование можно выбрать в списке «Объект осмотра» на обзоре",
      );
      return;
    }
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      setLive(true);
      scanner.current = await new BrowserQRCodeReader().decodeFromVideoDevice(
        undefined,
        video.current!,
        (code) => {
          if (!code) return;
          const text = code.getText();
          if (!text.startsWith("kontur:")) {
            setMessage("Этот QR-код не относится к каталогу оборудования КОНТУР");
            return;
          }
          const identifier = text.slice("kontur:".length);
          const target = objects.find((item) => item.id === identifier);
          if (!target) {
            setMessage(
              `Объект «${identifier}» в каталоге не найден. Выберите оборудование вручную`,
            );
            return;
          }
          if (!target.inspectable) {
            setMessage(
              `${target.name}: это позиция по проекту, а не отдельная машина ` +
                "Какой агрегат на ней установлен, документы не указывают",
            );
            stop();
            return;
          }
          if (target.id === currentId) {
            setMessage(
              `${target.name} идентифицирован. Его цифровая карточка уже открыта в рабочей области`,
            );
            stop();
            return;
          }
          setMessage(`${target.name} идентифицирован. Открываем его карточку`);
          stop();
          onSelectObject(target.id);
        },
      );
    } catch {
      setLive(false);
      setError("Не удалось открыть сканер. Проверьте разрешение камеры");
    }
  }
  const highlights = alerts.map((alert) => ({
    id: alert.component_id,
    severity: alert.severity,
  }));
  return (
    <div>
      <div className="camera-tabs">
        <button
          className={`button ${mode === "live" ? "primary" : "secondary"}`}
          onClick={() => changeMode("live")}
        >
          <Video size={15} />
          Живой осмотр
        </button>
        <button
          className={`button ${mode === "ar" ? "primary" : "secondary"}`}
          onClick={() => changeMode("ar")}
        >
          <View size={15} />
          AR-метки
        </button>
        <button
          className={`button ${mode === "qr" ? "primary" : "secondary"}`}
          onClick={() => changeMode("qr")}
        >
          <ScanLine size={15} />
          Опознать
        </button>
      </div>
      {mode === "ar" ? (
        <>
          <iframe
            ref={frame}
            title="AR-осмотр демонстрационного стенда"
            className="ar-frame"
            src={`/ar.html?highlights=${encodeURIComponent(JSON.stringify(highlights))}`}
            allow="camera"
          />
          <p className="camera-message support-copy">
            Наведите камеру на маркер Hiro из раздела «QR и AR-стенд». Метки
            привязаны к демонстрационной схеме. При потере маркера они
            скрываются
          </p>
        </>
      ) : (
        <>
          {mode === "live" && (
            <div className="live-hints">
              <strong>
                <Crosshair size={15} /> Куда навести камеру
              </strong>
              {hints.length ? (
                <ul>
                  {hints.map((hint) => (
                    <li key={hint.component} className={hint.severity}>
                      <span>{hint.name}</span> — {formatCopy(hint.reason)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="support-copy">
                  Осмотрите: кожух муфты, уплотнение, крепление рамы
                </p>
              )}
            </div>
          )}
          <div className="camera-stage">
            <div className="live-frame" style={{ display: live ? "block" : "none" }}>
              <video ref={video} playsInline muted />
              {mode === "live" &&
                detections.map((item, i) => {
                  const [x1, y1, x2, y2] = item.bbox;
                  return (
                    <button
                      type="button"
                      className={`vision-box live-box ${item.confirmed ? "confirmed" : "tentative"}${
                        y1 < 0.15 ? " label-below" : ""}${x2 > 0.65 ? " label-right" : ""}`}
                      key={i}
                      aria-label={`${item.label}: открыть карточку узла`}
                      title={`${item.label}${item.confidence !== null ? ` · ${Math.round(item.confidence * 100)}%` : ""}`}
                      onClick={() => {
                        const component = componentOf(item.kind);
                        if (component) onComponent(component);
                      }}
                      style={{
                        left: `${x1 * 100}%`,
                        top: `${y1 * 100}%`,
                        width: `${(x2 - x1) * 100}%`,
                        height: `${(y2 - y1) * 100}%`,
                      }}
                    >
                      {/* Only confirmed signs are labelled: several dashed guesses with text would
                          cover the very part the engineer is looking at. */}
                      {/* The full name above the box (below it near the top edge), the model's confidence under it. */}
                      {item.confirmed && (
                        <span className="box-label">
                          <strong>{item.label}</strong>
                          {item.confidence !== null && <small>{Math.round(item.confidence * 100)}%</small>}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
            {!live && (
              <div className="camera-placeholder">
                {mode === "qr" ? (
                  <ScanLine size={40} strokeWidth={1.2} />
                ) : (
                  <Camera size={40} strokeWidth={1.2} />
                )}
                <h3>
                  {mode === "qr"
                    ? "Опознайте оборудование"
                    : "Наведите камеру на агрегат"}
                </h3>
                <p className="support-copy">
                  {mode === "qr"
                    ? "QR-код считывается сам. Для заводской таблички наведите камеру на неё и нажмите «Прочитать шильдик»"
                    : "Кадры обрабатываются на локальном сервере и не сохраняются"}
                </p>
              </div>
            )}
          </div>
          <div className="camera-controls">
            {mode === "qr" ? (
              <>
                <button className={`button ${live ? "secondary" : "primary"}`} onClick={live ? stop : scanQr}>
                  {live ? <CircleStop size={16} /> : <ScanLine size={16} />}{" "}
                  {live ? "Остановить" : "Включить камеру"}
                </button>
                {live && (
                  <button className="button primary" disabled={reading} onClick={() => void readNameplate()}>
                    {reading ? <Loader2 size={16} className="spin" /> : <ScanText size={16} />}
                    {reading ? "Читаем…" : "Прочитать шильдик"}
                  </button>
                )}
              </>
            ) : (
              <button
                className="button primary"
                onClick={live ? stop : () => void startLive()}
              >
                {live ? <CircleStop size={16} /> : <Video size={16} />}
                {live ? "Остановить" : "Включить камеру"}
              </button>
            )}
          </div>
          {mode === "live" && live && assessment && (
            <p className={`live-assessment ${ASSESSMENT[assessment].tone}`} role="status">
              {ASSESSMENT[assessment].text}
              {assessment === "possible_defect" &&
                `: ${[...new Set(detections.filter((item) => item.confirmed).map((item) => item.label))].join(", ")}`}
            </p>
          )}
          {mode === "live" && Object.keys(candidates).length > 0 && (
            <div className="live-candidates">
              <strong>Подтвердите признаки, найденные камерой</strong>
              {Object.values(candidates).map((item) => (
                <div className="live-candidate" key={item.kind}>
                  <span>
                    {item.label}
                    {debug && item.confidence !== null && ` · ${Math.round(item.confidence * 100)}%`}
                  </span>
                  {decided[item.kind] === "recorded" ? (
                    <span className="candidate-state">
                      <Check size={15} /> Записано в журнал
                    </span>
                  ) : decided[item.kind] === "rejected" ? (
                    <span className="candidate-state">Отклонено инженером</span>
                  ) : (
                    <span className="candidate-actions">
                      <button
                        className="button primary"
                        disabled={saving !== null || !live}
                        onClick={() => void record(item)}
                      >
                        <Check size={15} />
                        {saving === item.kind ? "Записываем…" : "Подтвердить и записать"}
                      </button>
                      <button
                        className="button secondary"
                        disabled={saving !== null}
                        onClick={() => {
                          setDecided((current) => ({ ...current, [item.kind]: "rejected" }));
                          onReject(item);
                        }}
                      >
                        <X size={15} />
                        Не дефект
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {debug && mode === "live" && live && detector && (
            <p className="camera-message support-copy" role="status">
              {detector.ready
                ? `Детектор: ${detector.name} · обработано кадров: ${stats.processed} · ответ сервера: ${stats.roundTripMs} мс`
                : `Детектор признаков ${detector.name}. Рамок не будет, но кадры доходят до сервера — обработано: ${stats.processed}, ответ: ${stats.roundTripMs} мс`}
            </p>
          )}
          {mode === "live" && live && (
            <p className="support-copy">
              Сплошная рамка — признак держится на 3 из 5 кадров, пунктир — ещё не подтверждён.
              Нет рамок — ещё не значит исправно
            </p>
          )}
        </>
      )}
      {plate && (
        <div className="plate-result" role="status">
          {plate.status === "ambiguous" ? (
            <>
              <strong>Подходят несколько объектов — выберите нужный</strong>
              {plate.matches.map((item) => (
                <button key={item.id} className="button secondary" onClick={() => { stop(); onSelectObject(item.id); }}>
                  {item.name} · {item.serial ?? item.id}
                </button>
              ))}
            </>
          ) : (
            <>
              <strong>Объект по табличке не найден</strong>
              <p className="support-copy">
                Подойдите ближе, уберите блик или выберите оборудование вручную.{" "}
                {plate.lines.length ? `Прочитано: ${plate.lines.slice(0, 6).join(" · ")}` : "Текст на кадре не найден"}
              </p>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="camera-message camera-error support-copy" role="alert">
          {formatCopy(error)}
        </p>
      )}
      {message && (
        <p className="camera-message support-copy" role="status">
          {formatCopy(message)}
        </p>
      )}
    </div>
  );
}
