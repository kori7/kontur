"""Equipment catalogue over the stage A registry plus the synthetic demo object.

Cards are assembled from three separate places and never blend them: узлы come from the equipment
type, normative values come from the object's own passport, and history comes from the store. A value
the passport does not give stays ``None`` with a stated reason — in particular none of the documented
objects has a commissioning date, so their remaining resource is unknown rather than zero.

Only the demo object owns the synthetic scenarios. Replaying them against a documented object would
attach one machine's telemetry to another, which the источники explicitly forbid.
"""

from app import registry
from app.equipment import COMPONENTS as DEMO_COMPONENTS, equipment_card as demo_card

DEMO_ID = "pump-101"
TAG_KIND = "tag_position"


def _type_name(type_id: str) -> str:
    return registry.equipment_type(type_id)["name"]


def _is_inspectable(item: dict) -> bool:
    """A tag position may cover several physical units, so it is a reference entry, not a target."""
    return item.get("kind") != TAG_KIND


def list_catalog() -> dict:
    """Return selectable objects and the types behind them."""
    objects = []
    for item in registry.load_objects()["objects"]:
        type_item = registry.equipment_type(item["equipment_type"])
        objects.append({
            "id": item["id"],
            "equipment_type": item["equipment_type"],
            "type_name": type_item["name"],
            "name": item["name"],
            "model": item.get("model"),
            "serial": item.get("serial"),
            "source": item["source"],
            "documented": type_item["documented"] and item["source"] != "demo",
            "inspectable": _is_inspectable(item),
            "scenarios_available": item["id"] == DEMO_ID,
        })
    types = [{"id": item["id"], "name": item["name"], "documented": item["documented"],
              "component_count": len(item["components"]),
              "applicable_defect_classes": item["applicable_defect_classes"]}
             for item in registry.load_equipment_types()["types"]]
    return {"types": types, "objects": objects, "default_object_id": DEMO_ID}


def _component_norm(item: dict, component_id: str) -> tuple[int | None, str]:
    """Normative hours for one узел, or an explicit reason why the passport gives none."""
    limit = item.get("wear_parts_limit")
    if limit and component_id in limit["components"]:
        return limit["value_hours"], (
            f"Паспорт: быстроизнашиваемые детали — {limit['value_months']} мес "
            f"при наработке {limit['value_hours']} ч"
        )
    resource = item.get("resource_to_writeoff")
    if resource:
        return None, (
            f"Паспорт задаёт только ресурс агрегата ({resource['comparator']} {resource['value']} ч) "
            "и не задаёт норматив этого узла"
        )
    return None, "Нормативный срок службы узла в переданных документах не задан"


def _history(events: list[dict], component_id: str) -> dict:
    history = [event for event in events if event["component_id"] == component_id]
    return {"last_replacement": next((event for event in history if event["action"] == "replacement"), None),
            "events_count": len(history)}


def card(equipment_id: str, events: list[dict] | None = None) -> dict:
    """Return the digital card of one object; raise KeyError for an unknown identifier."""
    events = events or []
    if equipment_id == DEMO_ID:
        return {**demo_card(events), "equipment_type": "centrifugal_pump_unit",
                "type_name": _type_name("centrifugal_pump_unit"), "documented": False,
                "inspectable": True, "scenarios_available": True,
                # The demo notice already states this; a limitation would repeat it word for word.
                "commissioned_at_status": "demo", "documents": [], "parameters": {},
                "limitations": []}
    item = registry.registry_object(equipment_id)
    type_item = registry.equipment_type(item["equipment_type"])
    reference = item if "parameters" in item else registry.registry_object(item.get("same_type_as", equipment_id))
    components = []
    for component in type_item["components"] + type_item.get("attached_equipment", []):
        norm_hours, norm_source = _component_norm(reference, component["id"])
        position = component.get("position")
        components.append({
            "id": component["id"], "name": component["name"],
            "code": f"поз. {position}" if position else "навесное",
            "position": None,
            "quantity": component.get("quantity", 1),
            "externally_visible": bool(component.get("externally_visible")),
            "ar_anchor": bool(component.get("ar_anchor")),
            "norm_hours": norm_hours, "norm_source": norm_source,
            "installed_at": item.get("commissioned_at"),
            "note": component.get("note"),
            **_history(events, component["id"]),
        })
    parameters = reference.get("parameters", {})
    return {
        "id": item["id"], "equipment_type": item["equipment_type"], "type_name": type_item["name"],
        "name": item["name"], "model": item.get("model"), "serial": item.get("serial"),
        "location": item.get("site") or item.get("project") or "Место установки не указано",
        "source": item["source"], "documented": type_item["documented"],
        "inspectable": _is_inspectable(item), "scenarios_available": False,
        "medium": item.get("service") or reference.get("service") or "Не указано",
        "power_kw": parameters.get("power_kw") or parameters.get("motor_power_kw"),
        "speed_rpm": parameters.get("pump_speed_rpm") or parameters.get("speed_rpm"),
        "commissioned_at": item.get("commissioned_at"),
        "commissioned_at_status": item.get("commissioned_at_status", "unknown"),
        "commissioned_at_note": item.get("commissioned_at_note"),
        "parameters": parameters,
        "documents": item.get("document_ids", []),
        "components": components,
        "limitations": _limitations(item, type_item),
        "notice": _notice(item, type_item),
    }


def _limitations(item: dict, type_item: dict) -> list[str]:
    limitations = []
    if item.get("commissioned_at_status", "unknown") == "unknown":
        limitations.append(item.get("commissioned_at_note")
                           or "Дата ввода в эксплуатацию неизвестна, остаточный ресурс не рассчитывается.")
    if not type_item["documented"]:
        limitations.append(type_item.get("undocumented_note", ""))
    unknown = [link["to"] for link in item.get("links", []) if link["status"] == "unknown"]
    if unknown:
        limitations.append("Связи не подтверждены документами: " + ", ".join(unknown) + ".")
    if item.get("scan_note"):
        limitations.append(item["scan_note"])
    if item.get("quantity_note"):
        limitations.append(item["quantity_note"])
    if not _is_inspectable(item):
        limitations.append("Это позиция по проекту, а не отдельная машина: какой физический агрегат "
                           "на ней установлен, переданные документы не указывают. Осмотр ведётся по "
                           "конкретному серийному номеру.")
    return [text for text in limitations if text]


def _notice(item: dict, type_item: dict) -> str:
    if item["source"] == "demo":
        return item.get("demo_note", "")
    if not type_item["documented"]:
        return ("Для этого типа оборудования проектных документов не передано. Нормативные сроки, "
                "уставки и состав узлов не подтверждены изготовителем.")
    return ("Карточка собрана из переданных паспортов и инструкции. Неизвестные значения оставлены "
            "неизвестными и нормальным состоянием не заменяются.")


def component_ids(equipment_id: str) -> set[str]:
    """Components an inspection event may reference for this object."""
    if equipment_id == DEMO_ID:
        return {component["id"] for component in DEMO_COMPONENTS}
    return registry.component_ids(registry.registry_object(equipment_id)["equipment_type"])


def equipment_type_of(equipment_id: str) -> str:
    if equipment_id == DEMO_ID:
        return "centrifugal_pump_unit"
    return registry.registry_object(equipment_id)["equipment_type"]
