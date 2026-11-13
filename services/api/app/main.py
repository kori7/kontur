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

from app.demo import get_scenario, get_scenarios
from app.diagnostics.engine import evaluate
from app.equipment import COMPONENT_IDS, equipment_card
from app.storage import Store
from app.vision import VISUAL_COMPONENTS, VisionClient, VisionError, validate_image

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")


class ManualObservation(BaseModel):
    kind: Literal["guard_missing", "liquid_leak", "missing_bolt", "base_corrosion", "oil_low",
                  "oil_degraded", "contact_damage", "flow_instability", "cavitation_noise"]
    present: bool
    timestamp: datetime | None = None


class AnalyzeRequest(BaseModel):
    scenario_id: str = Field(default="normal", max_length=50)
    observations: list[ManualObservation] = Field(default_factory=list, max_length=15)
    vision_id: str | None = None
    image: str | None = Field(default=None, max_length=8_000_000)


class EventRequest(BaseModel):
    analysis_id: str = Field(max_length=50)
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
        return {"equipment": equipment_card(store.events()), "scenarios": get_scenarios(),
                "vision": {"configured": True, "model": vision.model, "offline": True,
                           "provider": "llama.cpp · локальный сервер", "supported": list(VISUAL_COMPONENTS)}}

    @app.get("/api/vision/status")
    async def vision_status():
        return await vision.status()

    @app.get("/api/equipment")
    def equipment():
        return equipment_card(store.events())

    @app.post("/api/analyze")
    def analyze(request: AnalyzeRequest):
        try:
            scenario = get_scenario(request.scenario_id)
        except (KeyError, ValueError) as exc:
            raise HTTPException(404, "Сценарий не найден") from exc
        observations = list(scenario["observations"])
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
        now = datetime.now(timezone.utc).isoformat()
        for item in request.observations:
            observations = [old for old in observations if old["kind"] != item.kind]
            observed_at = item.timestamp.isoformat() if item.timestamp else now
            observations.append({**item.model_dump(mode="json"), "source": "manual", "timestamp": observed_at,
                                 "component_id": observation_components[item.kind]})
        telemetry = scenario["telemetry"]
        # Only whole-aggregate maintenance updates the aggregate service counter.
        runtime = telemetry.get("runtime_hours")
        maintenance = next((event for event in store.events()
                            if event["component_id"] == "pump" and event["action"] == "maintenance"
                            and isinstance(runtime, (int, float))
                            and isinstance(event["analysis"].get("telemetry", {}).get("runtime_hours"), (int, float))
                            and event["analysis"]["telemetry"]["runtime_hours"] <= runtime), None)
        if maintenance:
            telemetry["last_service_hours"] = max(telemetry["last_service_hours"] or 0,
                                                  maintenance["analysis"]["telemetry"]["runtime_hours"])
        return store.save_analysis({"type": "inspection", "scenario_id": scenario["id"],
                                    "scenario_title": scenario["title"], "telemetry": telemetry,
                                    "observations": observations, "vision_id": request.vision_id, "image_id": image_id,
                                    "evaluation": evaluate(telemetry, observations)})

    @app.get("/api/inspections")
    def history():
        return store.events()

    @app.post("/api/inspections", status_code=201)
    def save_event(request: EventRequest):
        if request.component_id not in COMPONENT_IDS:
            raise HTTPException(422, "Неизвестный компонент")
        try:
            run = store.analysis(request.analysis_id)
            if run.get("type") != "inspection":
                raise HTTPException(422, "Сначала выполните диагностику оборудования")
            return store.add_event(request.analysis_id, request.component_id, request.action,
                                   request.notes.strip(), request.author.strip())
        except KeyError as exc:
            raise HTTPException(404, "Исходный осмотр не найден") from exc

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
            candidate = (dist / path).resolve()
            if candidate.is_relative_to(dist.resolve()) and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app


vision_kinds = set(VISUAL_COMPONENTS)
observation_components = {"guard_missing": "guard", "liquid_leak": "seal", "missing_bolt": "base",
                          "base_corrosion": "base", "oil_low": "bearing", "oil_degraded": "bearing",
                          "contact_damage": "motor", "flow_instability": "inlet", "cavitation_noise": "inlet"}
