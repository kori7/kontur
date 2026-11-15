"""HTTP boundary for the local pump-inspection prototype."""

import os
import base64
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Path as PathParam, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.auth import DEMO_USER, SESSION_COOKIE, SESSION_HOURS, Accounts, AuthError, public
from app.catalog import DEMO_ID, card, component_ids, equipment_type_of, list_catalog
from app.registry import applicable_classes
from app.demo import get_scenario, get_scenarios
from app.diagnostics.documented import evaluate_documented, measurement_vocabulary
from app.detector import from_environment as detector_from_environment
from app.diagnostics.engine import evaluate
from app.library import list_library, resolve as resolve_source
from app.io_server import configured_address as io_address_from_environment, read_current as read_io
from app.live import Detector, FrameError, LiveSessions
from app.live_findings import plan_finding
from app.nameplate import NameplateReader, match as match_nameplate
from app.series_check import compare as compare_series, evaluate_series, merged as merged_series
from app.reports import build as build_report, to_html as report_html, to_xlsx as report_xlsx
from app.reference_data import get_reference_window, list_reference_series, organizer_assessment, organizer_thresholds
from app.storage import Store
from app.vision import VISUAL_COMPONENTS, VisionClient, VisionError, validate_image

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")


class ManualObservation(BaseModel):
    kind: Literal["guard_missing", "guard_damaged", "liquid_leak", "missing_bolt", "loose_bolt",
                  "base_corrosion", "oil_low", "oil_degraded", "contact_damage", "flow_instability",
                  "cavitation_noise"]
    present: bool
    timestamp: datetime | None = None


class Finding(BaseModel):
    """A visual class from data/registry/defect-classes.json, confirmed or rejected by the engineer."""

    class_id: str = Field(max_length=60)
    present: bool


class AnalyzeRequest(BaseModel):
    equipment_id: str = Field(default=DEMO_ID, max_length=60)
    scenario_id: str | None = Field(default="normal", max_length=50)
    observations: list[ManualObservation] = Field(default_factory=list, max_length=15)
    measurements: dict[str, float | bool] = Field(default_factory=dict, max_length=20)
    findings: list[Finding] = Field(default_factory=list, max_length=25)
    # For an object with attached series: which hourly record is "now" (default: the latest).
    series_index: int | None = Field(default=None, ge=0)
    vision_id: str | None = None
    image: str | None = Field(default=None, max_length=8_000_000)


class EventRequest(BaseModel):
    analysis_id: str = Field(max_length=50)
    equipment_id: str = Field(default=DEMO_ID, max_length=60)
    component_id: str = Field(max_length=30)
    action: Literal["inspection", "defect", "maintenance", "replacement"]
    notes: str = Field(default="", max_length=2000)
    author: str = Field(default="Демо-инженер", min_length=1, max_length=100)
    # Left empty, the result follows from the action and the inspection it records.
    result: Literal["ok", "remark", "rejected", "done"] | None = None
    source: Literal["camera", "manual", "sensor", ""] = ""
    finding: str = Field(default="", max_length=120)


def event_result(action: str, analysis: dict) -> str:
    """The outcome a record states when its author did not choose one."""
    if action in ("maintenance", "replacement"):
        return "done"
    if action == "defect" or analysis["evaluation"]["alerts"]:
        return "remark"
    return "ok"


class ImageRequest(BaseModel):
    image: str = Field(max_length=8_000_000)


class LoginRequest(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=200)


class SetupRequest(LoginRequest):
    name: str = Field(min_length=1, max_length=100)


class NewUserRequest(SetupRequest):
    role: Literal["engineer", "master", "admin"]


class UserUpdate(BaseModel):
    role: Literal["engineer", "master", "admin"] | None = None
    active: bool | None = None
    password: str | None = Field(default=None, max_length=200)


