"""Phone-like shots of the printed stand, for training and for a held-out test.

    python scripts/train/augment-stand.py [--train 200 --valid 30 --test 60]

Takes the three base renders from render-stand.mjs (normal, leak, guard missing) and writes
.models/rfdetr/sources/stand/{train,valid,test}/ in Roboflow COCO format. Each shot frames the sheet,
the drawing or a close-up, under a random perspective tilt, rotation, light, colour cast, glare, blur,
sensor noise, an occasional screen look and JPEG at the camera's quality. The normal sheet is
kept with no boxes, so the detector learns that a whole guard and a dry seal are not defects.

Every split uses its own random seed, but all of them come from the same three drawings: a score on
this test says the detector works on the stand under new framings, not that it generalises to real
pumps. Real pumps need the team's own photos (source «own» in sources.json).
"""

import argparse
import io
import json
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / ".models" / "rfdetr" / "stand"
OUT = ROOT / ".models" / "rfdetr" / "sources" / "stand"
CLASSES = ["stand", "guard_missing", "seal_leak_excessive"]
SIZES = [(640, 480), (480, 640), (640, 640)]


def homography(source, target):
    """3×3 matrix taking the four source points onto the four target points."""
    rows = []
    for (x, y), (u, v) in zip(source, target):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    solution = np.linalg.solve(np.array(rows, float), np.array([c for point in target for c in point], float))
    return np.append(solution, 1).reshape(3, 3)


def project(matrix, x, y):
    u, v, w = matrix @ np.array([x, y, 1.0])
    return u / w, v / w


