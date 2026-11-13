"""Create review sheets of supplied originals without modifying source images."""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/reference/organizer"
entries = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8-sig"))
out = ROOT / "output/qa"
out.mkdir(parents=True, exist_ok=True)
for category in ("pumps", "motors", "valves", "pipes"):
    photos = [entry for entry in entries if entry["category"] == category]
    cols, width, height = 4, 320, 230
    sheet = Image.new("RGB", (cols * width, ((len(photos) + cols - 1) // cols) * height), "#f5f5f5")
    draw = ImageDraw.Draw(sheet)
    for index, entry in enumerate(photos):
        x, y = index % cols * width, index // cols * height
        with Image.open(SOURCE / entry["path"]) as original:
            thumb = ImageOps.contain(ImageOps.exif_transpose(original).convert("RGB"), (width - 12, height - 26))
        sheet.paste(thumb, (x + (width - thumb.width) // 2, y + (height - 26 - thumb.height) // 2))
        draw.text((x + 8, y + height - 21), entry["id"], fill="#222222")
    path = out / f"reference-{category}.jpg"
    sheet.save(path, quality=92)
    print(path)
