"""Live camera sessions: the phone sends frames one at a time, the server answers with boxes.

The client never queues: it sends the next frame only after the previous answer. The server keeps
the same promise across sessions — while one frame is being analysed, another is answered at once
as ``busy`` instead of waiting in line. A frame older than one already answered is ``stale``.

A sign counts as confirmed once it is seen in 3 of the last 5 analysed frames: one frame can be a
glare or a shadow. Every answer carries one of the categories required by the brief (§4.2):
«видимых проблем не обнаружено», «рекомендуется проверка», «обнаружены признаки возможного
дефекта» — plus two honest states for a detector that is not ready or has not seen enough frames.

Frames are analysed in memory and not stored. Keeping a frame as evidence is a separate,
explicit step of the inspection record.
"""

import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Protocol

MAX_FRAME_BYTES = 2_000_000
MAX_SIDE = 640
MAX_SESSIONS = 32
JPEG_SIGNATURE = b"\xff\xd8\xff"
CONFIRM_WINDOW = 5
CONFIRM_HITS = 3


@dataclass(frozen=True)
class Detection:
    kind: str
    label: str
    bbox: tuple[float, float, float, float]
    confidence: float | None = None


class Detector(Protocol):
    name: str
    ready: bool

    def detect(self, jpeg: bytes) -> list[Detection]: ...


class NullDetector:
    """Stand-in until a model is connected: it finds nothing and says that it is not a model."""

    ready = False

    def __init__(self, reason: str = ""):
        self.name = "не подключён" + (f": {reason}" if reason else "")

    def detect(self, jpeg: bytes) -> list[Detection]:
        return []


class FrameError(ValueError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _valid(item: Detection) -> dict | None:
    """A box the overlay can draw, or None. Coordinates are clipped to the frame."""
    if len(item.bbox) != 4:
        return None
    x1, y1, x2, y2 = (min(max(float(value), 0.0), 1.0) for value in item.bbox)
    if x2 <= x1 or y2 <= y1:
        return None
    confidence = item.confidence
    if confidence is not None and not 0 <= confidence <= 1:
        return None
    return {"kind": item.kind, "label": item.label, "bbox": [x1, y1, x2, y2], "confidence": confidence}


class LiveSessions:
    def __init__(self, detector: Detector | None = None):
        self.detector = detector or NullDetector()
        self._sessions: dict[str, dict] = {}
        self._guard = threading.Lock()
        self._busy = threading.Lock()

    def describe_detector(self) -> dict:
        return {"name": self.detector.name, "ready": bool(self.detector.ready)}

    def open(self, equipment_id: str) -> dict:
        session_id = uuid.uuid4().hex
        with self._guard:
            while len(self._sessions) >= MAX_SESSIONS:
                self._sessions.pop(next(iter(self._sessions)))
            self._sessions[session_id] = {"equipment_id": equipment_id, "last_frame": -1, "processed": 0,
                                          "recent": deque(maxlen=CONFIRM_WINDOW)}
        return {"session_id": session_id, "equipment_id": equipment_id, "max_side": MAX_SIDE,
                "detector": self.describe_detector()}

    def frame(self, session_id: str, frame_no: int, jpeg: bytes) -> dict:
        with self._guard:
            session = self._sessions.get(session_id)
        if session is None:
            raise FrameError(404, "Сессия камеры не найдена. Включите камеру заново")
        if len(jpeg) > MAX_FRAME_BYTES:
            raise FrameError(413, "Кадр больше 2 МБ. Уменьшите разрешение")
        if not jpeg.startswith(JPEG_SIGNATURE):
            raise FrameError(415, "Кадр должен быть в формате JPEG")
        answer = {"session_id": session_id, "frame_no": frame_no, "detections": [],
                  "detector": self.describe_detector(), "server_ms": 0}
        if frame_no <= session["last_frame"]:
            return {**answer, "status": "stale"}
        if not self._busy.acquire(blocking=False):
            return {**answer, "status": "busy"}
        try:
            started = time.perf_counter()
            found = self.detector.detect(jpeg)
            elapsed = round((time.perf_counter() - started) * 1000)
        finally:
            self._busy.release()
        detections = [box for box in (_valid(item) for item in found) if box is not None]
        with self._guard:
            if frame_no <= session["last_frame"]:
                return {**answer, "status": "stale"}
            session["last_frame"] = frame_no
            session["processed"] += 1
            session["recent"].append({box["kind"] for box in detections})
            hits = {}
            for kinds in session["recent"]:
                for kind in kinds:
                    hits[kind] = hits.get(kind, 0) + 1
            processed = session["processed"]
        confirmed = sorted(kind for kind, count in hits.items() if count >= CONFIRM_HITS)
        for box in detections:
            box["confirmed"] = box["kind"] in confirmed
        return {**answer, "status": "processed", "detections": detections, "server_ms": elapsed,
                "confirmed_kinds": confirmed,
                "assessment": self._assess(detections, hits, confirmed, processed)}

    def _assess(self, detections, hits, confirmed, processed) -> str:
        if not self.detector.ready:
            return "unavailable"
        if confirmed:
            return "possible_defect"
        if detections or hits:
            return "check_recommended"
        if processed < CONFIRM_WINDOW:
            return "warming_up"
        return "no_visible_issues"
