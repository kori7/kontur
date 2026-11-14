"""Check the local vision server with a synthetic non-equipment image."""

import asyncio
import base64
import json
import os
import struct
import sys
import zlib
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))
from app.vision import VisionClient, VisionError  # noqa: E402


def chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


async def main():
    load_dotenv(ROOT / ".env")
    pixels = b"".join(b"\0" + bytes([242, 246, 237]) * 160 for _ in range(160))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 160, 160, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")
    image = "data:image/png;base64," + base64.b64encode(png).decode()
    client = VisionClient(os.getenv("LOCAL_VISION_URL", "http://127.0.0.1:8081/v1"),
                          os.getenv("LOCAL_VISION_MODEL", "Qwen3-VL-4B-Instruct"))
    try:
        result = await client.analyze(image)
    except VisionError as exc:
        print(f"Vision connectivity: FAILED — {exc}")
        return 1
    print(json.dumps({"connectivity": "PASS", "model": result["model"], "quality": result["quality"],
                      "observation_count": len(result["observations"]),
                      "note": "Connectivity check only; not a defect accuracy benchmark."}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
