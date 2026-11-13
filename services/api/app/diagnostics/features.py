"""Extract finite, timestamped values without replacing absent data with zero."""

from datetime import datetime, timezone
from math import isfinite

from .constants import NORM_HOURS, RULES_VERSION, SERVICE_MILESTONES, THRESHOLDS as T


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if isfinite(value) else None


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return result.astimezone(timezone.utc) if result.tzinfo else None


def fresh(at, now):
    return at is not None and -T["max_future_seconds"] <= (now - at).total_seconds() <= T["max_age_seconds"]


class Window:
    def __init__(self, telemetry, now):
        self.now = now
        self.source = telemetry.get("source", "demo")
        pairs = [(timestamp(item.get("at")), item) for item in telemetry.get("samples", []) if isinstance(item, dict)]
        self.pairs = sorted([(at, item) for at, item in pairs if at is not None], key=lambda pair: pair[0])
        self.at = self.pairs[-1][0] if self.pairs else None
        envelope = timestamp(telemetry.get("timestamp"))
        self.valid = fresh(self.at, now) and fresh(envelope, now)
        if self.valid:
            self.valid = abs((self.at - envelope).total_seconds()) <= T["max_alignment_seconds"]
        self.latest = self.pairs[-1][1] if self.pairs and self.valid else {}
        self.baseline = telemetry.get("baseline") or {}

    def value(self, field):
        value = number(self.latest.get(field))
        if value is not None and field not in ("temperature", "motor_temperature", "inlet_pressure", "outlet_pressure") and value < 0:
            return None
        return value

    def base(self, field):
        return number(self.baseline.get(field))

    def series(self, field):
        if not self.valid or self.value(field) is None:
            return []
        # A duplicate timestamp is one measurement, not extra trend evidence.
        unique = {}
        for at, sample in self.pairs:
            value = number(sample.get(field))
            if value is not None and 0 <= (self.at - at).total_seconds() <= T["trend_window_seconds"]:
                unique[at] = value
        return sorted(unique.items())

    def delta(self, field):
        series = self.series(field)
        if len(series) < T["min_trend_samples"]:
            return None
        times = [(at - series[0][0]).total_seconds() for at, _ in series]
        values = [value for _, value in series]
        mean_x, mean_y = sum(times) / len(times), sum(values) / len(values)
        denominator = sum((x - mean_x) ** 2 for x in times)
        if denominator <= 0:
            return None
        slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(times, values)) / denominator
        return slope * (times[-1] - times[0])

    def spread(self, field):
        series = self.series(field)
        if len(series) < T["min_trend_samples"]:
            return None
        values = [value for _, value in series]
        return max(values) - min(values)


def extract(telemetry, now):
    window = Window(telemetry, now)
    fields = ("temperature", "vibration", "inlet_pressure", "outlet_pressure", "flow", "power",
              "axial_vibration", "low_frequency_vibration", "harmonic_ratio", "high_frequency_vibration", "motor_temperature")
    features = {field: window.value(field) for field in fields}
    for field in ("temperature", "vibration", "inlet_pressure", "high_frequency_vibration"):
        features[field + "_trend"] = window.delta(field)
    features["temperature_range"] = window.spread("temperature")
    features["flow_range"] = window.spread("flow")
    for field in ("temperature", "vibration", "current", "flow", "efficiency"):
        features["baseline_" + field] = window.base(field)
    phases = [window.value("current_" + phase) for phase in "abc"]
    current = sum(phases) / 3 if all(value is not None for value in phases) else None
    if current is not None and current <= T["current_min_a"]:
        current = None
    features["current"] = current
    features["phase_imbalance_ratio"] = max(abs(value - current) for value in phases) / current if current else None
    flow, power, inlet, outlet = (features[key] for key in ("flow", "power", "inlet_pressure", "outlet_pressure"))
    efficiency = None
    if all(value is not None for value in (flow, power, inlet, outlet)) and flow > 0 and power > 0 and outlet > inlet:
        calculated = (outlet - inlet) * flow / (36 * power)
        if 0 < calculated <= 1:
            efficiency = calculated
    features["efficiency"] = efficiency
    baseline_efficiency = features["baseline_efficiency"]
    features["efficiency_drop_ratio"] = ((baseline_efficiency - efficiency) / baseline_efficiency
        if efficiency is not None and baseline_efficiency is not None and 0 < baseline_efficiency <= 1 else None)
    features.update(rules_version=RULES_VERSION, thresholds_demo_only=True, telemetry_fresh=bool(window.valid),
                    sample_count=len(window.pairs), latest_at=window.at.isoformat() if window.at else None, pressure_difference_ratio=None)
    return window, features


def maintenance(telemetry):
    runtime, serviced = number(telemetry.get("runtime_hours")), number(telemetry.get("last_service_hours"))
    valid = runtime is not None and serviced is not None and 0 <= serviced <= runtime
    if runtime is not None and runtime < 0:
        runtime = None
    next_service = next((hours for hours in SERVICE_MILESTONES if hours > serviced), None) if valid else None
    return {"runtime_hours": runtime, "norm_hours": NORM_HOURS,
            "remaining_hours": max(NORM_HOURS - runtime, 0) if runtime is not None else None,
            "next_service_hours": next_service,
            "due_in_hours": next_service - runtime if next_service is not None else None}, valid
