"""Nameplate identification: OCR look-alikes, whole-number matching, no guessing between candidates."""

from fastapi.testclient import TestClient

from app.catalog import list_catalog
from app.main import create_app
from app.nameplate import fold, match

OBJECTS = list_catalog()["objects"]
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32


def test_look_alike_characters_and_separators_fold_the_same_way():
    assert fold("DEM0-2026-001") == fold("DEMO 2026 001")
    assert fold("SAL023020084_001") == fold("5AL O23O2OO84 OO1")


def test_stand_nameplate_as_ocr_read_it_finds_the_demo_pump():
    # Lines as RapidOCR returned them from the printed stand, including its O→0 slip.
    lines = [("KONTURDEMOPUMPS", 0.99), ("CENTRIFUGAL PUMP UNIT N-101", 0.98), ("SERIAL NO.", 0.95),
             ("DEM0-2026-001", 0.99), ("CATALOGUEID pump-101", 0.97), ("2026", 1.0)]
    result = match(lines, OBJECTS)
    assert result["status"] == "found"
    assert result["matches"][0]["id"] == "pump-101" and result["matches"][0]["matched"] == "serial"


def test_shared_number_prefix_does_not_pick_one_object_by_guessing():
    result = match([("S/N 21031004", 0.95)], OBJECTS)
    assert result["status"] == "none"
    both = match([("21031004-1", 0.95), ("21031004-2", 0.95)], OBJECTS)
    assert both["status"] == "ambiguous"
    assert {item["id"] for item in both["matches"]} == {"pcp-21031004-1", "pcp-21031004-2"}


def test_low_confidence_lines_are_not_used():
    assert match([("DEMO-2026-001", 0.3)], OBJECTS)["status"] == "none"


def test_project_positions_are_never_identified_as_machines():
    tag = next(item for item in OBJECTS if not item["inspectable"])
    assert match([(tag["id"], 0.99)], OBJECTS)["status"] == "none"


class FakeReader:
    def __init__(self, lines):
        self.lines = lines

    def available(self):
        return True

    def read(self, jpeg):
        return self.lines


def test_endpoint_reads_a_frame_and_refuses_non_jpeg(tmp_path, monkeypatch):
    from app import main

    monkeypatch.setattr(main, "NameplateReader", lambda: FakeReader([("DEM0-2026-001", 0.99)]))
    with TestClient(create_app(tmp_path / "app.db")) as client:
        found = client.post("/api/nameplate", content=JPEG, headers={"Content-Type": "image/jpeg"})
        wrong = client.post("/api/nameplate", content=b"\x89PNG", headers={"Content-Type": "image/png"})
    assert found.status_code == 200 and found.json()["matches"][0]["id"] == "pump-101"
    assert wrong.status_code == 415
