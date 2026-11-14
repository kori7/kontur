"""Live camera sessions: one frame at a time, stale and busy frames answered without analysis."""

import threading

from fastapi.testclient import TestClient

from app.live import Detection, LiveSessions
from app.main import create_app

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


class BoxDetector:
    name = "test"
    ready = True

    def __init__(self, boxes):
        self.boxes = boxes

    def detect(self, jpeg):
        return self.boxes


def send(client, session_id, frame_no, body=JPEG):
    return client.post(f"/api/live/sessions/{session_id}/frames/{frame_no}", content=body,
                       headers={"Content-Type": "image/jpeg"})


def test_session_reports_that_no_detector_is_connected(tmp_path, monkeypatch):
    monkeypatch.setenv("KONTUR_DETECTOR", "none")
    with TestClient(create_app(tmp_path / "app.db")) as client:
        opened = client.post("/api/live/sessions", json={"equipment_id": "pump-101"})
        assert opened.status_code == 201, opened.text
        session = opened.json()
        assert session["detector"] == {"name": "не подключён", "ready": False}
        assert session["max_side"] == 640
        answer = send(client, session["session_id"], 0).json()
        assert answer["status"] == "processed"
        assert answer["detections"] == []
        assert answer["assessment"] == "unavailable"


def test_unknown_equipment_and_session_are_rejected(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        assert client.post("/api/live/sessions", json={"equipment_id": "nope"}).status_code == 404
        assert send(client, "missing", 0).status_code == 404


def test_frame_must_be_a_small_jpeg(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        session_id = client.post("/api/live/sessions", json={}).json()["session_id"]
        assert send(client, session_id, 0, b"\x89PNG\r\n\x1a\n").status_code == 415
        assert send(client, session_id, 1, JPEG + b"\x00" * 2_000_000).status_code == 413
        assert send(client, session_id, -1).status_code == 422


def test_boxes_are_clipped_and_invalid_ones_dropped(tmp_path):
    detector = BoxDetector([
        Detection("guard_missing", "Нет кожуха", (-0.1, 0.2, 0.5, 1.3), 0.81),
        Detection("liquid_leak", "Жидкость", (0.6, 0.6, 0.6, 0.9), 0.9),
        Detection("frame_corrosion", "Коррозия", (0.1, 0.1, 0.2, 0.2), 1.5),
        Detection("missing_bolt", "Нет болта", (0.1, 0.1, 0.3, 0.3)),
    ])
    with TestClient(create_app(tmp_path / "app.db", detector=detector)) as client:
        session_id = client.post("/api/live/sessions", json={}).json()["session_id"]
        boxes = send(client, session_id, 0).json()["detections"]
    assert boxes == [
        {"kind": "guard_missing", "label": "Нет кожуха", "bbox": [0.0, 0.2, 0.5, 1.0], "confidence": 0.81,
         "confirmed": False},
        {"kind": "missing_bolt", "label": "Нет болта", "bbox": [0.1, 0.1, 0.3, 0.3], "confidence": None,
         "confirmed": False},
    ]


def test_older_frame_than_one_answered_is_stale():
    live = LiveSessions(BoxDetector([Detection("guard_missing", "Нет кожуха", (0, 0, 1, 1), 0.9)]))
    session_id = live.open("pump-101")["session_id"]
    assert live.frame(session_id, 5, JPEG)["status"] == "processed"
    stale = live.frame(session_id, 3, JPEG)
    assert stale["status"] == "stale"
    assert stale["detections"] == []


def test_second_frame_is_not_queued_while_one_is_analysed():
    entered, release = threading.Event(), threading.Event()

    class SlowDetector:
        name = "slow"
        ready = True

        def detect(self, jpeg):
            entered.set()
            release.wait(5)
            return []

    live = LiveSessions(SlowDetector())
    first_session = live.open("pump-101")["session_id"]
    other_session = live.open("pump-101")["session_id"]
    results = {}
    worker = threading.Thread(target=lambda: results.update(first=live.frame(first_session, 0, JPEG)))
    worker.start()
    assert entered.wait(5)
    assert live.frame(other_session, 0, JPEG)["status"] == "busy"
    release.set()
    worker.join(5)
    assert results["first"]["status"] == "processed"
    # A frame answered as busy was not consumed: the same number can be sent again.
    assert live.frame(other_session, 0, JPEG)["status"] == "processed"


class SequenceDetector:
    """Answers with the next prepared list of boxes on each frame."""

    name = "sequence"
    ready = True

    def __init__(self, frames):
        self.frames = list(frames)

    def detect(self, jpeg):
        return self.frames.pop(0)


GUARD = Detection("guard_missing", "Открытая муфта", (0.2, 0.2, 0.6, 0.6), 0.5)


def run(frames):
    live = LiveSessions(SequenceDetector(frames))
    session_id = live.open("pump-101")["session_id"]
    return [live.frame(session_id, number, JPEG) for number in range(len(frames))]


def test_sign_is_confirmed_on_three_of_five_frames():
    answers = run([[GUARD], [], [GUARD], [], [GUARD], [], [], []])
    confirmed = [answer["detections"][0]["confirmed"] if answer["detections"] else None for answer in answers]
    assert confirmed == [False, None, False, None, True, None, None, None]
    assert [answer["assessment"] for answer in answers] == [
        "check_recommended", "check_recommended", "check_recommended", "check_recommended",
        # Frame 6 looks back at frames 2–6: the sign is there only twice, so it is no longer confirmed.
        "possible_defect", "check_recommended", "check_recommended", "check_recommended"]
    assert answers[4]["confirmed_kinds"] == ["guard_missing"]


def test_clear_view_needs_a_full_window_before_saying_no_visible_issues():
    answers = run([[]] * 6)
    assert [answer["assessment"] for answer in answers] == [
        "warming_up", "warming_up", "warming_up", "warming_up", "no_visible_issues", "no_visible_issues"]


def test_a_sign_seen_recently_keeps_the_check_recommendation():
    answers = run([[GUARD], [], [], [], [], []])
    assert [answer["assessment"] for answer in answers] == [
        "check_recommended"] * 5 + ["no_visible_issues"]


FRAME = "data:image/jpeg;base64," + __import__("base64").b64encode(JPEG).decode()


def confirm(client, **fields):
    body = {"equipment_id": "pump-101", "scenario_id": "normal", "kind": "guard_missing",
            "label": "Нет кожуха муфты", "confidence": 0.62, "detector": "RF-DETR, дообучен", "image": FRAME}
    return client.post("/api/live/findings", json=body | fields)


def test_confirmed_finding_feeds_the_rules_and_the_journal_with_its_frame(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        answer = confirm(client)
        assert answer.status_code == 201, answer.text
        body = answer.json()
        assert body["component_id"] == "guard"
        assert body["analysis"]["image_id"]
        assert any("R11" in alert["rule_ids"] for alert in body["analysis"]["evaluation"]["alerts"])
        event = client.get("/api/inspections", params={"equipment_id": "pump-101"}).json()[0]
        assert (event["action"], event["component_id"]) == ("defect", "guard")
        assert "уверенность 62%" in event["notes"] and "подтверждён инженером" in event["notes"]
        assert client.get(f"/api/images/{body['analysis']['image_id']}").status_code == 200


def test_corrosion_becomes_the_frame_corrosion_input_and_keeps_earlier_manual_observations(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        body = confirm(client, kind="frame_corrosion", label="Коррозия",
                       observations=[{"kind": "missing_bolt", "present": True}]).json()
    kinds = {item["kind"]: item["source"] for item in body["analysis"]["observations"] if item["source"] == "manual"}
    assert kinds == {"missing_bolt": "manual", "base_corrosion": "manual"}
    assert body["component_id"] == "base"


def test_documented_objects_receive_registry_findings(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        pump = confirm(client, equipment_id="pcp-21031004-1", scenario_id=None).json()
        gearbox = confirm(client, equipment_id="gearbox-SAL023020084", scenario_id=None,
                          kind="oil_leak_at_housing", label="Подтёк масла").json()
    assert pump["analysis"]["findings"] == [{"class_id": "guard_missing", "present": True}]
    assert any(alert["rule_ids"] == ["P08"] for alert in pump["analysis"]["evaluation"]["alerts"])
    assert gearbox["analysis"]["findings"] == [{"class_id": "oil_leak_at_housing", "present": True}]
    assert any(alert["rule_ids"] == ["G01"] for alert in gearbox["analysis"]["evaluation"]["alerts"])


def test_finding_with_no_place_on_this_equipment_is_refused(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        oil = confirm(client, kind="oil_leak_at_housing", label="Подтёк масла")
        unknown = confirm(client, kind="something", label="Что-то")
        bad_frame = confirm(client, image="data:image/png;base64,AAAA")
    assert oil.status_code == 422 and "некуда" in oil.json()["detail"]
    assert unknown.status_code == 422
    assert bad_frame.status_code == 422
