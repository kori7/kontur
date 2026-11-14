"""Versioned synthetic thresholds: these are not equipment specifications."""

RULES_VERSION = "pump-demo-1.1.0"
THRESHOLDS = {
    "max_age_seconds": 300, "max_alignment_seconds": 120, "max_future_seconds": 30,
    "trend_window_seconds": 600, "min_trend_samples": 3, "model_confidence": 0.7,
    "temperature_rise_c": 5.0, "temperature_normal_delta_c": 5.0,
    "vibration_rise_mm_s": 0.5, "vibration_rise_ratio": 0.25, "vibration_normal_ratio": 1.25,
    "current_normal_tolerance": 0.1, "current_mild_min_ratio": 1.05,
    "current_mild_max_ratio": 1.2, "current_min_a": 0.1,
    "inlet_pressure_drop_bar": 0.2, "axial_vibration_mm_s": 4.0,
    "coupling_radial_vibration_mm_s": 4.5, "efficiency_drop_ratio": 0.15,
    "low_frequency_rise_mm_s": 0.5, "harmonic_ratio": 0.6,
    "oil_temperature_delta_c": 10.0, "stable_temperature_range_c": 2.0,
    "phase_imbalance_ratio": 0.05, "motor_temperature_delta_c": 15.0,
    "pressure_difference_ratio": 0.15, "pressure_reference_min_bar": 0.05,
    "high_frequency_rise_mm_s": 0.5,
}
SERVICE_MILESTONES = (4000.0, 8000.0, 16000.0)
NORM_HOURS = 16000.0
