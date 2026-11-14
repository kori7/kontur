"""Behavioral checks for the deliberately synthetic pump rule set."""

import importlib
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

NOW = datetime(2026, 11, 13, 7, 0, tzinfo=timezone.utc)
KINDS = {
    "liquid_leak": "seal", "base_corrosion": "base", "missing_bolt": "base", "loose_bolt": "base",
    "oil_low": "bearing", "oil_degraded": "bearing", "contact_damage": "motor",
    "guard_missing": "guard", "guard_damaged": "guard", "flow_instability": "inlet", "cavitation_noise": "inlet",
}


def inputs():
    samples = [{
        "at": (NOW - timedelta(minutes=9 - index)).isoformat(),
        "temperature": 60.0, "vibration": 2.0,
        "current_a": 20.0, "current_b": 20.0, "current_c": 20.0,
        "inlet_pressure": 2.0, "outlet_pressure": 4.7,
        "flow": 100.0, "power": 10.0, "axial_vibration": 1.0,
        "low_frequency_vibration": 0.5, "harmonic_ratio": 0.2,
        "high_frequency_vibration": 0.3,
    } for index in range(10)]
    telemetry = {
        "timestamp": NOW.isoformat(), "source": "demo", "runtime_hours": 1200.0,
        "last_service_hours": 0.0,
        "baseline": {"temperature": 60.0, "vibration": 2.0, "current": 20.0,
                     "inlet_pressure": 2.0, "efficiency": 0.75, "flow": 100.0},
        "samples": samples,
    }
    observations = [{"kind": kind, "component_id": component, "present": False,
                     "source": "demo", "timestamp": NOW.isoformat()}
                    for kind, component in KINDS.items()]
    observations.append({"kind": "analog_pressure", "component_id": "gauge",
                         "value": 4.7, "source": "demo", "timestamp": NOW.isoformat()})
    return telemetry, observations


def values(telemetry, **fields):
    for sample in telemetry["samples"]:
        sample.update(fields)


def trend(telemetry, field, first, last):
    for index, sample in enumerate(telemetry["samples"]):
        sample[field] = first + (last - first) * index / 9


def observe(observations, kind, **fields):
    next(item for item in observations if item["kind"] == kind).update(fields)


def positive(rule):
    telemetry, observations = inputs()
    if rule in ("R01", "R06"):
        trend(telemetry, "temperature", 60, 70)
        trend(telemetry, "vibration", 2, 4.5)
    if rule == "R02":
        trend(telemetry, "vibration", 2, 4.5)
        trend(telemetry, "inlet_pressure", 2, 1.3)
    if rule == "R03":
        values(telemetry, axial_vibration=4.5, current_a=22, current_b=22, current_c=22)
    if rule == "R04":
        values(telemetry, power=12)
    if rule == "R05":
        telemetry["runtime_hours"] = 4100
    if rule == "R06":
        observe(observations, "liquid_leak", present=True)
    if rule == "R07":
        trend(telemetry, "low_frequency_vibration", 0.5, 2.5)
        values(telemetry, harmonic_ratio=0.7)
        observe(observations, "missing_bolt", present=True)
    if rule == "R08":
        values(telemetry, temperature=70)
        observe(observations, "oil_low", present=True)
    if rule == "R09":
        values(telemetry, current_a=22, current_b=20, current_c=18)
        observe(observations, "contact_damage", present=True)
    if rule == "R10":
        observe(observations, "analog_pressure", value=5.5)
    if rule == "R11":
        observe(observations, "guard_missing", present=True)
    if rule == "R12":
        trend(telemetry, "inlet_pressure", 2, 1.3)
        trend(telemetry, "high_frequency_vibration", 0.3, 1.8)
        observe(observations, "flow_instability", present=True)
    return telemetry, observations


