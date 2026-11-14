import { formatCopy } from "../api";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CircleStop,
  ImagePlus,
  Loader2,
  ScanLine,
  Sparkles,
  View,
} from "lucide-react";
import type { Alert, CatalogObject, VisionResult } from "../types";
import { request } from "../api";

export function CameraPanel({
  configured,
  model,
  alerts,
  objects,
  currentId,
  onResult,
  onComponent,
  onImage,
  onSelectObject,
}: {
  configured: boolean;
  model: string;
  alerts: Alert[];
  objects: CatalogObject[];
  currentId: string;
  onResult: (result: VisionResult) => Promise<void>;
  onComponent: (id: string) => void;
  onImage: (image: string | null) => void;
  onSelectObject: (id: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const cameraGeneration = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const scanner = useRef<{ stop: () => void } | null>(null);
  const [mode, setMode] = useState<"photo" | "ar" | "qr">("photo");
  const [live, setLive] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  function stop() {
    cameraGeneration.current += 1;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    scanner.current?.stop();
    scanner.current = null;
    setLive(false);
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
  async function startCamera() {
    const generation = ++cameraGeneration.current;
    setError("");
    setImage(null);
    onImage(null);
    setResult(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Для камеры откройте приложение через HTTPS или localhost. По обычному HTTP с телефона камера недоступна",
      );
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (generation !== cameraGeneration.current) {
        media.getTracks().forEach(track=>track.stop());
        return;
      }
      stream.current = media;
      setLive(true);
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
    } catch (cause) {
      const name = (cause as DOMException).name;
      setError(
        name === "NotAllowedError"
          ? "Разрешите доступ к камере в настройках браузера. Можно также загрузить снимок"
          : "Камера недоступна. Подключите камеру или загрузите снимок",
      );
    }
  }
  function capture() {
    if (!video.current?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.current.videoWidth;
    canvas.height = video.current.videoHeight;
    canvas.getContext("2d")!.drawImage(video.current, 0, 0);
    const captured = canvas.toDataURL("image/jpeg", 0.88);
    setImage(captured);
    onImage(captured);
    setResult(null);
    stop();
  }
  async function upload(file?: File) {
    if (!file) return;
    stop();
    setError("");
    setResult(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Выберите изображение PNG, JPEG или WebP");
      return;
    }
    if (file.size > 12_000_000) {
      setError("Выберите файл меньше 12 МБ");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const photo = new Image();
      photo.src = url;
      await photo.decode();
      const scale = Math.min(1, 1600 / Math.max(photo.width, photo.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(photo.width * scale);
      canvas.height = Math.round(photo.height * scale);
      canvas
        .getContext("2d")!
        .drawImage(photo, 0, 0, canvas.width, canvas.height);
      const uploaded = canvas.toDataURL("image/jpeg", 0.9);
      setImage(uploaded);
      onImage(uploaded);
    } catch {
      setError("Не удалось прочитать изображение. Попробуйте другой файл");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function analyze() {
    if (!image) return;
    setBusy(true);
    setError("");
    try {
      const response = await request<VisionResult>("/vision", { image });
      setResult(response);
      await onResult(response);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function scanQr() {
    setError("");
    setMessage("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Сканирование требует HTTPS или localhost. Оборудование можно выбрать вручную в цифровом паспорте",
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
          className={`button ${mode === "photo" ? "primary" : "secondary"}`}
          onClick={() => changeMode("photo")}
        >
          <Camera size={15} />
          Снимок и ИИ
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
          Сканировать QR
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
          <div className="camera-stage">
            <video
              ref={video}
              playsInline
              muted
              style={{ display: live ? "block" : "none" }}
            />
            {image && mode === "photo" ? (
              <div className="image-wrapper">
                <img src={image} alt="Снимок для визуального осмотра" />
                {result?.observations
                  .filter((item) => item.present && item.bbox)
                  .map((item, i) => {
                    const [x1, y1, x2, y2] = item.bbox!;
                    return (
                      <div
                        className="vision-box"
                        key={i}
                        style={{
                          left: `${x1 * 100}%`,
                          top: `${y1 * 100}%`,
                          width: `${(x2 - x1) * 100}%`,
                          height: `${(y2 - y1) * 100}%`,
                        }}
                      >
                        <span>
                          {item.kind === "guard_missing" ||
                          item.kind === "guard_damaged"
                            ? "Кожух"
                            : item.kind === "liquid_leak"
                              ? "Жидкость"
                              : "Крепление"}
                        </span>
                      </div>
                    );
                  })}
              </div>
            ) : !live ? (
              <div className="camera-placeholder">
                {mode === "qr" ? (
                  <ScanLine size={40} strokeWidth={1.2} />
                ) : (
                  <Camera size={40} strokeWidth={1.2} />
                )}
                <h3>
                  {mode === "qr"
                    ? "Идентифицируйте оборудование"
                    : "Рассмотрите узел ближе"}
                </h3>
                <p className="support-copy">
                  {mode === "qr"
                    ? "Отсканируйте QR-код демонстрационного агрегата"
                    : "Снимите муфту с кожухом, торцевое уплотнение или крепление. Модель оценит только видимые признаки"}
                </p>
              </div>
            ) : null}
          </div>
          <div className="camera-controls">
            {mode === "qr" ? (
              <button className="button primary" onClick={live ? stop : scanQr}>
                {live ? <CircleStop size={16} /> : <ScanLine size={16} />}{" "}
                {live ? "Остановить" : "Включить сканер"}
              </button>
            ) : (
              <>
                <button
                  className="button secondary"
                  onClick={live ? capture : startCamera}
                >
                  <Camera size={16} />
                  {live ? "Сделать снимок" : "Включить камеру"}
                </button>
                <label className="button secondary upload-label">
                  <ImagePlus size={16} />
                  Загрузить снимок
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      void upload(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    aria-label="Загрузить снимок"
                  />
                </label>
                <button
                  className="button primary"
                  disabled={!image || busy || !configured}
                  onClick={analyze}
                >
                  {busy ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}{" "}
                  {busy ? "Анализируем…" : "Анализировать"}
                </button>
              </>
            )}
          </div>
          {mode === "photo" && (
            <p className="support-copy">
              {configured
                ? `Анализ выполняет ${model} на локальном сервере. Снимок не покидает локальную сеть`
                : "Локальная модель не настроена. Запустите её по инструкции в README"}
            </p>
          )}
        </>
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
      {result && mode === "photo" && (
        <div className="vision-result">
          <strong>
            {result.quality === "unreadable"
              ? "Нужен другой снимок"
              : result.quality === "limited"
                ? "Ограниченное качество снимка"
                : "Предварительный анализ завершён"}
          </strong>
          <p className="support-copy">{formatCopy(result.summary)}</p>
          <ul>
            {result.observations.map((item, i) => (
              <li key={i}>{formatCopy(item.description)}</li>
            ))}
          </ul>
          <p className="support-copy">
            Отсутствие видимых проблем не подтверждает исправность оборудования
          </p>
        </div>
      )}
    </div>
  );
}
