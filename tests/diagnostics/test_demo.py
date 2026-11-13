"""The public examples must exercise real rule inputs reproducibly."""

from datetime import datetime, timedelta, timezone
import importlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/api"))
NOW = datetime(2026, 11, 13, 7, tzinfo=timezone.utc)


class DemoScenarioTests(unittest.TestCase):
    def demo(self):
        self.assertTrue((ROOT / "services/api/app/demo.py").exists(), "Demo scenario provider is missing.")
        return importlib.import_module("app.demo")

    def test_catalog_contains_normal_twelve_rules_and_missing_data(self):
        catalog = self.demo().get_scenarios()
        expected = {"normal", "missing_data"} | {f"r{index:02d}" for index in range(1, 13)}
        self.assertEqual({item["id"] for item in catalog}, expected)
        self.assertEqual(len(catalog), 14)
        for item in catalog:
            self.assertTrue(item["title"])
            self.assertTrue(item["description"])

    def test_each_rule_scenario_triggers_its_rule(self):
        from app.diagnostics.engine import evaluate
        for index in range(1, 13):
            with self.subTest(index=index):
                scenario = self.demo().get_scenario(f"r{index:02d}", now=NOW)
                result = evaluate(scenario["telemetry"], scenario["observations"], now=NOW)
                self.assertIn(f"R{index:02d}", {rule["id"] for rule in result["rule_results"] if rule["status"] == "triggered"})
                json.dumps(scenario, allow_nan=False)

    def test_normal_scenario_is_clear(self):
        from app.diagnostics.engine import evaluate
        scenario = self.demo().get_scenario("normal", now=NOW)
        result = evaluate(scenario["telemetry"], scenario["observations"], now=NOW)
        self.assertEqual(result["alerts"], [])
        self.assertEqual({rule["status"] for rule in result["rule_results"]}, {"clear"})

    def test_missing_scenario_is_unknown(self):
        from app.diagnostics.engine import evaluate
        scenario = self.demo().get_scenario("missing_data", now=NOW)
        result = evaluate(scenario["telemetry"], scenario["observations"], now=NOW)
        self.assertEqual(result["alerts"], [])
        self.assertEqual({rule["status"] for rule in result["rule_results"]}, {"insufficient"})

    def test_samples_have_ten_one_minute_steps(self):
        for entry in self.demo().get_scenarios():
            with self.subTest(scenario=entry["id"]):
                scenario = self.demo().get_scenario(entry["id"], now=NOW)
                samples = scenario["telemetry"]["samples"]
                self.assertEqual(len(samples), 10)
                dates = [datetime.fromisoformat(item["at"]) for item in samples]
                self.assertEqual(dates[-1], NOW)
                self.assertEqual(set(right-left for left, right in zip(dates, dates[1:])), {timedelta(minutes=1)})
                self.assertEqual(scenario["telemetry"]["source"], "demo")
                for observation in scenario["observations"]:
                    self.assertEqual(observation["source"], "demo")

    def test_fixed_clock_is_deterministic_and_each_call_is_independent(self):
        first = self.demo().get_scenario("r06", now=NOW)
        second = self.demo().get_scenario("r06", now=NOW)
        self.assertEqual(first, second)
        first["telemetry"]["samples"][0]["temperature"] = -100
        self.assertNotEqual(first, second)

    def test_default_clock_provides_fresh_data(self):
        scenario = self.demo().get_scenario("normal")
        at = datetime.fromisoformat(scenario["telemetry"]["timestamp"])
        self.assertLess(abs((datetime.now(timezone.utc)-at).total_seconds()), 5)

    def test_unknown_id_is_rejected(self):
        with self.assertRaises(KeyError):
            self.demo().get_scenario("not-a-scenario")


if __name__ == "__main__":
    unittest.main()