def shot(rng: random.Random, base: Image.Image, item: dict, anchors: list):
    width, height = rng.choice(SIZES)
    x1, y1, x2, y2 = item["drawing"]
    mode = rng.random()
    if mode < 0.15:  # the whole sheet
        region = (0, 0, base.width, base.height)
    elif mode < 0.7:  # the drawing, as a phone aimed at the pump frames it
        margin = rng.uniform(-0.05, 0.2)
        region = (x1 - margin * (x2 - x1), y1 - margin * (y2 - y1), x2 + margin * (x2 - x1), y2 + margin * (y2 - y1))
    else:  # a close-up on the coupling or the seal; on the normal sheet the same spots show no sign
        bx1, by1, bx2, by2 = rng.choice(item["boxes"])["box"] if item["boxes"] else rng.choice(anchors)
        side = max(bx2 - bx1, by2 - by1) * rng.uniform(2.5, 6)
        cx, cy = (bx1 + bx2) / 2 + rng.uniform(-0.3, 0.3) * side, (by1 + by2) / 2 + rng.uniform(-0.3, 0.3) * side
        region = (cx - side / 2, cy - side * 0.4, cx + side / 2, cy + side * 0.4)
    rx1, ry1, rx2, ry2 = region
    # Fit the camera's aspect, then tilt: every corner moves on its own, as with a hand-held phone.
    span_w, span_h = rx2 - rx1, ry2 - ry1
    if span_w / span_h > width / height:
        grow = span_w * height / width - span_h
        ry1, ry2 = ry1 - grow / 2, ry2 + grow / 2
    else:
        grow = span_h * width / height - span_w
        rx1, rx2 = rx1 - grow / 2, rx2 + grow / 2
    span_w, span_h = rx2 - rx1, ry2 - ry1
    angle = np.radians(rng.uniform(-10, 10))
    cx, cy = (rx1 + rx2) / 2, (ry1 + ry2) / 2
    corners = []
    for x, y in ((rx1, ry1), (rx2, ry1), (rx2, ry2), (rx1, ry2)):
        x += rng.uniform(-0.09, 0.09) * span_w
        y += rng.uniform(-0.09, 0.09) * span_h
        dx, dy = x - cx, y - cy
        corners.append((cx + dx * np.cos(angle) - dy * np.sin(angle), cy + dx * np.sin(angle) + dy * np.cos(angle)))
    forward = homography(corners, [(0, 0), (width, 0), (width, height), (0, height)])
    backward = np.linalg.inv(forward)
    surface = tuple(rng.randint(40, 200) for _ in range(3))
    canvas = Image.new("RGB", base.size, surface)
    canvas.paste(base)
    pad = int(max(base.size))
    padded = Image.new("RGB", (base.width + 2 * pad, base.height + 2 * pad), surface)
    padded.paste(canvas, (pad, pad))
    shift = np.array([[1, 0, pad], [0, 1, pad], [0, 0, 1]], float)
    coefficients = (shift @ backward).flatten()[:8] / (shift @ backward)[2, 2]
    image = padded.transform((width, height), Image.PERSPECTIVE, tuple(coefficients), Image.BICUBIC)

    boxes = []
    for sign in item["boxes"]:
        bx1, by1, bx2, by2 = sign["box"]
        points = [project(forward, x, y) for x, y in ((bx1, by1), (bx2, by1), (bx2, by2), (bx1, by2))]
        xs, ys = [p[0] for p in points], [p[1] for p in points]
        full = (min(xs), min(ys), max(xs), max(ys))
        clipped = (max(0, full[0]), max(0, full[1]), min(width, full[2]), min(height, full[3]))
        area = max(0, full[2] - full[0]) * max(0, full[3] - full[1])
        kept = max(0, clipped[2] - clipped[0]) * max(0, clipped[3] - clipped[1])
        if area and kept / area >= 0.6 and clipped[2] - clipped[0] >= 8 and clipped[3] - clipped[1] >= 8:
            boxes.append((sign["kind"], clipped))

    image = ImageEnhance.Brightness(image).enhance(rng.uniform(0.55, 1.3))
    image = ImageEnhance.Contrast(image).enhance(rng.uniform(0.65, 1.3))
    image = ImageEnhance.Color(image).enhance(rng.uniform(0.6, 1.25))
    tint = Image.new("RGB", image.size, rng.choice([(255, 220, 170), (170, 200, 255), (255, 255, 255)]))
    image = Image.blend(image, tint, rng.uniform(0, 0.18))
    if rng.random() < 0.3:  # a laptop screen: cool cast and a dark bezel around the frame
        image = Image.blend(image, Image.new("RGB", image.size, (40, 70, 140)), rng.uniform(0.05, 0.15))
        draw = ImageDraw.Draw(image)
        edge = rng.randint(4, 30)
        draw.rectangle([0, 0, width, height], outline=(20, 20, 24), width=edge)
    if rng.random() < 0.35:  # glare
        glare = Image.new("L", image.size, 0)
        gx, gy = rng.uniform(0, width), rng.uniform(0, height)
        radius = rng.uniform(40, 180)
        ImageDraw.Draw(glare).ellipse([gx - radius, gy - radius * 0.6, gx + radius, gy + radius * 0.6],
                                      fill=rng.randint(60, 170))
        image = Image.composite(Image.new("RGB", image.size, (255, 255, 255)), image,
                                glare.filter(ImageFilter.GaussianBlur(radius / 2)))
    image = image.filter(ImageFilter.GaussianBlur(rng.uniform(0, 1.6)))
    noise = np.random.default_rng(rng.randint(0, 2**31)).normal(0, rng.uniform(0, 9), (height, width, 3))
    image = Image.fromarray(np.clip(np.asarray(image, float) + noise, 0, 255).astype("uint8"))
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=rng.randint(55, 90))
    return buffer.getvalue(), width, height, boxes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=int, default=200, help="снимков на вариант")
    parser.add_argument("--valid", type=int, default=30)
    parser.add_argument("--test", type=int, default=60)
    args = parser.parse_args()
    manifest = json.loads((BASE / "stand.json").read_text(encoding="utf-8"))
    bases = {item["variant"]: Image.open(BASE / item["file"]).convert("RGB") for item in manifest}
    anchors = [sign["box"] for item in manifest for sign in item["boxes"]]
    categories = [{"id": index, "name": name, "supercategory": "none" if index == 0 else "stand"}
                  for index, name in enumerate(CLASSES)]
    for seed, (split, count) in enumerate((("train", args.train), ("valid", args.valid), ("test", args.test))):
        rng = random.Random(1000 + seed)
        folder = OUT / split
        folder.mkdir(parents=True, exist_ok=True)
        images, annotations = [], []
        for item in manifest:
            for index in range(count):
                data, width, height, boxes = shot(rng, bases[item["variant"]], item, anchors)
                name = f"{item['variant']}-{split}-{index:03d}.jpg"
                (folder / name).write_bytes(data)
                image_id = len(images)
                images.append({"id": image_id, "file_name": name, "width": width, "height": height})
                for kind, (x1, y1, x2, y2) in boxes:
                    annotations.append({"id": len(annotations), "image_id": image_id,
                                        "category_id": CLASSES.index(kind), "bbox": [x1, y1, x2 - x1, y2 - y1],
                                        "area": (x2 - x1) * (y2 - y1), "iscrowd": 0})
        (folder / "_annotations.coco.json").write_text(json.dumps(
            {"images": images, "annotations": annotations, "categories": categories}), encoding="utf-8")
        print(f"stand/{split}: {len(images)} снимков, {len(annotations)} рамок")


if __name__ == "__main__":
    main()
