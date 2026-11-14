"""The stage A registry must stay internally consistent and must not quietly upgrade unknown links."""

import hashlib
import importlib
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
REGISTRY_DIR = ROOT / "data/registry"
MANIFEST = ROOT / "data/reference/organizer/manifest.json"
ORGANIZER = ROOT / "data/reference/organizer"
CONTRACTS = ROOT / "docs/contracts"
BUILD_SCRIPT = ROOT / "scripts/data/build-registry.py"


@pytest.fixture
def registry():
    assert (ROOT / "services/api/app/registry.py").exists(), "Registry provider is missing."
    return importlib.import_module("app.registry")


def test_sources_cover_the_whole_manifest_with_matching_checksums(registry):
    entries = json.loads(MANIFEST.read_text(encoding="utf-8-sig"))
    sources = {item["id"]: item for item in registry.load_sources()["sources"]}
    assert set(sources) == {entry["id"] for entry in entries}, "Классификация охватывает не все переданные файлы."
    for entry in entries:
        assert sources[entry["id"]]["sha256"] == entry["sha256"], f"Контрольная сумма {entry['id']} разошлась с реестром."
        assert sources[entry["id"]]["path"] == entry["path"]


def test_classified_files_are_the_files_on_disk(registry):
    for item in registry.load_sources()["sources"]:
        path = ORGANIZER / item["path"]
        assert path.exists(), f"Файл {item['id']} отсутствует на диске."
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"], f"Файл {item['id']} изменился."


