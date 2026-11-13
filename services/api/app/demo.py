"""Deterministic synthetic scenarios with an injectable UTC replay clock."""

from datetime import datetime, timedelta, timezone


SCENARIOS = (
    ("normal", "Нормальный демонстрационный режим", "Стабильные измерения и отсутствие заданных визуальных признаков. Это не заключение об исправности реального насоса."),
    ("r01", "R01 · Подшипник: смазка или износ", "Растут температура и вибрация; фазные токи остаются в базовом диапазоне."),
    ("r02", "R02 · Признаки кавитации", "Растёт широкополосная вибрация и падает давление на входе. Аудиопризнак не обязателен."),
    ("r03", "R03 · Возможная расцентровка", "Повышены осевая вибрация муфты и ток; температура остаётся в базовом диапазоне."),
    ("r04", "R04 · Снижение КПД", "При сопоставимом расходе относительный КПД снизился более чем на 15%; температура и вибрация обычные."),
    ("r05", "R05 · Срок планового ТО", "Наработка пересекла незакрытый рубеж 4000 часов. Все интервалы здесь демонстрационные."),
    ("r06", "R06 · Жидкость у уплотнения", "Синтетический визуальный признак жидкости сопровождается ростом температуры и вибрации."),
    ("r07", "R07 · Крепление и рама", "Отсутствующий болт и низкочастотная вибрация с преобладанием первой гармоники. Дисбаланс не исключён."),
    ("r08", "R08 · Состояние масла", "Низкий уровень масла и стабильная температура на 10 °C выше демонстрационной базы."),
    ("r09", "R09 · Электрические контакты", "Признак повреждения контактов сочетается с перекосом фазных токов более 5%."),
    ("r10", "R10 · Расхождение манометров", "Синхронные аналоговый и электронный каналы расходятся более чем на 15% от электронного показания."),
    ("r11", "R11 · Отсутствует кожух", "Синтетический признак отсутствия кожуха вызывает предупреждение независимо от нормальных датчиков."),
    ("r12", "R12 · Кавитация: дополнительные признаки", "Падают входное давление, растут общая и ВЧ-вибрация, нестабилен поток. Основания R02 и R12 объединяются."),
    ("missing_data", "Недостаточно данных", "Датчики и наблюдения отсутствуют. Неизвестные данные не заменяются нормальным состоянием."),
)
OBSERVATION_COMPONENTS = {
    "liquid_leak": "seal", "base_corrosion": "base", "missing_bolt": "base",
    "oil_low": "bearing", "oil_degraded": "bearing", "contact_damage": "motor",
    "guard_missing": "guard", "flow_instability": "inlet", "cavitation_noise": "inlet",
}


def get_scenarios() -> list[dict]:
    return [{"id": identifier, "title": title, "description": description}
            for identifier, title, description in SCENARIOS]


def get_scenario(identifier: str, now: datetime | None = None) -> dict:
    """Return independent values; a fixed ``now`` reproduces the entire payload."""
    metadata = next((item for item in get_scenarios() if item["id"] == identifier), None)
    if metadata is None:
        raise KeyError(identifier)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc).replace(microsecond=0)
    samples = [{
        "at": (now - timedelta(minutes=9 - index)).isoformat(),
        "temperature": 60.0, "vibration": 2.0,
        "current_a": 20.0, "current_b": 20.0, "current_c": 20.0,
        "inlet_pressure": 2.0, "outlet_pressure": 4.7, "flow": 100.0, "power": 10.0,
        "axial_vibration": 1.0, "low_frequency_vibration": 0.5,
        "harmonic_ratio": 0.2, "high_frequency_vibration": 0.3,
    } for index in range(10)]
    telemetry = {"timestamp": now.isoformat(), "source": "demo", "runtime_hours": 1200.0,
                 "last_service_hours": 0.0,
                 "baseline": {"temperature": 60.0, "vibration": 2.0, "current": 20.0,
                              "inlet_pressure": 2.0, "efficiency": 0.75, "flow": 100.0},
                 "samples": samples}
    observations = [{"kind": kind, "component_id": component, "present": False,
                     "source": "demo", "timestamp": now.isoformat()}
                    for kind, component in OBSERVATION_COMPONENTS.items()]
    observations.append({"kind": "analog_pressure", "component_id": "gauge", "value": 4.7,
                         "source": "demo", "timestamp": now.isoformat()})

    def stable(**fields):
        for sample in samples:
            sample.update(fields)

    def trend(field, first, last):
        for index, sample in enumerate(samples):
            sample[field] = round(first + (last - first) * index / 9, 6)

    def present(kind):
        next(item for item in observations if item["kind"] == kind)["present"] = True

    if identifier in ("r01", "r06"):
        trend("temperature", 60, 70)
        trend("vibration", 2, 4.5)
    if identifier in ("r02", "r12"):
        trend("vibration", 2, 4.5)
        trend("inlet_pressure", 2, 1.3)
    if identifier == "r03":
        stable(axial_vibration=4.5, current_a=22.0, current_b=22.0, current_c=22.0)
    elif identifier == "r04":
        stable(power=12.0)
    elif identifier == "r05":
        telemetry["runtime_hours"] = 4100.0
    elif identifier == "r06":
        present("liquid_leak")
    elif identifier == "r07":
        stable(low_frequency_vibration=2.5, harmonic_ratio=0.7)
        present("missing_bolt")
    elif identifier == "r08":
        stable(temperature=70.0)
        present("oil_low")
    elif identifier == "r09":
        stable(current_a=22.0, current_b=20.0, current_c=18.0)
        present("contact_damage")
    elif identifier == "r10":
        next(item for item in observations if item["kind"] == "analog_pressure")["value"] = 5.5
    elif identifier == "r11":
        present("guard_missing")
    elif identifier == "r12":
        trend("high_frequency_vibration", 0.3, 1.8)
        present("flow_instability")
    elif identifier == "missing_data":
        for sample in samples:
            for field in sample:
                if field != "at":
                    sample[field] = None
        telemetry.update(runtime_hours=None, last_service_hours=None)
        observations = []
    return {**metadata, "telemetry": telemetry, "observations": observations}
