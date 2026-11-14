"""Identify equipment by its factory nameplate: read the text on one camera frame, find the object.

Equipment on site carries factory nameplates in Latin script (organizer answers §7). RapidOCR runs
the PaddleOCR detection and recognition models (Apache 2.0) on onnxruntime; the models ship inside
the package, so nothing is downloaded at run time.

OCR confuses look-alike characters — O and 0, I and 1 — so the comparison folds them the same way on
both sides. A number is matched only as a whole token sequence, and more than one candidate is never
resolved by guessing: the engineer chooses.
"""

import re
import threading

# Characters OCR mixes up on stamped plates, folded to one form on both sides of the comparison.
CONFUSABLE = str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "|": "1", "S": "5", "B": "8",
                            "Z": "2"})
MIN_SCORE = 0.6
MIN_KEY = 5


def fold(text: str) -> str:
    """Upper case, look-alikes folded, separators dropped: «DEM0-2026-001» and «DEMO 2026 001» agree."""
    return re.sub(r"[^A-Z0-9]", "", text.upper().translate(CONFUSABLE))


def match(lines: list[tuple[str, float]], objects: list[dict]) -> dict:
    """Objects whose serial number or catalogue id appears on the plate, with the line it came from."""
    readable = [(text, score) for text, score in lines if score >= MIN_SCORE]
    folded = [(fold(text), text, score) for text, score in readable]
    whole = fold(" ".join(text for text, _ in readable))
    found = []
    for item in objects:
        if not item.get("inspectable", True):
            continue
        for field in ("serial", "id"):
            key = fold(item.get(field) or "")
            if len(key) < MIN_KEY:
                continue
            line = next(((text, score) for folded_text, text, score in folded if key in folded_text), None)
            if line is None and key in whole:
                line = (" ".join(text for text, _ in readable), min(score for _, score in readable))
            if line:
                found.append({"id": item["id"], "name": item["name"], "serial": item.get("serial"),
                              "matched": field, "line": line[0], "score": round(line[1], 2)})
                break
    status = "found" if len(found) == 1 else "ambiguous" if found else "none"
    return {"status": status, "matches": found, "lines": [text for text, _ in readable]}


class NameplateReader:
    """Loads the OCR engine on first use; reports why it cannot read if the package is missing."""

    def __init__(self):
        self._engine = None
        self._lock = threading.Lock()

    def available(self) -> bool:
        try:
            import rapidocr_onnxruntime  # noqa: F401
        except ImportError:
            return False
        return True

    def read(self, jpeg: bytes) -> list[tuple[str, float]]:
        import cv2
        import numpy as np

        image = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Кадр не читается как изображение")
        with self._lock:
            if self._engine is None:
                from rapidocr_onnxruntime import RapidOCR

                self._engine = RapidOCR()
            result, _ = self._engine(image)
        return [(text, float(score)) for _, text, score in (result or [])]
