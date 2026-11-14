"""HTTP boundary for the local pump-inspection prototype."""

import os
import base64
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.catalog import DEMO_ID, card, component_ids, equipment_type_of, list_catalog
from app.registry import applicable_classes
from app.demo import get_scenario, get_scenarios
from app.diagnostics.documented import evaluate_documented, measurement_vocabulary
from app.diagnostics.engine import evaluate
from app.library import list_library, resolve as resolve_source
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
    vision_id: str | None = None
    image: str | None = Field(default=None, max_length=8_000_000)


class EventRequest(BaseModel):
    analysis_id: str = Field(max_length=50)
    equipment_id: str = Field(default=DEMO_ID, max_length=60)
    component_id: str = Field(max_length=30)
    action: Literal["inspection", "defect", "maintenance", "replacement"]
    notes: str = Field(default="", max_length=2000)
    author: str = Field(default="Демо-инженер", min_length=1, max_length=100)


class ImageRequest(BaseModel):
    image: str = Field(max_length=8_000_000)


def create_app(db_path: str | Path | None = None) -> FastAPI:
    app = FastAPI(title="КОНТУР · Inspection API", version="0.1.0")
    store = Store(db_path or os.getenv("APP_DB_PATH", str(ROOT / "data" / "inspection.db")))
    vision = VisionClient(os.getenv("LOCAL_VISION_URL", "http://127.0.0.1:8081/v1"),
                          os.getenv("LOCAL_VISION_MODEL", "Qwen3-VL-4B-Instruct"))

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
        if scenario is not None:
            evaluation = evaluate(telemetry, observations, equipment_type=equipment_type)
        else:
            # Documented objects have no telemetry: their rules read measurements the engineer took
            # with a named instrument, visible findings and the journal.
            evaluation = evaluate_documented(
                equipment_type, measurements=request.measurements,
                findings=[item.model_dump() for item in request.findings],
                events=store.events(request.equipment_id), card=target)
        return store.save_analysis({"type": "inspection", "equipment_id": request.equipment_id,
                                    "equipment_type": equipment_type,
                                    "scenario_id": scenario["id"] if scenario else None,
                                    "scenario_title": scenario["title"] if scenario else "Осмотр без телеметрии",
                                    "telemetry": telemetry,
                                    "measurements": request.measurements,
                                    "findings": [item.model_dump() for item in request.findings],
                                    "observations": observations, "vision_id": request.vision_id, "image_id": image_id,
                                    "evaluation": evaluation})

    @app.get("/api/inspections")
    def history(equipment_id: str | None = None):
        return store.events(equipment_id)

    @app.post("/api/inspections", status_code=201)
    def save_event(request: EventRequest):
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
        return store.add_event(request.analysis_id, request.equipment_id, request.component_id,
                               request.action, request.notes.strip(), request.author.strip())

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
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app


vision_kinds = set(VISUAL_COMPONENTS)
observation_components = {**VISUAL_COMPONENTS, "flow_instability": "inlet", "cavitation_noise": "inlet"}
