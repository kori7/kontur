"""Read the stage A registry: material sources, equipment types, objects, defect classes, measurements.

The registry is the shared vocabulary of both developers: identifiers used here are the ones used in
the API, the AR layer and the annotation files. Loading validates cross references, so a renamed узел
or a class without a data source fails here rather than silently producing an empty warning later.

An unconfirmed link is a value, not a gap to be filled in by the reader: ``link_status`` returns
``"unknown"`` and callers must present that as unknown instead of guessing.
"""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[3] / "data/registry"
LINK_STATUSES = {"confirmed", "unknown", "contradicted"}
TRAINING_USES = {"candidate", "illustration_only", "excluded"}


def _load(name: str) -> dict:
    return json.loads((DATA_DIR / f"{name}.json").read_text(encoding="utf-8"))


def load_sources() -> dict:
    """Return every supplied file with its stage A classification."""
    return _load("sources")


def load_equipment_types() -> dict:
    return _load("equipment-types")


def load_objects() -> dict:
    return _load("objects")


def load_defect_classes() -> dict:
    return _load("defect-classes")


def load_measurements() -> dict:
    return _load("measurements")


def equipment_type(type_id: str) -> dict:
    """Return one type or raise KeyError; never invent a type for an unknown identifier."""
    found = next((item for item in load_equipment_types()["types"] if item["id"] == type_id), None)
    if found is None:
        raise KeyError(type_id)
    return found


def registry_object(object_id: str) -> dict:
    found = next((item for item in load_objects()["objects"] if item["id"] == object_id), None)
    if found is None:
        raise KeyError(object_id)
    return found


def component_ids(type_id: str) -> set[str]:
    """Component identifiers of a type, including attached equipment."""
    item = equipment_type(type_id)
    return ({component["id"] for component in item["components"]}
            | {attached["id"] for attached in item.get("attached_equipment", [])})


def anchored_component_ids(type_id: str) -> set[str]:
    """Components that may carry a spatial AR label.

    A component that is not externally visible gets a card entry but no label in live video.
    """
    item = equipment_type(type_id)
    return {component["id"] for component in item["components"] + item.get("attached_equipment", [])
            if component.get("ar_anchor")}


def class_components(class_id: str, type_id: str) -> list[str]:
    """Components a defect class applies to within one equipment type.

    The mapping is per type on purpose: a seal on a progressive cavity pump and a seal on a
    centrifugal pump are different узлы, and a flat component list silently conflates them.
    """
    item = next((item for item in load_defect_classes()["classes"] if item["id"] == class_id), None)
    if item is None:
        raise KeyError(class_id)
    return item["components_by_type"].get(type_id, [])


def applicable_classes(object_id: str) -> list[dict]:
    """Defect classes applicable to an object, with the reason a class is excluded kept visible."""
    item = registry_object(object_id)
    type_item = equipment_type(item["equipment_type"])
    allowed = set(type_item.get("applicable_defect_classes", []))
    return [item for item in load_defect_classes()["classes"] if item["id"] in allowed]


def classes_without_examples() -> list[str]:
    """Declared classes that no admissible source file supports.

    These are the honest gaps: a class listed here can be annotated and shown in the interface,
    but a model has nothing to learn it from, so quality for it stays unmeasured.
    """
    return [item["id"] for item in load_defect_classes()["classes"]
            if not item.get("example_source_ids")]


def link_status(object_id: str, target_id: str) -> str:
    """Return the recorded status of a link, or ``"unknown"`` when no link is recorded at all."""
    for link in registry_object(object_id).get("links", []):
        if link["to"] == target_id:
            return link["status"]
    return "unknown"


def training_candidates() -> list[dict]:
    """Source files admissible as training examples."""
    return [item for item in load_sources()["sources"] if item["training_use"] == "candidate"]