# Paths open without signing in, and the permission each guarded area needs beyond signing in.
OPEN_PATHS = {"/api/health", "/api/auth/me", "/api/auth/login", "/api/auth/setup", "/api/auth/logout"}
AREA_PERMISSIONS = (("/api/reference/", "series"), ("/api/library", "library"), ("/api/users", "users"),
                    ("/api/reports/", "reports"), ("/api/maintenance/", "reports"))


def auth_enabled_from_environment() -> bool:
    return os.getenv("KONTUR_AUTH", "on").strip().lower() not in ("off", "0", "false", "no")


class LiveSessionRequest(BaseModel):
    equipment_id: str = Field(default=DEMO_ID, max_length=60)


class LiveFindingRequest(BaseModel):
    """A sign the camera found and the engineer confirmed, with the frame it was seen on."""

    equipment_id: str = Field(default=DEMO_ID, max_length=60)
    scenario_id: str | None = Field(default=None, max_length=50)
    kind: str = Field(max_length=40)
    label: str = Field(max_length=80)
    confidence: float | None = Field(default=None, ge=0, le=1)
    detector: str = Field(default="", max_length=120)
    image: str = Field(max_length=8_000_000)
    observations: list[ManualObservation] = Field(default_factory=list, max_length=15)
    author: str = Field(default="Демо-инженер", min_length=1, max_length=100)


