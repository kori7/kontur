"""Explainable diagnostic hypotheses for synthetic pump inspections only."""

from datetime import datetime, timezone

from .catalog import CATALOG
from .constants import RULES_VERSION, THRESHOLDS as T
from .features import extract, fresh, maintenance, number, timestamp


def _and(*facts):
    missing = sorted({entry for value, entries in facts if value is None for entry in entries})
    return (None, missing) if missing else (all(value for value, _ in facts), [])


def _or(*facts):
    if any(value is True for value, _ in facts):
        return True, []
    return _and(*facts) if any(value is None for value, _ in facts) else (False, [])


class Observations:
    def __init__(self, items, window):
        self.items = [item for item in items if isinstance(item, dict)]
        self.window = window
        self.accepted = {}

    def get(self, kind, component, combined=True, numeric=False):
        candidates = [item for item in self.items if item.get("kind") == kind and item.get("component_id") == component]
        candidates.sort(key=lambda item: timestamp(item.get("timestamp")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        missing = ["observations." + kind]
        if not candidates:
            return None, missing
        item = candidates[0]
        at = timestamp(item.get("timestamp"))
        if not fresh(at, self.window.now):
            return None, ["observations." + kind + ".fresh_timestamp"]
        if combined and (not self.window.valid or abs((self.window.at - at).total_seconds()) > T["max_alignment_seconds"]):
            return None, ["observations." + kind + ".aligned_timestamp"]
        if item.get("source") not in ("demo", "manual", "model"):
            return None, ["observations." + kind + ".source"]
        if item.get("source") == "model":
            quality = item.get("quality")
            if ("quality" in item and quality != "good") or ("confidence" not in item and quality != "good"):
                return None, ["observations." + kind + ".quality"]
            if "confidence" in item:
                confidence = number(item["confidence"])
                if confidence is None or not T["model_confidence"] <= confidence <= 1:
                    return None, ["observations." + kind + ".confidence"]
        value = number(item.get("value")) if numeric else item.get("present")
        if (numeric and value is None) or (not numeric and not isinstance(value, bool)):
            return None, missing
        self.accepted[kind] = item
        return value, []

    def evidence(self, kind):
        item = self.accepted.get(kind)
        if not item:
            return []
        names = {"liquid_leak": "Жидкость у уплотнения", "base_corrosion": "Коррозия рамы", "missing_bolt": "Отсутствующий болт",
                 "oil_low": "Низкий уровень масла", "oil_degraded": "Деградация масла", "contact_damage": "Повреждение контактов",
                 "guard_missing": "Отсутствие кожуха", "flow_instability": "Нестабильность потока", "cavitation_noise": "Кавитационный шум",
                 "analog_pressure": "Аналоговое давление, бар"}
        value = item.get("value") if kind == "analog_pressure" else ("признак есть" if item["present"] else "признак не обнаружен")
        return [{"label": names[kind], "value": value, "threshold": "Подтверждённое наблюдение; время: " + item["timestamp"],
                 "source": item["source"]}]


def evaluate(telemetry: dict, observations: list, now: datetime | None = None) -> dict:
    """Return hypotheses, unknown inputs, and normative (not prognostic) hours."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    window, features = extract(telemetry, now)
    service, valid_service = maintenance(telemetry)
    obs = Observations(observations, window)

    def fact(keys, predicate):
        keys = keys.split()
        missing = [key for key in keys if features.get(key) is None]
        if missing:
            return None, missing
        return bool(predicate(*(features[key] for key in keys))), []

    def positive_base(keys, predicate):
        keys = keys.split()
        missing = [key for key in keys if features.get(key) is None or (key.startswith("baseline_") and features[key] <= 0)]
        if missing:
            return None, missing
        return bool(predicate(*(features[key] for key in keys))), []

    def evidence(label, key, threshold):
        return {"label": label, "value": features[key], "threshold": threshold,
                "source": window.source + "; " + (features["latest_at"] or "время неизвестно")}

    temp_rise = fact("temperature_trend", lambda delta: delta >= T["temperature_rise_c"] - 1e-9)
    vib_rise = positive_base("vibration_trend baseline_vibration", lambda delta, base: delta >= max(T["vibration_rise_mm_s"], base * T["vibration_rise_ratio"]) - 1e-9)
    pressure_fall = fact("inlet_pressure_trend", lambda delta: delta <= -T["inlet_pressure_drop_bar"] + 1e-9)
    temp_normal = fact("temperature baseline_temperature", lambda value, base: abs(value - base) <= T["temperature_normal_delta_c"])
    vib_normal = positive_base("vibration baseline_vibration", lambda value, base: value <= base * T["vibration_normal_ratio"])
    current_normal = positive_base("current baseline_current", lambda value, base: abs(value / base - 1) <= T["current_normal_tolerance"] + 1e-9)
    current_mild = positive_base("current baseline_current", lambda value, base: T["current_mild_min_ratio"] + 1e-9 < value / base <= T["current_mild_max_ratio"] + 1e-9)
    leak = obs.get("liquid_leak", "seal")
    corrosion, bolt = obs.get("base_corrosion", "base"), obs.get("missing_bolt", "base")
    oil_low, oil_degraded = obs.get("oil_low", "bearing"), obs.get("oil_degraded", "bearing")
    contact = obs.get("contact_damage", "motor")
    guard = obs.get("guard_missing", "guard", combined=False)
    flow_instability, noise = obs.get("flow_instability", "inlet"), obs.get("cavitation_noise", "inlet")
    analog, analog_missing = obs.get("analog_pressure", "gauge", numeric=True)
    electronic = features["outlet_pressure"]
    pressure_missing = analog_missing + (["outlet_pressure.reference_abs_min_0.05_bar"] if electronic is None or abs(electronic) < T["pressure_reference_min_bar"] else [])
    if not pressure_missing:
        features["pressure_difference_ratio"] = abs(analog - electronic) / abs(electronic)
    pressure_mismatch = ((None, pressure_missing) if pressure_missing else
                         (features["pressure_difference_ratio"] > T["pressure_difference_ratio"] + 1e-9, []))
    imbalance = fact("phase_imbalance_ratio", lambda value: value > T["phase_imbalance_ratio"] + 1e-9)
    # Local temperature is optional and must identify the motor explicitly.
    if features["motor_temperature"] is not None:
        motor_hot = fact("motor_temperature baseline_temperature", lambda value, base: value >= base + T["motor_temperature_delta_c"])
        electrical = _or(imbalance, motor_hot)
    else:
        electrical = imbalance
    rules = {
        "R01": _and(vib_rise, temp_rise, current_normal),
        "R02": _and(vib_rise, pressure_fall),
        "R03": _and(fact("axial_vibration", lambda value: value >= T["axial_vibration_mm_s"]), temp_normal, current_mild),
        "R04": _and(fact("efficiency_drop_ratio", lambda value: value >= T["efficiency_drop_ratio"] - 1e-9), vib_normal, temp_normal,
                    positive_base("flow baseline_flow flow_range", lambda value, base, spread: abs(value / base - 1) <= T["comparable_flow_tolerance"] + 1e-9 and spread / base <= T["comparable_flow_tolerance"] + 1e-9)),
        "R05": ((service["due_in_hours"] is not None and service["due_in_hours"] <= 0, []) if valid_service else (None, ["runtime_hours", "last_service_hours"])),
        "R06": _and(leak, vib_rise, temp_rise),
        "R07": _and(_or(corrosion, bolt), fact("low_frequency_vibration harmonic_ratio", lambda low, harmonic: low >= T["low_frequency_vibration_mm_s"] and harmonic >= T["harmonic_ratio"])),
        "R08": _and(_or(oil_low, oil_degraded), fact("temperature baseline_temperature temperature_range", lambda value, base, spread: value >= base + T["oil_temperature_delta_c"] and spread <= T["stable_temperature_range_c"])),
        "R09": _and(contact, electrical),
        "R10": pressure_mismatch,
        "R11": guard,
        "R12": _and(pressure_fall, fact("high_frequency_vibration_trend", lambda delta: delta >= T["high_frequency_rise_mm_s"] - 1e-9), _or(flow_instability, noise)),
    }
    evidence_by_rule = _evidence(features, service, obs, evidence)
    results, alerts = [], []
    for rule_id, (triggered, missing) in rules.items():
        results.append({"id": rule_id, "status": "insufficient" if triggered is None else ("triggered" if triggered else "clear"), "missing": missing})
        if triggered is not True:
            continue
        title, component, severity, hypothesis, recommendation = CATALOG[rule_id]
        alerts.append({"id": "alert-" + rule_id.lower(), "rule_ids": [rule_id], "title": title,
                       "component_id": component, "severity": severity, "hypothesis": hypothesis,
                       "recommendation": recommendation, "evidence": evidence_by_rule[rule_id], "requires_inspection": True})
    cavitation = [alert for alert in alerts if set(alert["rule_ids"]) & {"R02", "R12"}]
    if len(cavitation) == 2:
        merged = next(alert for alert in cavitation if "R12" in alert["rule_ids"])
        merged["id"], merged["rule_ids"] = "alert-cavitation", ["R02", "R12"]
        existing = {item["label"] for item in merged["evidence"]}
        merged["evidence"] += [item for item in cavitation[0]["evidence"] if item["label"] not in existing]
        alerts = [alert for alert in alerts if alert not in cavitation or alert is merged]
    order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda alert: (order[alert["severity"]], alert["id"]))
    return {"alerts": alerts, "rule_results": results, "features": features,
            "maintenance": service, "source": "demo", "rules_version": RULES_VERSION}


def _evidence(features, service, observations, evidence):
    def observed(kind):
        item = observations.accepted.get(kind)
        return observations.evidence(kind) if item and item.get("present") is True else []

    temp = evidence("Рост температуры за окно, °C", "temperature_trend", "≥5 °C; минимум 3 измерения")
    vibration = evidence("Рост вибрации за окно, мм/с", "vibration_trend", "≥0,5 мм/с и ≥25% базового уровня; минимум 3 измерения")
    pressure = evidence("Изменение входного давления, бар", "inlet_pressure_trend", "≤−0,2 бар за окно; минимум 3 измерения")
    electrical = []
    if features["phase_imbalance_ratio"] is not None and features["phase_imbalance_ratio"] > T["phase_imbalance_ratio"]:
        electrical.append(evidence("Перекос фазных токов, доля", "phase_imbalance_ratio", "max(|Iфаза − Iсред|) / Iсред >0,05"))
    if features["motor_temperature"] is not None:
        electrical.append(evidence("Локальная температура двигателя, °C", "motor_temperature", "≥ базовой +15 °C"))
    return {
        "R01": [vibration, temp, evidence("Средний фазный ток, А", "current", "±10% базового тока")],
        "R02": [vibration, pressure] + observed("cavitation_noise"),
        "R03": [evidence("Осевая вибрация муфты, мм/с", "axial_vibration", "≥4 мм/с"), evidence("Температура, °C", "temperature", "В пределах ±5 °C от базовой"), evidence("Средний фазный ток, А", "current", ">105% и ≤120% базового тока")],
        "R04": [evidence("Относительное падение КПД, доля", "efficiency_drop_ratio", "≥0,15 от базового КПД"), evidence("КПД, доля", "efficiency", "(выход − вход), бар × расход, м³/ч / (36 × мощность, кВт)"), evidence("Расход, м³/ч", "flow", "Отклонение от базы и размах в окне ≤10%")],
        "R05": [{"label": "Наработка, ч", "value": service["runtime_hours"], "threshold": "Демонстрационные рубежи 4000 / 8000 / 16000 ч; следующий: " + str(service["next_service_hours"]), "source": "demo: журнал обслуживания"}],
        "R06": observed("liquid_leak") + [vibration, temp],
        "R07": observed("base_corrosion") + observed("missing_bolt") + [evidence("Низкочастотная вибрация, мм/с", "low_frequency_vibration", "≥2 мм/с"), evidence("Доля первой гармоники", "harmonic_ratio", "≥0,6; дисбаланс не исключён")],
        "R08": observed("oil_low") + observed("oil_degraded") + [evidence("Температура, °C", "temperature", "≥ базовой +10 °C"), evidence("Размах температуры, °C", "temperature_range", "≤2 °C; минимум 3 измерения")],
        "R09": observed("contact_damage") + electrical,
        "R10": observations.evidence("analog_pressure") + [evidence("Электронное давление, бар", "outlet_pressure", "|электронное давление| ≥0,05 бар"), evidence("Относительное расхождение", "pressure_difference_ratio", "|аналоговое − электронное| / |электронное| >0,15; разница времени ≤120 с")],
        "R11": observed("guard_missing"),
        "R12": [pressure, evidence("Рост ВЧ-вибрации, мм/с", "high_frequency_vibration_trend", "≥0,5 мм/с за окно; минимум 3 измерения")] + observed("flow_instability") + observed("cavitation_noise"),
    }
