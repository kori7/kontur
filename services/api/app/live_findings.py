"""What a camera finding confirmed by the engineer means for the rules and for the journal.

The detector speaks in its training classes; the rules speak in two older vocabularies — manual
observations of the demo engine and defect classes of the registry. This module is the one place
that translates between them, and decides which component the journal entry belongs to.

A class with no counterpart is not forced into one: an oil stain has no input in the demo rules, so
confirming it records the frame and the entry but changes no rule.
"""

from app.registry import load_defect_classes

# Detector class → manual observation kind of the demo engine (services/api/app/diagnostics/engine.py).
ENGINE_KIND = {
    "guard_missing": "guard_missing",
    "guard_damaged": "guard_damaged",
    "liquid_leak": "liquid_leak",
    "seal_leak_excessive": "liquid_leak",
    "frame_corrosion": "base_corrosion",
    "missing_bolt": "missing_bolt",
    "loose_bolt": "loose_bolt",
}

# Detector class → defect class of the registry (data/registry/defect-classes.json).
REGISTRY_CLASS = {
    "guard_missing": "guard_missing",
    "liquid_leak": "seal_leak_excessive",
    "seal_leak_excessive": "seal_leak_excessive",
    "oil_leak_at_housing": "oil_leak_at_housing",
    "frame_corrosion": "frame_corrosion",
    "missing_bolt": "fastener_missing",
    "loose_bolt": "fastener_loose",
}


def plan_finding(kind: str, equipment_type: str, components: set[str], applicable: set[str],
                 observation_components: dict[str, str]) -> tuple[str | None, str | None, str | None]:
    """Return (observation kind, registry class, component) for one confirmed finding.

    Each part is None when this equipment has no place for it. A finding with no component at all
    cannot be recorded: the journal entry has to name the part that was looked at.
    """
    observation = ENGINE_KIND.get(kind)
    if observation is not None and observation_components.get(observation) not in components:
        observation = None
    finding = REGISTRY_CLASS.get(kind)
    if finding not in applicable:
        finding = None
    component = observation_components[observation] if observation else None
    if component is None and finding is not None:
        entry = next(item for item in load_defect_classes()["classes"] if item["id"] == finding)
        component = next((item for item in entry.get("components_by_type", {}).get(equipment_type, [])
                          if item in components), None)
    return observation, finding, component