def test_build_script_reproduces_the_committed_sources():
    """Rebuilding must not change the committed file, and must not be run for the comparison."""
    spec = importlib.util.spec_from_file_location("build_registry", BUILD_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    committed = json.loads((REGISTRY_DIR / "sources.json").read_text(encoding="utf-8"))
    assert module.build() == committed, "Пересборка реестра даёт другой результат, чем закоммичено."


def test_training_use_values_are_declared(registry):
    for item in registry.load_sources()["sources"]:
        assert item["training_use"] in registry.TRAINING_USES, item["id"]


def test_watermarked_and_generated_files_never_become_training_candidates(registry):
    for item in registry.load_sources()["sources"]:
        if item["provenance"] in {"stock_watermark", "generated_watermark", "unknown"}:
            assert item["training_use"] != "candidate", (
                f"{item['id']}: происхождение {item['provenance']} не допускает использования в обучающей выборке."
            )


def test_edited_images_never_become_training_candidates(registry):
    for item in registry.load_sources()["sources"]:
        if item["editing"] in {"annotation_burned_in", "collage"}:
            assert item["training_use"] == "excluded", f"{item['id']}: разметка или монтаж вшиты в пиксели."


def test_duplicates_point_at_a_kept_file_and_are_excluded(registry):
    sources = {item["id"]: item for item in registry.load_sources()["sources"]}
    for item in sources.values():
        original = item.get("duplicate_of")
        if original is None:
            continue
        assert original in sources, f"{item['id']} ссылается на несуществующий оригинал {original}."
        assert sources[original].get("duplicate_of") is None, f"{item['id']} ссылается на другой дубликат."
        assert item["training_use"] == "excluded", f"Дубликат {item['id']} не должен попадать в выборку."


def test_every_object_has_a_known_equipment_type(registry):
    types = {item["id"] for item in registry.load_equipment_types()["types"]}
    for item in registry.load_objects()["objects"]:
        assert item["equipment_type"] in types, f"{item['id']}: неизвестный тип {item['equipment_type']}."


def test_object_and_type_documents_exist_in_sources(registry):
    known = {item["id"] for item in registry.load_sources()["sources"]}
    for item in registry.load_objects()["objects"]:
        for document in item.get("document_ids", []):
            assert document in known, f"{item['id']} ссылается на отсутствующий документ {document}."
    for item in registry.load_equipment_types()["types"]:
        for document in item.get("document_ids", []):
            assert document in known, f"{item['id']} ссылается на отсутствующий документ {document}."


def test_links_declare_a_status_and_resolve_to_a_known_target(registry):
    objects = registry.load_objects()
    known = {item["id"] for item in objects["objects"]} | {item["id"] for item in objects["projects"]}
    for item in objects["objects"]:
        for link in item.get("links", []):
            assert link["status"] in registry.LINK_STATUSES, f"{item['id']} -> {link['to']}: {link['status']}"
            assert link["to"] in known, f"{item['id']} ссылается на неизвестный объект {link['to']}."


def test_unconfirmed_links_are_reported_as_unknown(registry):
    """A missing document must not be rounded up to a confirmed relation."""
    assert registry.link_status("pcp-21031004-1", "tag-860-P-0201") == "unknown"
    assert registry.link_status("pcp-21031004-1", "motor-230201069") == "unknown"
    assert registry.link_status("tag-860-P-0201", "project-21031004") == "confirmed"
    assert registry.link_status("pcp-21031004-1", "pump-101") == "unknown", (
        "Незаписанная связь тоже должна возвращаться как неизвестная."
    )


def test_defect_classes_reference_known_types_and_components(registry):
    """Each listed type must resolve every component of the class, not just one of them."""
    types = {item["id"] for item in registry.load_equipment_types()["types"]}
    for item in registry.load_defect_classes()["classes"]:
        assert item["equipment_types"], item["id"]
        assert set(item["equipment_types"]) == set(item["components_by_type"]), (
            f"{item['id']}: список типов и состав узлов по типам разошлись."
        )
        for type_id, components in item["components_by_type"].items():
            assert type_id in types, f"{item['id']}: неизвестный тип {type_id}."
            assert components, f"{item['id']}: для типа {type_id} не назван ни один узел."
            known = registry.component_ids(type_id)
            for component in components:
                assert component in known, f"{item['id']}: у типа {type_id} нет узла {component}."


def test_type_and_class_applicability_agree(registry):
    """Applicability is declared twice and the two declarations must not drift apart."""
    from_classes: dict[str, set[str]] = {}
    for item in registry.load_defect_classes()["classes"]:
        for type_id in item["equipment_types"]:
            from_classes.setdefault(type_id, set()).add(item["id"])
    for item in registry.load_equipment_types()["types"]:
        assert set(item["applicable_defect_classes"]) == from_classes.get(item["id"], set()), (
            f"{item['id']}: перечень применимых классов не совпадает с каталогом классов."
        )


def test_defect_classes_declare_a_source_and_a_hard_negative(registry):
    for item in registry.load_defect_classes()["classes"]:
        assert item.get("definition_source"), f"{item['id']}: нет источника определения."
        assert item.get("hard_negatives"), f"{item['id']}: нет ни одного отрицательного случая."
        assert item.get("not_visible_when"), f"{item['id']}: не описано, когда признак не виден."
        assert item["annotation"] in registry.load_defect_classes()["annotation_types"], item["id"]


def test_class_examples_are_admissible_sources(registry):
    sources = {item["id"]: item for item in registry.load_sources()["sources"]}
    for item in registry.load_defect_classes()["classes"]:
        for source_id in item.get("example_source_ids", []):
            assert source_id in sources, f"{item['id']}: нет файла {source_id}."
            assert sources[source_id]["training_use"] == "candidate", (
                f"{item['id']}: файл {source_id} исключён из выборки и примером служить не может."
            )


def test_classes_without_examples_declare_the_gap(registry):
    for item in registry.load_defect_classes()["classes"]:
        if not item.get("example_source_ids"):
            assert item.get("data_gap"), f"{item['id']}: нет примеров и не описан пробел в данных."
    assert registry.classes_without_examples(), "Пробелы в данных не должны исчезать молча."


def test_type_class_references_resolve(registry):
    declared = {item["id"] for item in registry.load_defect_classes()["classes"]}
    excluded = {item["id"] for item in registry.load_defect_classes()["excluded_classes"]}
    for item in registry.load_equipment_types()["types"]:
        for class_id in item.get("applicable_defect_classes", []):
            assert class_id in declared, f"{item['id']}: класс {class_id} не объявлен."
            assert class_id not in excluded, f"{item['id']}: класс {class_id} одновременно объявлен и исключён."
        for entry in item.get("not_applicable_defect_classes", []):
            assert entry.get("reason"), f"{item['id']}: класс {entry['id']} исключён без причины."


def test_applicable_classes_exclude_impeller_rules_for_a_progressive_cavity_pump(registry):
    applicable = {item["id"] for item in registry.applicable_classes("pcp-21031004-1")}
    assert "impeller_erosion" not in applicable, "У одновинтового насоса рабочего колеса нет."
    assert "cavitation_signs" not in applicable
    assert "seal_leak_excessive" in applicable


def test_internal_components_get_no_ar_label(registry):
    for type_item in registry.load_equipment_types()["types"]:
        anchored = registry.anchored_component_ids(type_item["id"])
        hidden = {component["id"] for component in type_item["components"]
                  if not component.get("externally_visible")}
        assert not (anchored & hidden), (
            f"{type_item['id']}: узлы {sorted(anchored & hidden)} не видны снаружи, но помечены под AR-метку."
        )


def test_series_equipment_attribution_stays_refuted(registry):
    series = {item["id"]: item for item in registry.load_measurements()["series"]}
    for item in series.values():
        assert item["equipment_id"] is None
        assert item["equipment_id_status"] == "contradicted"
        assert item["equipment_id_evidence"], f"{item['id']}: статус заявлен без доказательства."


def test_series_rpm_contradicts_the_documented_pump_speed(registry):
    """The refutation in the registry has to keep matching the imported data."""
    records = json.loads((ROOT / "data/imported/vibration-001.json").read_text(encoding="utf-8"))["records"]
    observed = {record["values"]["rpm"] for record in records}
    documented = registry.registry_object("pcp-21031004-1")["parameters"]["pump_speed_rpm"]
    motor = registry.registry_object("motor-230201069")["parameters"]["speed_rpm"]
    assert documented not in observed and motor not in observed, (
        "Обороты ряда совпали с документированными: вывод реестра о противоречии нужно пересмотреть."
    )


def test_project_setpoints_are_not_mixed_with_series_setpoints(registry):
    sources = {item["id"]: item for item in registry.load_measurements()["setpoint_sources"]}
    project = sources["project-21031004-protection"]
    series = sources["organizer-series-thresholds"]
    assert project["applies_to_status"] == "confirmed" and project["applies_to"]
    assert series["applies_to_status"] == "unknown" and series["applies_to"] == []
    assert series["conflicts_with_project"], "Расхождение уставок должно быть записано, а не сглажено."


def test_contract_schemas_parse_and_declare_their_required_fields():
    expected = {
        "anchors.schema.json": {"schema_version", "model", "coordinate_system", "marker", "anchors", "provenance"},
        "frame.schema.json": {"schema_version", "session_id", "frame_id", "object_id", "captured_at", "image", "quality"},
        "observation.schema.json": {"schema_version", "session_id", "frame_id", "object_id", "captured_at",
                                    "completed_at", "model", "status", "observations"},
        "ar-overlay.schema.json": {"schema_version", "session_id", "object_id", "rendered_for_frame_id",
                                   "anchor_state", "component_labels", "defect_tracks"},
    }
    for name, required in expected.items():
        schema = json.loads((CONTRACTS / name).read_text(encoding="utf-8"))
        assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema", name
        assert schema["$id"].endswith(name), name
        assert set(schema["required"]) == required, name


def test_observation_contract_keeps_uncertainty_honest():
    schema = json.loads((CONTRACTS / "observation.schema.json").read_text(encoding="utf-8"))
    observation = schema["properties"]["observations"]["items"]["properties"]
    assert "null" in observation["score"]["type"], "score должен допускать отсутствие измеренной уверенности."
    assert "score_is_calibrated" in observation
    assert "model_unavailable" in schema["properties"]["status"]["enum"]
    assert "frame_unreadable" in schema["properties"]["status"]["enum"]
    assert "trained_on_project_data" in schema["properties"]["model"]["properties"]


def test_ar_contract_separates_spatial_labels_from_frame_tracks():
    schema = json.loads((CONTRACTS / "ar-overlay.schema.json").read_text(encoding="utf-8"))
    properties = schema["properties"]
    assert "lost" in properties["anchor_state"]["properties"]["status"]["enum"]
    track = properties["defect_tracks"]["items"]["properties"]
    assert set(track["state"]["enum"]) == {"preliminary", "confirmed", "lost"}
    assert "journal_event_id" in track, "Трек должен ссылаться на одно событие журнала, а не создавать новое на кадр."
    label = properties["component_labels"]["items"]["properties"]
    assert "insufficient_data" in label["status"]["enum"], (
        "Неосмотренный узел не должен получать статус «проблем не обнаружено»."
    )


def test_frame_contract_limits_the_analysis_queue():
    schema = json.loads((CONTRACTS / "frame.schema.json").read_text(encoding="utf-8"))
    pending = schema["properties"]["scheduler"]["properties"]["pending_frames"]
    assert pending["maximum"] == 1, "В очереди анализа держится только один актуальный кадр."
    assert schema["properties"]["pose"]["type"] == ["object", "null"], (
        "Отсутствие привязки должно выражаться явно, а не отсутствием поля."
    )