def create_app(db_path: str | Path | None = None, detector: Detector | None = None,
               auth: bool | None = None) -> FastAPI:
    app = FastAPI(title="КОНТУР · Inspection API", version="0.1.0")
    store = Store(db_path or os.getenv("APP_DB_PATH", str(ROOT / "data" / "inspection.db")))
    accounts = Accounts(store.path)
    auth_enabled = auth_enabled_from_environment() if auth is None else auth
    live = LiveSessions(detector or detector_from_environment())
    nameplates = NameplateReader()
    io_address = io_address_from_environment()
    vision = VisionClient(os.getenv("LOCAL_VISION_URL", "http://127.0.0.1:8081/v1"),
                          os.getenv("LOCAL_VISION_MODEL", "Qwen3-VL-4B-Instruct"))

    @app.middleware("http")
    async def require_sign_in(request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/") or path in OPEN_PATHS:
            return await call_next(request)
        user = (accounts.session_user(request.cookies.get(SESSION_COOKIE)) if auth_enabled
                else public({**DEMO_USER}))
        if user is None:
            return JSONResponse({"detail": "Войдите в систему"}, status_code=401)
        needed = next((permission for prefix, permission in AREA_PERMISSIONS if path.startswith(prefix)), None)
        if path.startswith("/api/library/") and path.endswith("/file"):
            # One supplied document opened from an object's passport is reference for everyone on the round;
            # browsing and sorting the whole set stays with the master.
            needed = None
        if needed and needed not in user["permissions"]:
            return JSONResponse({"detail": f"Раздел недоступен для роли «{user['role_name']}»"}, status_code=403)
        request.state.user = user
        return await call_next(request)

    def signed_in(response: Response, request: Request, token: str) -> None:
        response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_HOURS * 3600, httponly=True,
                            samesite="strict", secure=request.url.scheme == "https", path="/")

    def auth_error(exc: AuthError):
        return HTTPException(exc.status, str(exc))

    @app.get("/api/auth/me")
    def me(request: Request):
        if not auth_enabled:
            return {"auth_enabled": False, "setup_required": False, "user": public({**DEMO_USER})}
        return {"auth_enabled": True, "setup_required": accounts.setup_required(),
                "user": accounts.session_user(request.cookies.get(SESSION_COOKIE))}

    @app.post("/api/auth/setup", status_code=201)
    def setup(body: SetupRequest, request: Request, response: Response):
        """The very first account, created from the sign-in screen; always an administrator."""
        try:
            accounts.create(body.email, body.name, "admin", body.password, first=True)
            user, token = accounts.login(body.email, body.password)
        except AuthError as exc:
            raise auth_error(exc) from exc
        signed_in(response, request, token)
        return user

    @app.post("/api/auth/login")
    def login(body: LoginRequest, request: Request, response: Response):
        try:
            user, token = accounts.login(body.email, body.password)
        except AuthError as exc:
            raise auth_error(exc) from exc
        signed_in(response, request, token)
        return user

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response):
        accounts.logout(request.cookies.get(SESSION_COOKIE))
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/users")
    def users():
        return accounts.users()

    @app.post("/api/users", status_code=201)
    def add_user(body: NewUserRequest):
        try:
            return accounts.create(body.email, body.name, body.role, body.password)
        except AuthError as exc:
            raise auth_error(exc) from exc

    @app.patch("/api/users/{user_id}")
    def change_user(user_id: str, body: UserUpdate, request: Request):
        try:
            return accounts.update(request.state.user, user_id, body.role, body.active, body.password)
        except AuthError as exc:
            raise auth_error(exc) from exc

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": "0.1.0"}

    @app.get("/api/bootstrap")
    def bootstrap():
        return {"catalog": list_catalog(), "equipment": card(DEMO_ID, store.events(DEMO_ID)),
                "scenarios": get_scenarios(),
                "vision": {"configured": True, "model": vision.model, "offline": True,
                           "provider": "llama.cpp · локальный сервер", "supported": list(VISUAL_COMPONENTS)}}

    @app.get("/api/vision/status")
    async def vision_status():
        return await vision.status()

    @app.get("/api/catalog")
    def catalog():
        return list_catalog()

    @app.get("/api/equipment")
    def equipment():
        return card(DEMO_ID, store.events(DEMO_ID))

    @app.get("/api/equipment/{equipment_id}")
    def equipment_by_id(equipment_id: str):
        try:
            return card(equipment_id, store.events(equipment_id))
        except KeyError as exc:
            raise HTTPException(404, "Объект не найден в каталоге") from exc

    def report_data(equipment_id: str, analysis_id: str | None, request: Request) -> dict:
        try:
            events = store.events(equipment_id)
            target = card(equipment_id, events)
        except KeyError as exc:
            raise HTTPException(404, "Объект не найден в каталоге") from exc
        analysis = None
        if analysis_id:
            try:
                analysis = store.analysis(analysis_id)
            except KeyError as exc:
                raise HTTPException(404, "Осмотр не найден") from exc
            if analysis.get("type") != "inspection" or analysis.get("equipment_id", DEMO_ID) != equipment_id:
                raise HTTPException(422, "Осмотр относится к другому объекту")
        elif events:
            analysis = events[0]["analysis"]
        return build_report(target, events, analysis, request.state.user["name"])

    @app.get("/api/reference/agreement")
    def series_agreement():
        """The organizer's stated thresholds against their own «Диагноз» column, record by record."""
        return [compare_series(series_id) for series_id in ("vibration-001", "temperature-001")]

    @app.get("/api/reports/{equipment_id}.xlsx")
    def report_excel(equipment_id: str, request: Request, analysis_id: str | None = None):
        data = report_xlsx(report_data(equipment_id, analysis_id, request))
        name = f"kontur-{equipment_id}-{datetime.now().strftime('%Y%m%d-%H%M')}.xlsx"
        return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.get("/api/reports/{equipment_id}/print", response_class=HTMLResponse)
    def report_print(equipment_id: str, request: Request, analysis_id: str | None = None):
        return report_html(report_data(equipment_id, analysis_id, request))

    @app.get("/api/reference/series")
    def reference_series():
        return {"series": list_reference_series(), "thresholds": organizer_thresholds()}

    @app.get("/api/reference/series/{identifier}")
    def reference_window(identifier: str, end_index: int | None = None, limit: int = 10):
        """Replay a window of one supplied series. It is never attached to a catalogue object."""
        try:
            window = get_reference_window(identifier, end_index, limit)
        except KeyError as exc:
            raise HTTPException(404, "Ряд не найден") from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        channels = [item["key"] for item in window["channels"]]
        return {**window,
                "organizer_assessment": organizer_assessment(window["telemetry"]["samples"], channels)}

    @app.get("/api/library")
    def library():
        return list_library()

    @app.get("/api/library/{source_id}/file")
    def library_file(source_id: str):
        try:
            path, media_type, name = resolve_source(source_id)
        except KeyError as exc:
            raise HTTPException(404, "Файл не найден в реестре переданных материалов") from exc
        except ValueError as exc:
            raise HTTPException(415, str(exc)) from exc
        # Images and PDFs open in place; office formats are downloaded.
        inline = media_type in ("image/png", "image/jpeg", "application/pdf")
        return FileResponse(path, media_type=media_type, filename=name,
                            content_disposition_type="inline" if inline else "attachment")

    @app.post("/api/analyze")
    def analyze(request: AnalyzeRequest):
        return store.save_analysis(run_analysis(request))

    def fleet() -> list[dict]:
        """Every inspectable object: state as of its last journal record (or a fresh check), and service."""
        rows = []
        for item in list_catalog()["objects"]:
            if not item["inspectable"]:
                continue
            run = run_analysis(AnalyzeRequest(equipment_id=item["id"],
                                              scenario_id="normal" if item["scenarios_available"] else None))
            service = run["evaluation"]["maintenance"]
            last = next(iter(store.events(item["id"])), None)
            state = last["analysis"]["evaluation"] if last else run["evaluation"]
            severities = {alert["severity"] for alert in state["alerts"]}
            results = [rule for rule in state["rule_results"] if rule["status"] != "not_applicable"]
            status = ("critical" if "critical" in severities else "warning" if state["alerts"]
                      else "unknown" if not results or all(rule["status"] == "insufficient" for rule in results)
                      else "normal")
            rows.append({"equipment_id": item["id"], "name": item["name"], "serial": item["serial"],
                         "documented": item["documented"], "type_name": item["type_name"],
                         "status": status, "alerts": len(state["alerts"]),
                         "runtime_hours": service.get("runtime_hours"), "norm_hours": service.get("norm_hours"),
                         "next_service_hours": service.get("next_service_hours"),
                         "due_in_hours": service.get("due_in_hours"),
                         "last_event_at": last["created_at"] if last else None})
        return rows

    @app.get("/api/objects")
    def objects_overview():
        """The round: objects needing attention first; nothing is stored."""
        order = {"critical": 0, "warning": 1, "unknown": 2, "normal": 3}
        return sorted(fleet(), key=lambda row: (order[row["status"]], row["name"]))

    @app.get("/api/maintenance/plan")
    def maintenance_plan():
        """Every inspectable object's motor hours and next service, soonest first; nothing is stored."""
        return sorted(fleet(), key=lambda row: (row["due_in_hours"] is None, row["due_in_hours"] or 0, row["name"]))

    def run_analysis(request: AnalyzeRequest) -> dict:
        try:
            target = card(request.equipment_id)
            components = component_ids(request.equipment_id)
            equipment_type = equipment_type_of(request.equipment_id)
        except KeyError as exc:
            raise HTTPException(404, "Объект не найден в каталоге") from exc
        if not target["inspectable"]:
            raise HTTPException(422, "Это позиция по проекту, а не отдельная машина. "
                                     "Выберите объект с серийным номером.")
        if request.scenario_id is not None and not target["scenarios_available"]:
            raise HTTPException(422, "Демонстрационные сценарии принадлежат объекту pump-101. "
                                     "Их телеметрию нельзя приписывать другому оборудованию.")
        scenario = None
        if request.scenario_id is not None:
            try:
                scenario = get_scenario(request.scenario_id)
            except (KeyError, ValueError) as exc:
                raise HTTPException(404, "Сценарий не найден") from exc
        observations = list(scenario["observations"]) if scenario else []
        image_id = None
        if request.image:
            try:
                validate_image(request.image)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            image_id = store.save_image(request.image)
        if request.vision_id:
            try:
                saved = store.analysis(request.vision_id)
            except KeyError as exc:
                raise HTTPException(404, "Результат анализа снимка не найден") from exc
            if saved.get("type") != "vision":
                raise HTTPException(422, "Указанная запись не является анализом снимка")
            observations = [item for item in observations if item["kind"] not in vision_kinds]
            observations.extend(saved["observations"])
            image_id = saved.get("image_id", image_id)
        vocabulary = measurement_vocabulary(equipment_type)
        for key, value in request.measurements.items():
            if key not in vocabulary:
                raise HTTPException(422, f"Измерение «{key}» не предусмотрено для типа "
                                         f"«{target['type_name']}»: доступные входы перечислены "
                                         "в /api/catalog.")
            if vocabulary[key]["kind"] == "boolean" and not isinstance(value, bool):
                raise HTTPException(422, f"Измерение «{key}» дискретное и принимает только true или false.")
            if vocabulary[key]["kind"] == "number" and isinstance(value, bool):
                raise HTTPException(422, f"Измерение «{key}» числовое и логическое значение не принимает.")
        applicable = {item["id"] for item in applicable_classes(request.equipment_id)}
        for finding in request.findings:
            if finding.class_id not in applicable:
                raise HTTPException(422, f"Класс «{finding.class_id}» неприменим к типу "
                                         f"«{target['type_name']}».")
        now = datetime.now(timezone.utc).isoformat()
        for item in request.observations:
            component = observation_components[item.kind]
            if component not in components:
                raise HTTPException(422, f"Наблюдение «{item.kind}» относится к узлу «{component}», "
                                         f"которого нет в составе типа «{target['type_name']}». "
                                         "Словарь ручных наблюдений описан для центробежного агрегата.")
            observations = [old for old in observations if old["kind"] != item.kind]
            observed_at = item.timestamp.isoformat() if item.timestamp else now
            observations.append({**item.model_dump(mode="json"), "source": "manual", "timestamp": observed_at,
                                 "component_id": component})
        telemetry = scenario["telemetry"] if scenario else {"source": "manual", "samples": [],
                                                           "runtime_hours": None, "last_service_hours": None}
        # Only whole-aggregate maintenance of this same object updates its service counter.
        runtime = telemetry.get("runtime_hours")
        maintenance = next((event for event in store.events(request.equipment_id)
                            if event["component_id"] == "pump" and event["action"] == "maintenance"
                            and isinstance(runtime, (int, float))
                            and isinstance(event["analysis"].get("telemetry", {}).get("runtime_hours"), (int, float))
                            and event["analysis"]["telemetry"]["runtime_hours"] <= runtime), None)
        if maintenance:
            telemetry["last_service_hours"] = max(telemetry["last_service_hours"] or 0,
                                                  maintenance["analysis"]["telemetry"]["runtime_hours"])
        title = scenario["title"] if scenario else "Осмотр без телеметрии"
        series = target.get("telemetry")
        if scenario is None and series:
            # The organizer's series replayed as this object's telemetry, one hourly record at a time.
            rows = merged_series(series["series"])
            total = len(rows)
            end = len(rows) - 1 if request.series_index is None else min(request.series_index, len(rows) - 1)
            io, io_error = None, None
            if io_address and request.series_index is None:
                # «Now» is whatever the I/O server reports; history browsing still reads the stored series.
                try:
                    io = read_io(io_address)
                    end = min(io["record_index"], len(rows) - 1)
                    rows = rows[:end] + [{**rows[end], **{key: value for key, value in io.items()
                                                          if key not in ("record_index", "running", "read_at", "address")}}]
                except OSError as exc:
                    io_error = str(exc)
            running = sum(1 for row in rows[:end + 1] if (row.get("rpm") or 0) > 0)
            telemetry = {"source": "modbus" if io else "series", "series": series["series"], "record_index": end,
                         "io": {"address": io["address"], "read_at": io["read_at"], "running": io["running"]} if io else None,
                         "io_error": io_error,
                         "samples": [{key: value for key, value in row.items() if key != "annotations"}
                                     for row in rows[max(0, end - 9):end + 1]],
                         "organizer_annotations": rows[end]["annotations"],
                         "runtime_hours": running, "last_service_hours": None}
            evaluation = evaluate_series(rows[max(0, end - 9):end + 1],
                                         {"running_hours": running, "rule": series["rule"]},
                                         target.get("maintenance_schedule", []))
            title = (f"Сервер ввода/вывода · запись {end + 1} из {total}" if io
                     else f"Ряды организатора · запись {end + 1} из {total}")
        elif scenario is not None:
            evaluation = evaluate(telemetry, observations, equipment_type=equipment_type)
        else:
            # Documented objects have no telemetry: their rules read measurements the engineer took
            # with a named instrument, visible findings and the journal.
            evaluation = evaluate_documented(
                equipment_type, measurements=request.measurements,
                findings=[item.model_dump() for item in request.findings],
                events=store.events(request.equipment_id), card=target)
        return {"type": "inspection", "equipment_id": request.equipment_id,
                                    "equipment_type": equipment_type,
                                    "scenario_id": scenario["id"] if scenario else None,
                                    "scenario_title": title,
                                    "telemetry": telemetry,
                                    "measurements": request.measurements,
                                    "findings": [item.model_dump() for item in request.findings],
                                    "observations": observations, "vision_id": request.vision_id, "image_id": image_id,
                                    "evaluation": evaluation}

    @app.get("/api/inspections")
    def history(equipment_id: str | None = None):
        return store.events(equipment_id)

    @app.post("/api/inspections", status_code=201)
    def save_event(request: EventRequest, http: Request):
        user = http.state.user
        if request.action in ("maintenance", "replacement") and "record_maintenance" not in user["permissions"]:
            raise HTTPException(403, "Обслуживание и замену записывает мастер или администратор")
        try:
            components = component_ids(request.equipment_id)
        except KeyError as exc:
            raise HTTPException(404, "Объект не найден в каталоге") from exc
        if request.component_id not in components:
            raise HTTPException(422, "Неизвестный компонент")
        try:
            run = store.analysis(request.analysis_id)
        except KeyError as exc:
            raise HTTPException(404, "Исходный осмотр не найден") from exc
        if run.get("type") != "inspection":
            raise HTTPException(422, "Сначала выполните диагностику оборудования")
        if run.get("equipment_id", DEMO_ID) != request.equipment_id:
            raise HTTPException(422, "Осмотр относится к другому объекту: "
                                     "историю разных объектов смешивать нельзя.")
        # With sign-in on, the author is whoever is signed in; the request cannot name someone else.
        author = user["name"] if auth_enabled else request.author.strip()
        return store.add_event(request.analysis_id, request.equipment_id, request.component_id,
                               request.action, request.notes.strip(), author,
                               result=request.result or event_result(request.action, run),
                               source=request.source, finding=request.finding.strip())

    @app.post("/api/vision")
    async def analyze_image(request: ImageRequest):
        try:
            validate_image(request.image)
            result = await vision.analyze(request.image)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except VisionError as exc:
            raise HTTPException(502, str(exc)) from exc
        return store.save_analysis({**result, "type": "vision", "image_id": store.save_image(request.image)})

    @app.post("/api/live/sessions", status_code=201)
    def open_live_session(request: LiveSessionRequest):
        try:
            card(request.equipment_id)
        except KeyError as exc:
            raise HTTPException(404, "Объект не найден в каталоге") from exc
        return live.open(request.equipment_id)

    @app.post("/api/live/sessions/{session_id}/frames/{frame_no}")
    async def live_frame(request: Request, session_id: str = PathParam(max_length=64),
                         frame_no: int = PathParam(ge=0)):
        # The frame is raw JPEG, not base64 JSON: a third less to send for every frame.
        body = await request.body()
        try:
            return await run_in_threadpool(live.frame, session_id, frame_no, body)
        except FrameError as exc:
            raise HTTPException(exc.status, str(exc)) from exc

    @app.post("/api/nameplate")
    async def read_nameplate(request: Request):
        """One camera frame of a factory nameplate → the catalogue object it names, or candidates."""
        body = await request.body()
        if len(body) > 4_000_000:
            raise HTTPException(413, "Кадр больше 4 МБ")
        if not body.startswith(b"\xff\xd8\xff"):
            raise HTTPException(415, "Кадр должен быть в формате JPEG")
        if not nameplates.available():
            raise HTTPException(503, "Чтение таблички недоступно: на сервере не установлен rapidocr_onnxruntime "
                                     "(requirements-detector.txt). Опознайте агрегат по QR или выберите вручную")
        try:
            lines = await run_in_threadpool(nameplates.read, body)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return match_nameplate(lines, list_catalog()["objects"])

    @app.post("/api/live/findings", status_code=201)
    def confirm_live_finding(request: LiveFindingRequest, http: Request):
        """Record a confirmed camera finding: a new inspection with the frame, then a journal entry."""
        try:
            components = component_ids(request.equipment_id)
            equipment_type = equipment_type_of(request.equipment_id)
        except KeyError as exc:
            raise HTTPException(404, "Объект не найден в каталоге") from exc
        applicable = {item["id"] for item in applicable_classes(request.equipment_id)}
        observation, finding, component = plan_finding(request.kind, equipment_type, components, applicable,
                                                       observation_components)
        if component is None:
            raise HTTPException(422, f"Признак «{request.label}» не относится ни к одному узлу этого "
                                     "оборудования: записать его некуда.")
        observations = [item for item in request.observations if item.kind != observation]
        if observation:
            observations.append(ManualObservation(kind=observation, present=True))
        run = analyze(AnalyzeRequest(
            equipment_id=request.equipment_id, scenario_id=request.scenario_id, observations=observations,
            findings=[Finding(class_id=finding, present=True)] if finding else [], image=request.image))
        # The record states what was found and by what as fields; the frame stays with the inspection.
        author = http.state.user["name"] if auth_enabled else request.author.strip()
        certainty = f" · {round(request.confidence * 100)}%" if request.confidence is not None else ""
        event = store.add_event(run["id"], request.equipment_id, component, "defect", "", author,
                                result="remark", source="camera", finding=f"{request.label}{certainty}")
        return {"analysis": run, "event": event, "component_id": component}

    @app.get("/api/images/{image_id}")
    def image_evidence(image_id: str):
        try:
            image = store.image(image_id)
        except KeyError as exc:
            raise HTTPException(404, "Снимок не найден") from exc
        prefix, payload = image.split(",", 1)
        return Response(content=base64.b64decode(payload), media_type=prefix.removeprefix("data:").split(";")[0])

    dist = ROOT / "apps" / "web" / "dist"
    if dist.is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}")
        def frontend(path: str):
            # An unmatched API path is an error, not a page: answering it with index.html and 200
            # would hand HTML to a client expecting JSON and hide a wrong URL.
            if path == "api" or path.startswith("api/"):
                raise HTTPException(404, "Неизвестный адрес API")
            candidate = (dist / path).resolve()
            if candidate.is_relative_to(dist.resolve()) and candidate.is_file():
                # Python does not know the web app manifest type; browsers want it to install the app.
                media = "application/manifest+json" if candidate.suffix == ".webmanifest" else None
                return FileResponse(candidate, media_type=media)
            return FileResponse(dist / "index.html")

    return app


vision_kinds = set(VISUAL_COMPONENTS)
observation_components = {**VISUAL_COMPONENTS, "flow_instability": "inlet", "cavitation_noise": "inlet"}
