"""Explicitly synthetic equipment card; no manufacturer claims."""

COMPONENTS = [
    {"id": "pump", "name": "Насосный агрегат", "code": "Н-101", "position": [50, 60]},
    {"id": "motor", "name": "Электродвигатель", "code": "М-01", "position": [31, 53]},
    {"id": "coupling", "name": "Муфта", "code": "МФ-01", "position": [52, 54]},
    {"id": "guard", "name": "Кожух муфты", "code": "КЖ-01", "position": [51.7, 51]},
    {"id": "bearing", "name": "Подшипниковый узел", "code": "ПШ-01", "position": [63.2, 49]},
    {"id": "seal", "name": "Торцевое уплотнение", "code": "УП-01", "position": [68.1, 55]},
    {"id": "impeller", "name": "Рабочее колесо", "code": "РК-01", "position": [71, 50]},
    {"id": "base", "name": "Рама и крепление", "code": "РМ-01", "position": [40, 77]},
    {"id": "gauge", "name": "Манометр", "code": "МН-01", "position": [74.1, 21.4]},
    {"id": "inlet", "name": "Всасывающая линия", "code": "ВС-01", "position": [88, 54]},
]
COMPONENT_IDS = {component["id"] for component in COMPONENTS}


def equipment_card(events: list[dict] | None = None) -> dict:
    components = []
    for component in COMPONENTS:
        history = [event for event in events or [] if event["component_id"] == component["id"]]
        replacement = next((event for event in history if event["action"] == "replacement"), None)
        components.append({**component, "norm_hours": 16000, "installed_at": "2026-01-15",
                           "norm_source": "Демонстрационный норматив", "last_replacement": replacement,
                           "events_count": len(history)})
    return {"id": "pump-101", "name": "Насосный агрегат Н-101", "model": "К 100-80-160 · демонстрационная конфигурация",
            "location": "Насосная станция · контур охлаждения", "serial": "DEMO-2026-001",
            "source": "demo", "medium": "Вода", "power_kw": 30, "speed_rpm": 1450,
            "commissioned_at": "2026-01-15", "components": components,
            "notice": "Карточка, телеметрия и нормативы созданы для демонстрации. Требования изготовителя не подтверждены."}