class RuleBehaviorTests(unittest.TestCase):
    def evaluate(self, telemetry, observations):
        return importlib.import_module("app.diagnostics.engine").evaluate(telemetry, observations, now=NOW)

    def assert_rule(self, rule, telemetry, observations, status):
        result = self.evaluate(telemetry, observations)
        actual = next((item for item in result.get("rule_results", []) if item["id"] == rule), {})
        self.assertEqual(actual.get("status"), status, f"{rule}: {actual}")
        if status == "insufficient":
            self.assertTrue(actual.get("missing"))
        return result

    def test_normal_has_no_alerts_and_all_rules_clear(self):
        telemetry, observations = inputs()
        result = self.evaluate(telemetry, observations)
        self.assertEqual(len(result.get("rule_results", [])), 12)
        self.assertEqual(result.get("alerts"), [])
        self.assertTrue(all(item["status"] == "clear" for item in result["rule_results"]))

    def test_every_rule_has_a_positive_example(self):
        for number in range(1, 13):
            rule = f"R{number:02d}"
            with self.subTest(rule=rule):
                telemetry, observations = positive(rule)
                result = self.assert_rule(rule, telemetry, observations, "triggered")
                alert = next(item for item in result["alerts"] if rule in item["rule_ids"])
                self.assertTrue(alert["requires_inspection"])
                self.assertTrue(alert["evidence"])
                for evidence in alert["evidence"]:
                    self.assertTrue({"label", "value", "threshold", "source"} <= evidence.keys())

    def test_each_required_condition_can_prevent_trigger(self):
        cases = [
            ("R01", {"vibration": 2}), ("R01", {"temperature": 60}),
            ("R01", {"current_a": 30, "current_b": 30, "current_c": 30}),
            ("R02", {"vibration": 2}), ("R02", {"inlet_pressure": 2}),
            ("R03", {"axial_vibration": 1}), ("R03", {"temperature": 80}),
            ("R03", {"current_a": 20, "current_b": 20, "current_c": 20}),
            ("R04", {"power": 10}), ("R04", {"vibration": 5}),
            ("R04", {"temperature": 80}),
            ("R06", {"temperature": 60}), ("R06", {"vibration": 2}),
            ("R07", {"low_frequency_vibration": 2.5}), ("R07", {"harmonic_ratio": 0.1}),
            ("R08", {"temperature": 69.9}),
            ("R09", {"current_a": 20, "current_b": 20, "current_c": 20}),
            ("R12", {"inlet_pressure": 2}), ("R12", {"high_frequency_vibration": 0.3}),
        ]
        for rule, fields in cases:
            with self.subTest(rule=rule, fields=fields):
                telemetry, observations = positive(rule)
                values(telemetry, **fields)
                self.assert_rule(rule, telemetry, observations, "clear")

    def test_visual_condition_is_required(self):
        for rule, kind in [("R06", "liquid_leak"), ("R07", "missing_bolt"),
                           ("R08", "oil_low"), ("R09", "contact_damage"),
                           ("R11", "guard_missing"), ("R12", "flow_instability")]:
            with self.subTest(rule=rule):
                telemetry, observations = positive(rule)
                observe(observations, kind, present=False)
                self.assert_rule(rule, telemetry, observations, "clear")

    def test_missing_required_sensors_are_unknown(self):
        for rule, field in [("R01", "temperature"), ("R01", "current_a"),
                            ("R02", "vibration"), ("R03", "axial_vibration"),
                            ("R04", "flow"), ("R06", "vibration"),
                            ("R07", "harmonic_ratio"), ("R08", "temperature"),
                            ("R09", "current_b"), ("R10", "outlet_pressure"),
                            ("R12", "high_frequency_vibration")]:
            with self.subTest(rule=rule, field=field):
                telemetry, observations = positive(rule)
                values(telemetry, **{field: None})
                self.assert_rule(rule, telemetry, observations, "insufficient")

    def test_unobserved_visual_condition_is_unknown(self):
        for rule, kinds in [("R06", ["liquid_leak"]), ("R07", ["missing_bolt", "loose_bolt", "base_corrosion"]),
                            ("R08", ["oil_low", "oil_degraded"]), ("R09", ["contact_damage"]),
                            ("R10", ["analog_pressure"]), ("R11", ["guard_missing", "guard_damaged"]),
                            ("R12", ["flow_instability", "cavitation_noise"])]:
            with self.subTest(rule=rule):
                telemetry, observations = positive(rule)
                observations = [item for item in observations if item["kind"] not in kinds]
                self.assert_rule(rule, telemetry, observations, "insufficient")

    def test_missing_lifecycle_is_unknown(self):
        telemetry, observations = positive("R05")
        telemetry["last_service_hours"] = None
        self.assert_rule("R05", telemetry, observations, "insufficient")

    def test_one_point_does_not_prove_trend(self):
        for rule in ("R01", "R02", "R06", "R08", "R12"):
            with self.subTest(rule=rule):
                telemetry, observations = positive(rule)
                telemetry["samples"] = telemetry["samples"][-1:]
                self.assert_rule(rule, telemetry, observations, "insufficient")

    def test_latest_missing_value_does_not_reuse_old_reading(self):
        telemetry, observations = positive("R01")
        telemetry["samples"][-1]["temperature"] = None
        self.assert_rule("R01", telemetry, observations, "insufficient")

    def test_stale_telemetry_cannot_trigger_combined_alert(self):
        telemetry, observations = positive("R06")
        telemetry["timestamp"] = (NOW - timedelta(minutes=6)).isoformat()
        for sample in telemetry["samples"]:
            sample["at"] = (datetime.fromisoformat(sample["at"]) - timedelta(minutes=6)).isoformat()
        self.assert_rule("R06", telemetry, observations, "insufficient")

    def test_observation_alignment_boundary(self):
        for seconds, expected in [(120, "triggered"), (121, "insufficient"), (301, "insufficient")]:
            with self.subTest(seconds=seconds):
                telemetry, observations = positive("R06")
                observe(observations, "liquid_leak", timestamp=(NOW - timedelta(seconds=seconds)).isoformat())
                self.assert_rule("R06", telemetry, observations, expected)

    def test_low_model_confidence_cannot_trigger(self):
        telemetry, observations = positive("R06")
        observe(observations, "liquid_leak", source="model", confidence=0.4)
        self.assert_rule("R06", telemetry, observations, "insufficient")

    def test_good_model_quality_without_confidence_can_trigger_guard_rule(self):
        telemetry, observations = positive("R11")
        observe(observations, "guard_missing", source="model", quality="good")
        original = deepcopy(observations)
        self.assert_rule("R11", telemetry, observations, "triggered")
        self.assertEqual(observations, original)
        self.assertNotIn("confidence", next(item for item in observations if item["kind"] == "guard_missing"))

    def test_limited_or_unreadable_model_quality_without_confidence_is_unknown(self):
        for quality in ("limited", "unreadable"):
            with self.subTest(quality=quality):
                telemetry, observations = positive("R11")
                observe(observations, "guard_missing", source="model", quality=quality)
                self.assert_rule("R11", telemetry, observations, "insufficient")

    def test_explicit_model_quality_still_applies_when_confidence_is_high(self):
        for quality, expected in [("good", "triggered"), ("limited", "insufficient"),
                                  ("unreadable", "insufficient"), ("unknown", "insufficient")]:
            with self.subTest(quality=quality):
                telemetry, observations = positive("R11")
                observe(observations, "guard_missing", source="model", quality=quality, confidence=0.9)
                self.assert_rule("R11", telemetry, observations, expected)

    def test_model_confidence_boundary_remains_when_quality_is_good(self):
        for confidence, expected in [(0.699, "insufficient"), (0.7, "triggered"),
                                     (1, "triggered"), (1.01, "insufficient"), ("invalid", "insufficient")]:
            with self.subTest(confidence=confidence):
                telemetry, observations = positive("R11")
                observe(observations, "guard_missing", source="model", quality="good", confidence=confidence)
                self.assert_rule("R11", telemetry, observations, expected)

    def test_model_confidence_without_quality_retains_legacy_contract(self):
        telemetry, observations = positive("R11")
        observe(observations, "guard_missing", source="model", confidence=0.8)
        self.assert_rule("R11", telemetry, observations, "triggered")

    def test_model_without_quality_or_confidence_is_unknown(self):
        telemetry, observations = positive("R11")
        observe(observations, "guard_missing", source="model")
        self.assert_rule("R11", telemetry, observations, "insufficient")

    def test_component_mismatch_cannot_fuel_rule(self):
        telemetry, observations = positive("R06")
        observe(observations, "liquid_leak", component_id="base")
        self.assert_rule("R06", telemetry, observations, "insufficient")

    def test_cavitation_rules_merge_and_keep_both_ids(self):
        telemetry, observations = positive("R12")
        trend(telemetry, "vibration", 2, 4.5)
        result = self.evaluate(telemetry, observations)
        alerts = [item for item in result.get("alerts", []) if set(item["rule_ids"]) & {"R02", "R12"}]
        self.assertEqual(len(alerts), 1)
        self.assertEqual(set(alerts[0]["rule_ids"]), {"R02", "R12"})
        self.assertEqual(alerts[0]["severity"], "critical")

    def test_r02_does_not_require_audio(self):
        telemetry, observations = positive("R02")
        self.assert_rule("R02", telemetry, [], "triggered")

    def test_r03_mild_current_boundaries(self):
        for current, status in [(21, "clear"), (21.01, "triggered"), (24, "triggered"), (24.01, "clear")]:
            with self.subTest(current=current):
                telemetry, observations = positive("R03")
                values(telemetry, current_a=current, current_b=current, current_c=current)
                self.assert_rule("R03", telemetry, observations, status)

    def test_r04_relative_efficiency_boundary(self):
        for drop, status in [(0.149, "clear"), (0.15, "triggered"), (0.151, "triggered")]:
            with self.subTest(drop=drop):
                telemetry, observations = positive("R04")
                values(telemetry, power=10 / (1 - drop))
                result = self.assert_rule("R04", telemetry, observations, status)
                self.assertAlmostEqual(result["features"]["efficiency"], 0.75 * (1 - drop))

    def test_r04_does_not_require_comparable_flow(self):
        # The organizer's condition is КПД −15% with normal vibration and temperature, nothing more.
        telemetry, observations = positive("R04")
        del telemetry["baseline"]["flow"]
        self.assert_rule("R04", telemetry, observations, "triggered")
        telemetry, observations = positive("R04")
        trend(telemetry, "flow", 70, 100)
        self.assert_rule("R04", telemetry, observations, "triggered")

    def test_r03_high_radial_coupling_vibration_is_enough(self):
        telemetry, observations = positive("R03")
        values(telemetry, axial_vibration=1, coupling_radial_vibration=4.5)
        self.assert_rule("R03", telemetry, observations, "triggered")
        values(telemetry, coupling_radial_vibration=4.499)
        self.assert_rule("R03", telemetry, observations, "clear")

    def test_r03_unknown_axial_with_normal_radial_is_unknown(self):
        telemetry, observations = positive("R03")
        values(telemetry, axial_vibration=None, coupling_radial_vibration=1)
        self.assert_rule("R03", telemetry, observations, "insufficient")

    def test_r04_invalid_power_cannot_look_healthy(self):
        for power in (0, -1, None):
            with self.subTest(power=power):
                telemetry, observations = positive("R04")
                values(telemetry, power=power)
                self.assert_rule("R04", telemetry, observations, "insufficient")

    def test_r05_crossing_schedule_and_recorded_service(self):
        for runtime, serviced, expected_due, status in [
            (3999, 0, 1, "clear"), (4000, 0, 0, "triggered"),
            (4100, 0, -100, "triggered"), (4100, 4100, 3900, "clear"),
            (8000, 4000, 0, "triggered"), (16001, 8000, -1, "triggered"),
        ]:
            with self.subTest(runtime=runtime, serviced=serviced):
                telemetry, observations = inputs()
                telemetry.update(runtime_hours=runtime, last_service_hours=serviced)
                result = self.assert_rule("R05", telemetry, observations, status)
                self.assertEqual(result["maintenance"]["due_in_hours"], expected_due)

    def test_resource_remainder_is_separate_from_service(self):
        telemetry, observations = inputs()
        telemetry.update(runtime_hours=5000, last_service_hours=4000)
        result = self.evaluate(telemetry, observations)
        self.assertEqual(result.get("maintenance", {}).get("remaining_hours"), 11000)
        self.assertEqual(result["maintenance"]["due_in_hours"], 3000)
        telemetry["runtime_hours"] = 17000
        self.assertEqual(self.evaluate(telemetry, observations)["maintenance"]["remaining_hours"], 0)

    def test_r05_refers_to_whole_pump_maintenance(self):
        telemetry, observations = positive("R05")
        result = self.assert_rule("R05", telemetry, observations, "triggered")
        alert = next(item for item in result["alerts"] if "R05" in item["rule_ids"])
        self.assertEqual(alert["component_id"], "pump")

    def test_impossible_service_history_is_unknown(self):
        telemetry, observations = inputs()
        telemetry["last_service_hours"] = 9000
        self.assert_rule("R05", telemetry, observations, "insufficient")

    def test_r07_corrosion_alternative_and_foundation_diagnosis(self):
        telemetry, observations = positive("R07")
        observe(observations, "missing_bolt", present=False)
        observe(observations, "base_corrosion", present=True)
        result = self.assert_rule("R07", telemetry, observations, "triggered")
        alert = next(item for item in result["alerts"] if "R07" in item["rule_ids"])
        self.assertIn("посадкой агрегата на фундамент", alert["hypothesis"])

    def test_r07_loose_bolt_alternative(self):
        telemetry, observations = positive("R07")
        observe(observations, "missing_bolt", present=False)
        observe(observations, "loose_bolt", present=True)
        self.assert_rule("R07", telemetry, observations, "triggered")

    def test_r07_requires_rise_not_a_steady_level(self):
        telemetry, observations = positive("R07")
        values(telemetry, low_frequency_vibration=3.0)
        self.assert_rule("R07", telemetry, observations, "clear")
        telemetry["samples"] = telemetry["samples"][-1:]
        self.assert_rule("R07", telemetry, observations, "insufficient")

    def test_r11_damaged_or_shifted_guard_alternative(self):
        _, observations = positive("R11")
        observe(observations, "guard_missing", present=False)
        observe(observations, "guard_damaged", present=True)
        self.assert_rule("R11", {"source": "demo", "samples": []}, observations, "triggered")

    def test_r08_degraded_oil_alternative(self):
        telemetry, observations = positive("R08")
        observe(observations, "oil_low", present=False)
        observe(observations, "oil_degraded", present=True)
        self.assert_rule("R08", telemetry, observations, "triggered")

    def test_r08_temperature_must_be_stable(self):
        telemetry, observations = positive("R08")
        trend(telemetry, "temperature", 60, 75)
        self.assert_rule("R08", telemetry, observations, "clear")

    def test_r09_imbalance_boundary(self):
        for current, status in [(21, "clear"), (21.001, "triggered")]:
            with self.subTest(current=current):
                telemetry, observations = positive("R09")
                values(telemetry, current_a=current, current_b=20, current_c=40-current)
                self.assert_rule("R09", telemetry, observations, status)

    def test_r09_local_motor_temperature_can_supply_alternative(self):
        telemetry, observations = positive("R09")
        values(telemetry, current_a=None, current_b=None, current_c=None, motor_temperature=80)
        self.assert_rule("R09", telemetry, observations, "triggered")

    def test_r09_general_temperature_does_not_mean_motor_temperature(self):
        telemetry, observations = positive("R09")
        values(telemetry, temperature=90, current_a=20, current_b=20, current_c=20)
        self.assert_rule("R09", telemetry, observations, "clear")

    def test_r09_hot_motor_without_contact_damage_is_clear(self):
        telemetry, observations = inputs()
        values(telemetry, motor_temperature=90)
        self.assert_rule("R09", telemetry, observations, "clear")

    def test_zero_current_is_not_normal_and_does_not_divide_by_zero(self):
        for rule in ("R01", "R03", "R09"):
            with self.subTest(rule=rule):
                telemetry, observations = positive(rule)
                values(telemetry, current_a=0, current_b=0, current_c=0)
                self.assert_rule(rule, telemetry, observations, "insufficient")

    def test_r10_denominator_and_boundary(self):
        for fraction, status in [(0.15, "clear"), (0.151, "triggered")]:
            with self.subTest(fraction=fraction):
                telemetry, observations = inputs()
                observe(observations, "analog_pressure", value=4.7 * (1 + fraction))
                result = self.assert_rule("R10", telemetry, observations, status)
                self.assertAlmostEqual(result["features"]["pressure_difference_ratio"], fraction)
                if status == "triggered":
                    alert = next(item for item in result["alerts"] if "R10" in item["rule_ids"])
                    self.assertTrue(any("электрон" in item["threshold"].lower() for item in alert["evidence"]))

    def test_r10_near_zero_denominator_is_unknown(self):
        for pressure in (0, 0.049, -0.049):
            with self.subTest(pressure=pressure):
                telemetry, observations = positive("R10")
                values(telemetry, outlet_pressure=pressure)
                self.assert_rule("R10", telemetry, observations, "insufficient")

    def test_r10_stale_or_misaligned_reading_is_unknown(self):
        telemetry, observations = positive("R10")
        observe(observations, "analog_pressure", timestamp=(NOW-timedelta(minutes=3)).isoformat())
        self.assert_rule("R10", telemetry, observations, "insufficient")

    def test_r11_independent_of_all_sensors_and_lifecycle(self):
        _, observations = positive("R11")
        result = self.assert_rule("R11", {"source": "demo", "samples": []}, observations, "triggered")
        alert = next(item for item in result["alerts"] if "R11" in item["rule_ids"])
        self.assertEqual(alert["severity"], "critical")

    def test_r12_noise_alternative(self):
        telemetry, observations = positive("R12")
        observe(observations, "flow_instability", present=False)
        observe(observations, "cavitation_noise", present=True)
        self.assert_rule("R12", telemetry, observations, "triggered")

    def test_input_is_not_mutated(self):
        telemetry, observations = positive("R06")
        original = deepcopy((telemetry, observations))
        self.evaluate(telemetry, observations)
        self.assertEqual((telemetry, observations), original)

    def test_ruleset_is_marked_as_demo(self):
        telemetry, observations = inputs()
        result = self.evaluate(telemetry, observations)
        self.assertEqual(result.get("source"), "demo")
        self.assertIn("demo", result.get("features", {}).get("rules_version", ""))

    def test_nan_values_are_unknown_and_serializable(self):
        telemetry, observations = positive("R01")
        values(telemetry, temperature=float("nan"))
        result = self.assert_rule("R01", telemetry, observations, "insufficient")
        import json
        json.dumps(result, allow_nan=False)

    def test_trend_and_spectral_threshold_boundaries(self):
        cases = [
            ("R01", "temperature", 60, 64.999, "clear"),
            ("R01", "temperature", 60, 65, "triggered"),
            ("R01", "vibration", 2, 2.499, "clear"),
            ("R01", "vibration", 2, 2.5, "triggered"),
            ("R02", "inlet_pressure", 2, 1.801, "clear"),
            ("R02", "inlet_pressure", 2, 1.8, "triggered"),
            ("R03", "axial_vibration", 3.999, 3.999, "clear"),
            ("R03", "axial_vibration", 4, 4, "triggered"),
            ("R06", "temperature", 60, 64.999, "clear"),
            ("R06", "temperature", 60, 65, "triggered"),
            ("R07", "low_frequency_vibration", 0.5, 0.999, "clear"),
            ("R07", "low_frequency_vibration", 0.5, 1.0, "triggered"),
            ("R07", "harmonic_ratio", 0.599, 0.599, "clear"),
            ("R07", "harmonic_ratio", 0.6, 0.6, "triggered"),
            ("R08", "temperature", 68, 70, "triggered"),
            ("R08", "temperature", 67.999, 70, "clear"),
            ("R12", "high_frequency_vibration", 0.3, 0.799, "clear"),
            ("R12", "high_frequency_vibration", 0.3, 0.8, "triggered"),
        ]
        for rule, field, first, last, expected in cases:
            with self.subTest(rule=rule, field=field, last=last, expected=expected):
                telemetry, observations = positive(rule)
                trend(telemetry, field, first, last)
                self.assert_rule(rule, telemetry, observations, expected)

    def test_guard_observation_freshness_boundary(self):
        for seconds, expected in [(300, "triggered"), (301, "insufficient")]:
            with self.subTest(seconds=seconds):
                telemetry, observations = positive("R11")
                observe(observations, "guard_missing", timestamp=(NOW - timedelta(seconds=seconds)).isoformat())
                self.assert_rule("R11", telemetry, observations, expected)

    def test_three_unique_timestamps_are_required_for_a_trend(self):
        telemetry, observations = positive("R01")
        telemetry["samples"] = telemetry["samples"][-2:] * 5
        self.assert_rule("R01", telemetry, observations, "insufficient")

    def test_order_of_samples_does_not_change_result(self):
        telemetry, observations = positive("R06")
        expected = self.evaluate(telemetry, observations)
        telemetry["samples"].reverse()
        self.assertEqual(self.evaluate(telemetry, observations), expected)

    def test_future_observation_is_unknown(self):
        telemetry, observations = positive("R11")
        observe(observations, "guard_missing", timestamp=(NOW + timedelta(minutes=10)).isoformat())
        self.assert_rule("R11", telemetry, observations, "insufficient")

    def test_missing_baseline_is_unknown(self):
        for rule, baseline in [("R01", "vibration"), ("R01", "current"),
                               ("R02", "vibration"), ("R03", "temperature"),
                               ("R04", "efficiency"), ("R08", "temperature")]:
            with self.subTest(rule=rule, baseline=baseline):
                telemetry, observations = positive(rule)
                del telemetry["baseline"][baseline]
                self.assert_rule(rule, telemetry, observations, "insufficient")

    def test_no_universal_service_schedule_is_invented_after_last_milestone(self):
        telemetry, observations = inputs()
        telemetry.update(runtime_hours=17000, last_service_hours=16000)
        result = self.evaluate(telemetry, observations)
        self.assertIsNone(result["maintenance"]["next_service_hours"])
        self.assertIsNone(result["maintenance"]["due_in_hours"])
        self.assertEqual(result["maintenance"]["remaining_hours"], 0)


class EngineContractTests(unittest.TestCase):
    def test_engine_exposes_evaluate(self):
        self.assertTrue(
            (ROOT / "services/api/app/diagnostics/engine.py").exists(),
            "The diagnostic evaluation engine has not been implemented.",
        )
        engine = importlib.import_module("app.diagnostics.engine")
        self.assertTrue(callable(engine.evaluate))


if __name__ == "__main__":
    unittest.main()
