"""Tests run against a known environment: sign-in off, no I/O server, no detector — unless a test asks."""

import pytest


@pytest.fixture(autouse=True)
def known_environment(monkeypatch):
    monkeypatch.setenv("KONTUR_AUTH", "off")
    monkeypatch.delenv("KONTUR_IO", raising=False)
    monkeypatch.setenv("KONTUR_DETECTOR", "none")
